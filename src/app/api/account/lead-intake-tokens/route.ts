import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { generateLeadIntakeToken } from '@/lib/auth/lead-intake';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const MAX_LABEL_LEN = 80;

export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const { data, error } = await ctx.supabase
      .from('lead_intake_tokens')
      .select('id, label, created_at, last_used_at, revoked_at')
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /api/account/lead-intake-tokens] error:', error);
      return NextResponse.json(
        { error: 'Failed to load intake tokens' },
        { status: 500 }
      );
    }
    return NextResponse.json({ tokens: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `admin:intakeTokenCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      label?: unknown;
    } | null;
    let label: string | null = null;
    if (typeof body?.label === 'string') {
      const trimmed = body.label.trim();
      if (trimmed.length > MAX_LABEL_LEN) {
        return NextResponse.json(
          { error: `Label must be ${MAX_LABEL_LEN} characters or fewer` },
          { status: 400 }
        );
      }
      label = trimmed || null;
    }

    const { token, hash } = generateLeadIntakeToken();
    const { data, error } = await ctx.supabase
      .from('lead_intake_tokens')
      .insert({
        account_id: ctx.accountId,
        token_hash: hash,
        label,
        created_by_user_id: ctx.userId,
      })
      .select('id, label, created_at, last_used_at, revoked_at')
      .single();

    if (error || !data) {
      console.error('[POST /api/account/lead-intake-tokens] error:', error);
      return NextResponse.json(
        { error: 'Failed to create intake token' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        intakeToken: data,
        token,
        endpoint: `/api/public/leads/${ctx.accountId}`,
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
