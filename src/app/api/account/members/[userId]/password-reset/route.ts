// ============================================================
// POST /api/account/members/[userId]/password-reset
//
// Gestor (admin+) resets a teammate's password. Body:
//   { mode: "link" }  → returns { link } to copy and send (WhatsApp)
//   { mode: "email" } → sends the recovery email
//
// Only for someone *below* the caller: an owner can reset any
// teammate; an admin only agents/viewers. Otherwise an admin could
// take over the owner's (or another admin's) login. Nobody resets
// themselves here — that's /forgot-password or Settings → Password.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { hasMinRole, isAccountRole } from "@/lib/auth/roles";
import {
  createPasswordReset,
  isPasswordResetMode,
} from "@/lib/auth/password-reset";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:passwordReset:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;
    const body = (await request.json().catch(() => null)) as
      | { mode?: unknown }
      | null;
    if (!isPasswordResetMode(body?.mode)) {
      return NextResponse.json(
        { error: "'mode' must be 'link' or 'email'" },
        { status: 400 },
      );
    }

    if (userId === ctx.userId) {
      return NextResponse.json(
        { error: "Use 'Esqueci minha senha' para redefinir a sua própria senha" },
        { status: 400 },
      );
    }

    const { data: target } = await ctx.supabase
      .from("profiles")
      .select("user_id, email, account_role")
      .eq("user_id", userId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!target || !target.email) {
      return NextResponse.json({ error: "Membro não encontrado" }, { status: 404 });
    }

    const targetRole = isAccountRole(target.account_role)
      ? target.account_role
      : "viewer";
    const allowed =
      ctx.role === "owner" ||
      (hasMinRole(ctx.role, "admin") && !hasMinRole(targetRole, "admin"));
    if (!allowed) {
      return NextResponse.json(
        { error: "Você não pode redefinir a senha deste membro" },
        { status: 403 },
      );
    }

    const origin = new URL(request.url).origin;
    const result = await createPasswordReset(target.email, body.mode, origin);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ success: true, link: result.link ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}
