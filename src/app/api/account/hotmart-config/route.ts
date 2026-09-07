// ============================================================
// GET/POST/DELETE /api/account/hotmart-config
//
// Admin+ only. One Hotmart connection per account (hotmart_config,
// migration 033) — same tier as whatsapp-config/instagram-config.
//
// GET    — connection status + which events are enabled. Never
//          returns the hottok itself (write-only secret, same as
//          every other credential in this codebase — only its hash
//          is ever persisted), nor the client secret (write-only,
//          encrypted at rest — see POST below).
// POST   — upsert: paste/replace the hottok and/or change enabled
//          events. Re-pasting the same hottok is how an admin
//          "reconnects" after Hotmart rotates it.
//          `clientId`/`clientSecret` (042) are a SEPARATE credential
//          pair from the hottok — Hotmart's own OAuth app
//          credentials (Ferramentas → Credenciais), needed to call
//          Hotmart's Product List API from
//          /api/account/hotmart-products/sync. Both are optional on
//          every save so an admin can wire up the webhook first and
//          add API access later, or vice versa.
// DELETE — disconnect. Doesn't touch any deal/contact already
//          created from past webhook deliveries, nor the synced
//          hotmart_products catalog (a re-connect shouldn't force
//          re-building "produtos correlacionados" from scratch).
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { hashHottok } from "@/lib/auth/hotmart";
import { encrypt } from "@/lib/whatsapp/encryption";

// Curated subset of Hotmart's purchase events this integration
// understands. Hotmart has more (PURCHASE_CANCELED, PURCHASE_REFUNDED,
// etc.) but the UI only offers what was actually asked for — the RPC
// itself doesn't care and will happily honor more values here later
// without a migration.
const SUPPORTED_EVENTS = [
  "PURCHASE_OUT_OF_SHOPPING_CART",
  "PURCHASE_BILLET_PRINTED",
  "PURCHASE_APPROVED",
] as const;

export async function GET() {
  try {
    const ctx = await requireRole("admin");
    const { data, error } = await ctx.supabase
      .from("hotmart_config")
      .select(
        "enabled_events, client_id, created_at, updated_at, products_synced_at",
      )
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error("[GET /api/account/hotmart-config] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load Hotmart config" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      connected: !!data,
      enabledEvents: data?.enabled_events ?? SUPPORTED_EVENTS,
      updatedAt: data?.updated_at ?? null,
      // clientId is not a secret (it's the public half of the OAuth
      // pair) — safe to echo back so the UI can show "already set"
      // without making the admin re-paste it every visit.
      clientId: data?.client_id ?? null,
      // clientSecret itself never leaves the server — the UI only
      // needs to know whether one is on file.
      apiCredentialsConnected: !!data?.client_id,
      productsSyncedAt: data?.products_synced_at ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const body = (await request.json().catch(() => null)) as {
      hottok?: unknown;
      enabledEvents?: unknown;
      clientId?: unknown;
      clientSecret?: unknown;
    } | null;

    const hottok = typeof body?.hottok === "string" ? body.hottok.trim() : "";
    const clientId =
      typeof body?.clientId === "string" ? body.clientId.trim() : "";
    const clientSecret =
      typeof body?.clientSecret === "string" ? body.clientSecret.trim() : "";

    // A row must exist (i.e. the webhook side is already connected)
    // before API credentials can be attached — hotmart_config.id is
    // what hotmart_products/sync looks up, and there's nothing
    // account-scoped to upsert onto without a hottok first.
    const { data: existing } = await ctx.supabase
      .from("hotmart_config")
      .select("id")
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (!hottok && !existing) {
      return NextResponse.json({ error: "hottok is required" }, { status: 400 });
    }

    const enabledEvents = Array.isArray(body?.enabledEvents)
      ? body.enabledEvents.filter(
          (e): e is string =>
            typeof e === "string" &&
            (SUPPORTED_EVENTS as readonly string[]).includes(e),
        )
      : [...SUPPORTED_EVENTS];

    if (enabledEvents.length === 0) {
      return NextResponse.json(
        { error: "At least one event must be enabled" },
        { status: 400 },
      );
    }

    const upsertRow: Record<string, unknown> = {
      account_id: ctx.accountId,
      enabled_events: enabledEvents,
    };
    // Only touch hottok_hash / client_id / client_secret when a new
    // value was actually pasted — an admin editing just the enabled
    // events (or just the API credentials) shouldn't have to re-type
    // the other secrets to avoid wiping them.
    if (hottok) upsertRow.hottok_hash = hashHottok(hottok);
    if (clientId) upsertRow.client_id = clientId;
    if (clientSecret) upsertRow.client_secret = encrypt(clientSecret);

    const { error } = await ctx.supabase.from("hotmart_config").upsert(
      upsertRow,
      { onConflict: "account_id" },
    );

    if (error) {
      // A UNIQUE violation on hottok_hash means this exact hottok is
      // already wired to a different account — surface that plainly
      // rather than a generic 500, since it's a likely real mistake
      // (pasting the wrong account's token).
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "This Hotmart token is already connected to another account" },
          { status: 409 },
        );
      }
      console.error("[POST /api/account/hotmart-config] upsert error:", error);
      return NextResponse.json(
        { error: "Failed to save Hotmart config" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, endpoint: "/api/public/hotmart" });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole("admin");
    const { error } = await ctx.supabase
      .from("hotmart_config")
      .delete()
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[DELETE /api/account/hotmart-config] delete error:", error);
      return NextResponse.json(
        { error: "Failed to disconnect Hotmart" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
