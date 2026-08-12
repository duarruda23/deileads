// ============================================================
// GET/POST /api/admin/accounts
//
// Super Admin only (requirePlatformAdmin). Lists and creates
// client accounts — the core of the admin-geral MVP from escopo.md.
//
// GET  — every non-internal account, with the owner's name/email
//        for display. `accounts.owner_user_id` has no FK to
//        `profiles` (both reference `auth.users` independently), so
//        this does two queries and merges in TS rather than fighting
//        PostgREST's embed syntax for a relationship that doesn't
//        exist at the DB level.
// POST — creates the account AND invites its first Cliente Admin in
//        one call. Two privileged operations chained:
//          1. supabase.auth.admin.inviteUserByEmail — creates the
//             auth.users row (fires handle_new_user, giving them a
//             throwaway personal account) and emails them a set-
//             password link.
//          2. admin_create_account RPC (030) — moves that profile
//             into a freshly-created client account as 'owner',
//             deletes the orphan personal account, seeds a default
//             pipeline so the account works immediately.
//        If step 2 fails after step 1 succeeded, the invited user is
//        left with just their personal account rather than silently
//        vanishing — logged loudly so it's not a mystery to debug.
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
    const { data: accounts, error } = await supabase
      .from("accounts")
      .select("id, name, status, is_internal, owner_user_id, created_at")
      .eq("is_internal", false)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[GET /api/admin/accounts] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load accounts" },
        { status: 500 },
      );
    }

    const ownerIds = [...new Set(accounts.map((a) => a.owner_user_id))];
    const { data: owners } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", ownerIds.length > 0 ? ownerIds : ["00000000-0000-0000-0000-000000000000"]);

    const ownerById = new Map((owners ?? []).map((o) => [o.user_id, o]));

    return NextResponse.json({
      accounts: accounts.map((a) => ({
        ...a,
        owner: ownerById.get(a.owner_user_id) ?? null,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    await requirePlatformAdmin();

    const { accountName, ownerEmail } = await request.json();
    if (!accountName || typeof accountName !== "string") {
      return NextResponse.json(
        { error: "accountName is required" },
        { status: 400 },
      );
    }
    if (!ownerEmail || typeof ownerEmail !== "string") {
      return NextResponse.json(
        { error: "ownerEmail is required" },
        { status: 400 },
      );
    }

    const admin = supabaseAdmin();

    const { data: invited, error: inviteErr } =
      await admin.auth.admin.inviteUserByEmail(ownerEmail);
    if (inviteErr || !invited.user) {
      console.error("[POST /api/admin/accounts] invite error:", inviteErr);
      return NextResponse.json(
        { error: inviteErr?.message ?? "Failed to invite the account owner" },
        { status: 400 },
      );
    }

    const { data: accountId, error: rpcErr } = await admin.rpc(
      "admin_create_account",
      { p_account_name: accountName, p_owner_user_id: invited.user.id },
    );

    if (rpcErr) {
      console.error(
        "[POST /api/admin/accounts] admin_create_account failed AFTER inviting",
        invited.user.id,
        "— that user now has only a personal account:",
        rpcErr,
      );
      return NextResponse.json(
        { error: "Owner was invited but account setup failed — check server logs" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, accountId }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
