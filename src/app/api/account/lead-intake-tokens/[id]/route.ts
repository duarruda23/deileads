import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `admin:intakeTokenRevoke:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from('lead_intake_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error(
        '[DELETE /api/account/lead-intake-tokens/[id]] error:',
        error
      );
      return NextResponse.json(
        { error: 'Failed to revoke intake token' },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: 'Intake token not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
