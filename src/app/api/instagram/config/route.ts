import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  subscribeInstagramWebhooks,
  verifyInstagramAccount,
} from '@/lib/instagram/meta-api';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const { data: config, error } = await ctx.supabase
      .from('instagram_config')
      .select(
        'id, page_id, ig_business_account_id, access_token, status, connected_at, subscribed_apps_at, last_registration_error'
      )
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[instagram/config GET] database error:', error);
      return NextResponse.json(
        { error: 'Failed to load Instagram configuration' },
        { status: 500 }
      );
    }
    if (!config)
      return NextResponse.json({ connected: false, reason: 'no_config' });

    try {
      const account = await verifyInstagramAccount({
        instagramAccountId: config.ig_business_account_id,
        accessToken: decrypt(config.access_token),
      });
      return NextResponse.json({
        connected: true,
        config: {
          page_id: config.page_id,
          ig_business_account_id: config.ig_business_account_id,
          status: config.status,
          connected_at: config.connected_at,
          subscribed_apps_at: config.subscribed_apps_at,
          last_registration_error: config.last_registration_error,
        },
        account,
      });
    } catch (err) {
      return NextResponse.json({
        connected: false,
        reason: 'meta_api_error',
        config: {
          page_id: config.page_id,
          ig_business_account_id: config.ig_business_account_id,
          status: config.status,
        },
        message:
          err instanceof Error ? err.message : 'Meta rejected the credentials',
      });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json().catch(() => null)) as {
      page_id?: unknown;
      ig_business_account_id?: unknown;
      access_token?: unknown;
      verify_token?: unknown;
    } | null;

    const instagramAccountId =
      typeof body?.ig_business_account_id === 'string'
        ? body.ig_business_account_id.trim()
        : '';
    const accessToken =
      typeof body?.access_token === 'string' ? body.access_token.trim() : '';
    const verifyToken =
      typeof body?.verify_token === 'string' ? body.verify_token.trim() : '';
    const pageId = typeof body?.page_id === 'string' ? body.page_id.trim() : '';

    if (!instagramAccountId || !accessToken || !verifyToken) {
      return NextResponse.json(
        {
          error:
            'Instagram Account ID, Access Token, and Verify Token are required',
        },
        { status: 400 }
      );
    }

    const { data: claimed } = await supabaseAdmin()
      .from('instagram_config')
      .select('account_id')
      .eq('ig_business_account_id', instagramAccountId)
      .neq('account_id', ctx.accountId)
      .maybeSingle();
    if (claimed) {
      return NextResponse.json(
        {
          error:
            'This Instagram account is already connected to another CRM account',
        },
        { status: 409 }
      );
    }

    let accountInfo;
    try {
      accountInfo = await verifyInstagramAccount({
        instagramAccountId,
        accessToken,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : 'Invalid Instagram credentials',
        },
        { status: 400 }
      );
    }

    let subscriptionError: string | null = null;
    let subscribedAt: string | null = null;
    try {
      await subscribeInstagramWebhooks({
        instagramAccountId,
        pageId: pageId || undefined,
        accessToken,
      });
      subscribedAt = new Date().toISOString();
    } catch (err) {
      subscriptionError =
        err instanceof Error ? err.message : 'Failed to subscribe webhooks';
    }

    let encryptedAccessToken: string;
    let encryptedVerifyToken: string;
    try {
      encryptedAccessToken = encrypt(accessToken);
      encryptedVerifyToken = encrypt(verifyToken);
    } catch {
      return NextResponse.json(
        { error: 'Failed to encrypt credentials. Check ENCRYPTION_KEY.' },
        { status: 500 }
      );
    }

    const row = {
      account_id: ctx.accountId,
      page_id: pageId,
      ig_business_account_id: instagramAccountId,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      status: subscriptionError ? 'disconnected' : 'connected',
      connected_at: subscriptionError ? null : new Date().toISOString(),
      subscribed_apps_at: subscribedAt,
      last_registration_error: subscriptionError,
    };
    const { error } = await ctx.supabase
      .from('instagram_config')
      .upsert(row, { onConflict: 'account_id' });
    if (error) {
      console.error('[instagram/config POST] upsert error:', error);
      return NextResponse.json(
        { error: 'Failed to save Instagram configuration' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: !subscriptionError,
      saved: true,
      subscribed: !subscriptionError,
      subscription_error: subscriptionError,
      account: accountInfo,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole('admin');
    const { error } = await ctx.supabase
      .from('instagram_config')
      .delete()
      .eq('account_id', ctx.accountId);
    if (error) {
      return NextResponse.json(
        { error: 'Failed to disconnect Instagram' },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
