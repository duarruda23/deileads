// ============================================================
// POST/DELETE /api/admin/accounts/invitations/[id]
//
// Super Admin only. Manages a single pending `platform_invitations`
// row (kind='new_account') — one that hasn't been redeemed yet.
//
// POST   (resend) — the plaintext token is never persisted (only its
//         hash — see 032_platform_invitations.sql), so there's no way
//         to recover the original link once the admin's dismissed it
//         or it's expired. "Resend" therefore revokes the old row and
//         creates a fresh one with a new token, same account_name/
//         label, and returns the new link — same "revoke and
//         re-issue" workaround already documented for teammate
//         invites in invite-member-dialog.tsx, just automated.
// DELETE (cancel) — revokes the invitation outright. Safe: no account
//         or auth user exists yet for a kind='new_account' invite
//         until someone actually redeems it, so this is a plain row
//         delete with no cascade to worry about.
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requirePlatformAdmin();
    const { id } = await params;

    const admin = supabaseAdmin();

    const { data: existing, error: fetchErr } = await admin
      .from("platform_invitations")
      .select("account_name, label")
      .eq("id", id)
      .eq("kind", "new_account")
      .is("accepted_at", null)
      .maybeSingle();

    if (fetchErr) {
      console.error(
        "[POST /api/admin/accounts/invitations/:id] fetch error:",
        fetchErr,
      );
      return NextResponse.json(
        { error: "Failed to load invitation" },
        { status: 500 },
      );
    }
    if (!existing) {
      return NextResponse.json(
        { error: "Invitation not found or already redeemed" },
        { status: 404 },
      );
    }

    const { token, hash } = generateInviteToken();
    const expiresAt = inviteExpiresAt(undefined); // default 7 days

    const { error: insertErr } = await admin.from("platform_invitations").insert({
      kind: "new_account",
      account_name: existing.account_name,
      label: existing.label,
      token_hash: hash,
      created_by_user_id: userId,
      expires_at: expiresAt.toISOString(),
    });

    if (insertErr) {
      console.error(
        "[POST /api/admin/accounts/invitations/:id] insert error:",
        insertErr,
      );
      return NextResponse.json(
        { error: "Failed to create the new invitation" },
        { status: 500 },
      );
    }

    // Revoke the old link only after the new one is safely created —
    // if insert had failed above, the admin still has a working link
    // rather than being left with neither.
    const { error: deleteErr } = await admin
      .from("platform_invitations")
      .delete()
      .eq("id", id);

    if (deleteErr) {
      console.error(
        "[POST /api/admin/accounts/invitations/:id] old-row delete error:",
        deleteErr,
      );
      // Not fatal — the new link works either way; the stale one just
      // lingers until it naturally expires.
    }

    return NextResponse.json({
      ok: true,
      url: inviteUrl(token, getBaseUrl(request)),
      expiresInDays: 7,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;

    const admin = supabaseAdmin();
    const { error } = await admin
      .from("platform_invitations")
      .delete()
      .eq("id", id)
      .eq("kind", "new_account")
      .is("accepted_at", null);

    if (error) {
      console.error(
        "[DELETE /api/admin/accounts/invitations/:id] delete error:",
        error,
      );
      return NextResponse.json(
        { error: "Failed to cancel invitation" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
