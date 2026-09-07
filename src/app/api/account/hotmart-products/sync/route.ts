// ============================================================
// POST /api/account/hotmart-products/sync
//
// Admin+ only. Pulls the account's real product catalog from
// Hotmart's Product List API (using the Client ID/Secret saved on
// hotmart_config, 042) and upserts it into hotmart_products —
// this is the "the system should understand which products exist"
// piece from the 07/09/2026 request, as opposed to the webhook's
// incidental auto-registration of a product the first time it sees
// a sale for it (submit_hotmart_lead, 042).
//
// Existing rows are matched on (account_id, hotmart_product_id) and
// only have their name/synced_at touched — group_id (the admin's own
// "produto correlacionado" assignment) is never overwritten by a
// sync, intentionally: re-running sync after Hotmart renames a
// product shouldn't un-assign it from whatever group it was put in.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { getHotmartAccessToken, listHotmartProducts } from "@/lib/hotmart/api";

export async function POST() {
  try {
    const ctx = await requireRole("admin");

    const { data: config, error: configError } = await ctx.supabase
      .from("hotmart_config")
      .select("id, client_id, client_secret")
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (configError) {
      console.error(
        "[POST /api/account/hotmart-products/sync] config fetch error:",
        configError,
      );
      return NextResponse.json(
        { error: "Failed to load Hotmart config" },
        { status: 500 },
      );
    }
    if (!config?.client_id || !config?.client_secret) {
      return NextResponse.json(
        {
          error:
            "No Hotmart API credentials on file — add the Client ID/Secret in Settings → Hotmart first (Ferramentas → Credenciais no painel da Hotmart).",
        },
        { status: 409 },
      );
    }

    let accessToken: string;
    let clientSecret: string;
    try {
      clientSecret = decrypt(config.client_secret);
    } catch (err) {
      console.error(
        "[POST /api/account/hotmart-products/sync] decrypt error:",
        err,
      );
      return NextResponse.json(
        { error: "Stored Hotmart credentials are corrupted — reconnect them" },
        { status: 500 },
      );
    }

    try {
      accessToken = await getHotmartAccessToken({
        clientId: config.client_id,
        clientSecret,
      });
    } catch (err) {
      console.error(
        "[POST /api/account/hotmart-products/sync] auth error:",
        err,
      );
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? `Hotmart rejected the credentials: ${err.message}`
              : "Hotmart rejected the credentials",
        },
        { status: 502 },
      );
    }

    let products: Awaited<ReturnType<typeof listHotmartProducts>>;
    try {
      products = await listHotmartProducts(accessToken);
    } catch (err) {
      console.error(
        "[POST /api/account/hotmart-products/sync] list error:",
        err,
      );
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? `Failed to list Hotmart products: ${err.message}`
              : "Failed to list Hotmart products",
        },
        { status: 502 },
      );
    }

    if (products.length === 0) {
      return NextResponse.json({ ok: true, synced: 0, products: [] });
    }

    const now = new Date().toISOString();
    const rows = products.map((p) => ({
      account_id: ctx.accountId,
      hotmart_product_id: p.id,
      name: p.name,
      synced_at: now,
    }));

    // group_id is deliberately absent from this payload — see file
    // header. Supabase's upsert only overwrites the columns present
    // here, so an existing row's group_id survives untouched.
    const { data: upserted, error: upsertError } = await ctx.supabase
      .from("hotmart_products")
      .upsert(rows, { onConflict: "account_id,hotmart_product_id" })
      .select("id, hotmart_product_id, name, group_id");

    if (upsertError) {
      console.error(
        "[POST /api/account/hotmart-products/sync] upsert error:",
        upsertError,
      );
      return NextResponse.json(
        { error: "Failed to save synced products" },
        { status: 500 },
      );
    }

    await ctx.supabase
      .from("hotmart_config")
      .update({ products_synced_at: now })
      .eq("id", config.id);

    return NextResponse.json({
      ok: true,
      synced: upserted?.length ?? 0,
      products: upserted ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
