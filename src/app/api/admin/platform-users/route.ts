// ============================================================
// GET/POST /api/admin/platform-users
//
// Super Admin only. "Platform users" here means Virgo's own sales
// team — members of the reserved `virgo-interno` account (023),
// which they use exactly like any client would use their own
// account's Kanban/inbox to run Virgo's own prospecting pipeline.
//
// GET  — every member of virgo-interno, if it's been bootstrapped
//        yet (see POST — it may not exist until the first seller is
//        added).
// POST — invites a new seller by email and adds them via the
//        admin_add_virgo_seller RPC (030), which bootstraps
//        virgo-interno on first call.
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { supabaseAdmin } from "@/lib/platform/admin-client";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    await requirePlatformAdmin();

    const supabase = await createClient();
    const { data: internalAccount } = await supabase
      .from("accounts")
      .select("id")
      .eq("is_internal", true)
      .maybeSingle();

    if (!internalAccount) {
      return NextResponse.json({ sellers: [] });
    }

    const { data: sellers, error } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, account_role, created_at")
      .eq("account_id", internalAccount.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET /api/admin/platform-users] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load platform users" },
        { status: 500 },
      );
    }

    return NextResponse.json({ sellers });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { userId: actingAdminId } = await requirePlatformAdmin();

    const { email } = await request.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const admin = supabaseAdmin();

    const { data: invited, error: inviteErr } =
      await admin.auth.admin.inviteUserByEmail(email);
    if (inviteErr || !invited.user) {
      console.error("[POST /api/admin/platform-users] invite error:", inviteErr);
      return NextResponse.json(
        { error: inviteErr?.message ?? "Failed to invite the seller" },
        { status: 400 },
      );
    }

    const { data: internalAccountId, error: rpcErr } = await admin.rpc(
      "admin_add_virgo_seller",
      { p_new_user_id: invited.user.id, p_acting_admin_user_id: actingAdminId },
    );

    if (rpcErr) {
      console.error(
        "[POST /api/admin/platform-users] admin_add_virgo_seller failed AFTER inviting",
        invited.user.id,
        ":",
        rpcErr,
      );
      return NextResponse.json(
        { error: "Seller was invited but could not be added to the internal account — check server logs" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, accountId: internalAccountId }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
