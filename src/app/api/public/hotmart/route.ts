// ============================================================
// POST /api/public/hotmart
//
// Public — no auth, no session, no account id in the URL. This is
// the ONE fixed URL every connected account pastes into their own
// Hotmart panel (Ferramentas → Webhook). Hotmart doesn't let us
// template the destination with an account id, so the request has to
// self-identify which account it belongs to — that's what the
// `X-HOTMART-HOTTOK` header is for (see 033_hotmart_integration.sql
// for the full design rationale).
//
// Backed by the SECURITY DEFINER `submit_hotmart_lead` RPC — same
// shape as the site-lead-intake route.
//
// Security model
//   - The hottok is looked up by its hash; a request with an unknown
//     hottok gets a 400, never a 404/500 that would leak whether
//     *some* account exists with that hash.
//   - Per-hottok rate limit (not per-IP — see rate-limit.ts) since
//     Hotmart's own servers are the caller, shared across every
//     connected account.
//   - Hotmart doesn't require (or check) a specific response body on
//     success — 200/201 is enough to mark the delivery as done and
//     stop retries.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { hashHottok } from "@/lib/auth/hotmart";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { runAutomationsForTrigger } from "@/lib/automations/engine";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

interface HotmartBuyer {
  name?: string;
  email?: string;
  // Purchase events (PURCHASE_APPROVED, PURCHASE_BILLET_PRINTED, …).
  checkout_phone?: string;
  checkout_phone_code?: string;
  // Cart-abandonment event (PURCHASE_OUT_OF_SHOPPING_CART) — already
  // includes the country code, unlike checkout_phone above.
  phone?: string;
}

interface HotmartWebhookPayload {
  event?: string;
  data?: {
    buyer?: HotmartBuyer;
    purchase?: {
      transaction?: string;
      origin?: { src?: string; sck?: string; xcod?: string };
      // Only present once a transaction exists (approval-type events) —
      // cart-abandonment fires before checkout, so it never carries this.
      price?: { value?: number; currency_value?: string };
    };
    // Present on every event shape Hotmart sends (purchase AND
    // cart-abandonment alike) — unlike purchase.transaction, this
    // doesn't depend on a transaction existing yet, which is exactly
    // why product-based tagging (042) works even for an open/abandoned
    // lead, not just an approved sale.
    product?: { id?: number | string; name?: string };
  };
}

/**
 * Purchase-event payloads split the phone into a local number
 * (`checkout_phone`) and, for Brazilian buyers only, a separate DDD
 * (`checkout_phone_code`) — neither carries the country code.
 * Cart-abandonment's `buyer.phone` already comes fully formed
 * (country code included). `submit_hotmart_lead` strips non-digits
 * either way, so exact separator formatting doesn't matter here.
 */
function extractPhone(buyer: HotmartBuyer | undefined): string | null {
  if (!buyer) return null;
  if (buyer.phone) return buyer.phone;
  if (buyer.checkout_phone) {
    return buyer.checkout_phone_code
      ? `55${buyer.checkout_phone_code}${buyer.checkout_phone}`
      : buyer.checkout_phone;
  }
  return null;
}

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "22023") {
    return NextResponse.json(
      { ok: false, error: "Unknown Hotmart token" },
      { status: 400 },
    );
  }
  if (err.code === "23514") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "The connected account has no default pipeline/stage configured yet.",
      },
      { status: 409 },
    );
  }
  console.error("[hotmart-webhook] unexpected RPC error:", err);
  return NextResponse.json(
    { ok: false, error: "Failed to process Hotmart event" },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const hottok = request.headers.get("x-hotmart-hottok");
  if (!hottok) {
    return NextResponse.json(
      { ok: false, error: "Missing X-HOTMART-HOTTOK header" },
      { status: 401 },
    );
  }

  const hottokHash = hashHottok(hottok);

  const limit = checkRateLimit(
    `hotmart:${hottokHash}`,
    RATE_LIMITS.hotmartWebhook,
  );
  if (!limit.success) return rateLimitResponse(limit);

  let body: HotmartWebhookPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const event = body.event;
  if (!event) {
    return NextResponse.json(
      { ok: false, error: "Missing event" },
      { status: 400 },
    );
  }

  const buyer = body.data?.buyer;
  const phone = extractPhone(buyer);
  const origin = body.data?.purchase?.origin;
  const utm = origin ? { src: origin.src, sck: origin.sck, xcod: origin.xcod } : null;
  const price = body.data?.purchase?.price;
  const product = body.data?.product;
  // Hotmart sends product.id as a number; the RPC/hotmart_products
  // both take it as text (see 042) — stringify here once instead of
  // at every call site.
  const productId =
    product?.id === undefined || product.id === null ? null : String(product.id);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_hotmart_lead", {
    p_hottok_hash: hottokHash,
    p_event: event,
    p_name: buyer?.name ?? null,
    p_phone: phone,
    p_email: buyer?.email ?? null,
    p_transaction: body.data?.purchase?.transaction ?? null,
    p_utm: utm,
    p_value: price?.value ?? null,
    p_currency: price?.currency_value ?? null,
    p_product_id: productId,
    p_product_name: product?.name ?? null,
  });

  if (error) return rpcErrorToResponse(error);

  // submit_hotmart_lead already applied the group's tag (if any) to the
  // contact directly in SQL — that write never goes through application
  // code, so nothing has fired the `tag_added` automation trigger for it
  // yet (the only other place that happens is the WhatsApp inbound
  // webhook). Dispatch it here, fire-and-forget, so per-account
  // combined-tag automations (e.g. "Desafio + Análise") built on top of
  // this can actually run. Generic across every account — nothing below
  // is specific to any one Hotmart seller.
  const responseBody = data as { contact_id?: string; tag_applied?: boolean } | null;
  if (responseBody?.tag_applied && responseBody.contact_id && productId) {
    dispatchTagAddedForHotmartProduct({
      hottokHash,
      contactId: responseBody.contact_id,
      productId,
    }).catch((err) =>
      console.error("[hotmart-webhook] tag_added dispatch failed:", err),
    );
  }

  return NextResponse.json(data, { status: 201 });
}

/**
 * Resolve which tag submit_hotmart_lead just applied (via the product's
 * group) and dispatch the `tag_added` automation trigger for it. Split
 * into its own function so the main handler can fire it without
 * awaiting — the webhook response to Hotmart must not wait on this.
 */
async function dispatchTagAddedForHotmartProduct(args: {
  hottokHash: string;
  contactId: string;
  productId: string;
}): Promise<void> {
  const admin = supabaseAdmin();

  const { data: config } = await admin
    .from("hotmart_config")
    .select("account_id")
    .eq("hottok_hash", args.hottokHash)
    .maybeSingle();
  if (!config?.account_id) return;

  const { data: product } = await admin
    .from("hotmart_products")
    .select("group_id")
    .eq("account_id", config.account_id)
    .eq("hotmart_product_id", args.productId)
    .maybeSingle();
  if (!product?.group_id) return;

  const { data: group } = await admin
    .from("hotmart_product_groups")
    .select("tag_id")
    .eq("id", product.group_id)
    .maybeSingle();
  if (!group?.tag_id) return;

  await runAutomationsForTrigger({
    accountId: config.account_id,
    triggerType: "tag_added",
    contactId: args.contactId,
    context: { tag_id: group.tag_id },
  });
}
