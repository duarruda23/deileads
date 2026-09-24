// ============================================================
// POST /api/admin/accounts/[id]/password-reset
//
// Super Admin only. Resets the password of a client account's gestor
// (the account owner) — the one person a gestor can't be helped by
// from inside their own account. Body { mode: "link" | "email" },
// same contract as /api/account/members/[userId]/password-reset.
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import {
  createPasswordReset,
  isPasswordResetMode,
} from "@/lib/auth/password-reset";
import { supabaseAdmin } from "@/lib/platform/admin-client";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requirePlatformAdmin();

    const limit = checkRateLimit(
      `platform:passwordReset:${userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | { mode?: unknown }
      | null;
    if (!isPasswordResetMode(body?.mode)) {
      return NextResponse.json(
        { error: "'mode' must be 'link' or 'email'" },
        { status: 400 },
      );
    }

    const admin = supabaseAdmin();
    const { data: account } = await admin
      .from("accounts")
      .select("owner_user_id")
      .eq("id", id)
      .maybeSingle();
    if (!account?.owner_user_id) {
      return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
    }

    const { data: owner, error: ownerError } =
      await admin.auth.admin.getUserById(account.owner_user_id);
    const email = owner?.user?.email;
    if (ownerError || !email) {
      return NextResponse.json(
        { error: "Gestor da conta sem e-mail cadastrado" },
        { status: 404 },
      );
    }

    const origin = new URL(request.url).origin;
    const result = await createPasswordReset(email, body.mode, origin);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ success: true, link: result.link ?? null, email });
  } catch (err) {
    return toErrorResponse(err);
  }
}
