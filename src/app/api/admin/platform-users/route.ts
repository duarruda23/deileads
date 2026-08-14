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
// POST — creates a `platform_invitations` row (kind='virgo_seller')
//        and returns a shareable `/join/<token>` link. Redeeming it
//        calls `admin_add_virgo_seller` (030) — which bootstraps
//        virgo-interno on first call — via `redeem_platform_invitation`
//        (032). No email involved: see 032_platform_invitations.sql
//        and /api/admin/accounts for why this replaced
//        `inviteUserByEmail`.
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

    const { token, hash } = generateInviteToken();
    const expiresAt = inviteExpiresAt(undefined); // default 7 days

    const admin = supabaseAdmin();
    const { error } = await admin.from("platform_invitations").insert({
      kind: "virgo_seller",
      token_hash: hash,
      // Stored so `admin_add_virgo_seller`'s first-call bootstrap
      // (which needs SOME Super Admin to own the freshly-created
      // virgo-interno account) has someone to attribute it to even
      // though the redeemer, not this admin, is the one calling it.
      created_by_user_id: actingAdminId,
      expires_at: expiresAt.toISOString(),
    });

    if (error) {
      console.error("[POST /api/admin/platform-users] insert error:", error);
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
