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
//        exist at the DB level. Also returns `pendingInvitations` —
//        `platform_invitations` (kind='new_account') rows that
//        haven't been redeemed yet, so the admin can see, resend, or
//        cancel a link that hasn't been claimed (see
//        /api/admin/accounts/invitations/[id]).
// POST — creates a `platform_invitations` row (kind='new_account')
//        and returns a shareable `/join/<token>` link, same shape as
//        `/api/account/invitations`. The admin copies/sends it
//        themselves (WhatsApp, etc). The account itself doesn't
//        exist yet — it's created at redeem time by
//        `redeem_platform_invitation` (032), once someone actually
//        holds the link and sets their own password.
//
//        Previously this called `supabase.auth.admin.inviteUserByEmail`
//        to create the user immediately and have Supabase email them
//        a set-password link. That depends on outbound email, which
//        isn't configured for this project — invites were created
//        but the email never arrived, leaving the invitee stuck on
//        the plain login screen with no way in. See
//        032_platform_invitations.sql for the full writeup.
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import {
  generateInviteToken,
  getBaseUrl,
  inviteExpiresAt,
  inviteUrl,
} from "@/lib/auth/invitations";
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

    const { data: pendingInvitations, error: pendingErr } = await supabase
      .from("platform_invitations")
      .select("id, account_name, label, created_at, expires_at")
      .eq("kind", "new_account")
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    if (pendingErr) {
      console.error(
        "[GET /api/admin/accounts] pending invitations fetch error:",
        pendingErr,
      );
    }

    return NextResponse.json({
      accounts: accounts.map((a) => ({
        ...a,
        owner: ownerById.get(a.owner_user_id) ?? null,
      })),
      pendingInvitations: pendingInvitations ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requirePlatformAdmin();

    const { accountName } = await request.json();
    if (!accountName || typeof accountName !== "string") {
      return NextResponse.json(
        { error: "accountName is required" },
        { status: 400 },
      );
    }

    const { token, hash } = generateInviteToken();
    const expiresAt = inviteExpiresAt(undefined); // default 7 days

    const admin = supabaseAdmin();
    const { error } = await admin.from("platform_invitations").insert({
      kind: "new_account",
      account_name: accountName,
      token_hash: hash,
      created_by_user_id: userId,
      expires_at: expiresAt.toISOString(),
    });

    if (error) {
      console.error("[POST /api/admin/accounts] insert error:", error);
      return NextResponse.json(
        { error: "Failed to create invitation" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { ok: true, url: inviteUrl(token, getBaseUrl(request)), expiresInDays: 7 },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
