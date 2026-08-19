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
  });

  if (error) return rpcErrorToResponse(error);

  return NextResponse.json(data, { status: 201 });
}
