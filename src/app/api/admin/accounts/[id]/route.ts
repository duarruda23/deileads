// ============================================================
// PATCH/DELETE /api/admin/accounts/[id]
//
// Super Admin only.
//
// PATCH  — rename and/or suspend/reactivate a client account. Uses
//          the caller's own (RLS-scoped) session client, not the
//          service role — 023's accounts_update policy already lets
//          a platform admin update any account row, so there's no
//          need to bypass RLS here (unlike account creation, which
//          needs the Admin Auth API).
// DELETE — fully tears down an already-redeemed client account: the
//          account row (cascades to its profile, contacts, deals,
//          conversations, everything — see 017's ON DELETE CASCADE
//          chain), then the owner's auth.users row itself, so the
//          same email is free to be re-invited from scratch. Needs
//          the service role: `accounts` has no client-reachable
//          DELETE RLS policy (deletion was never meant to happen
//          through the regular session), and deleting the auth user
//          is an Admin API operation regardless.
//
//          Deletion order matters: `accounts.owner_user_id`
//          references `auth.users(id) ON DELETE RESTRICT`, so the
//          auth user can't be deleted while the account still points
//          at them — the account row has to go first.
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { supabaseAdmin } from "@/lib/platform/admin-client";
import { createClient } from "@/lib/supabase/server";

const VALID_STATUSES = ["active", "suspended"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin();

    const { id } = await params;
    const body = await request.json();

    const update: Record<string, string> = {};
    if (typeof body.name === "string" && body.name.trim() !== "") {
      update.name = body.name.trim();
    }
    if (typeof body.status === "string") {
      if (!VALID_STATUSES.includes(body.status)) {
        return NextResponse.json(
          { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
          { status: 400 },
        );
      }
      update.status = body.status;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "Nothing to update — provide name and/or status" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("accounts")
      .update(update)
      .eq("id", id)
      .eq("is_internal", false); // defense-in-depth — never let this route touch virgo-interno

    if (error) {
      console.error("[PATCH /api/admin/accounts/:id] update error:", error);
      return NextResponse.json(
        { error: "Failed to update account" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;

    const admin = supabaseAdmin();

    const { data: account, error: fetchErr } = await admin
      .from("accounts")
      .select("id, owner_user_id, is_internal")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr) {
      console.error("[DELETE /api/admin/accounts/:id] fetch error:", fetchErr);
      return NextResponse.json(
        { error: "Failed to load account" },
        { status: 500 },
      );
    }
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    if (account.is_internal) {
      // Defense-in-depth — never let this route touch virgo-interno,
      // same guard as PATCH.
      return NextResponse.json(
        { error: "Cannot delete the internal Virgo account" },
        { status: 400 },
      );
    }

    const { error: deleteAccountErr } = await admin
      .from("accounts")
      .delete()
      .eq("id", id);

    if (deleteAccountErr) {
      console.error(
        "[DELETE /api/admin/accounts/:id] account delete error:",
        deleteAccountErr,
      );
      return NextResponse.json(
        { error: "Failed to delete account" },
        { status: 500 },
      );
    }

    // Account row is gone (and with it, via cascade, the owner's
    // profile and every domain row). Now free up their email by
    // deleting the auth user too — best-effort: the account is
    // already torn down either way, so a failure here just means a
    // stray auth.users row with no profile, not a half-deleted state.
    const { error: deleteUserErr } = await admin.auth.admin.deleteUser(
      account.owner_user_id,
    );
    if (deleteUserErr) {
      console.error(
        "[DELETE /api/admin/accounts/:id] owner auth-user delete error:",
        deleteUserErr,
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
