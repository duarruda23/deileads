import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getInstagramUserProfile } from '@/lib/instagram/meta-api';
import {
  normalizeInstagramMessage,
  type InstagramMessagingEvent,
} from '@/lib/instagram/webhook';
import { decrypt } from '@/lib/whatsapp/encryption';
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature';

interface InstagramWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: InstagramMessagingEvent[];
  }>;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mode = params.get('hub.mode');
  const challenge = params.get('hub.challenge');
  const suppliedToken = params.get('hub.verify_token');
  if (mode !== 'subscribe' || !challenge || !suppliedToken) {
    return NextResponse.json(
      { error: 'Missing verification parameters' },
      { status: 400 }
    );
  }

  const { data: configs } = await supabaseAdmin()
    .from('instagram_config')
    .select('verify_token');
  const matched = (configs ?? []).some((config) => {
    if (!config.verify_token) return false;
    try {
      return decrypt(config.verify_token) === suppliedToken;
    } catch {
      return false;
    }
  });
  if (!matched)
    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    );
  return new Response(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (
    !verifyMetaWebhookSignature(
      rawBody,
      request.headers.get('x-hub-signature-256')
    )
  ) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: InstagramWebhookBody;
  try {
    body = JSON.parse(rawBody) as InstagramWebhookBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (body.object !== 'instagram') {
    return NextResponse.json({ status: 'ignored' });
  }

  void processInstagramWebhook(body).catch((err) => {
    console.error('[instagram/webhook] processing failed:', err);
  });
  return NextResponse.json({ status: 'received' });
}

async function processInstagramWebhook(body: InstagramWebhookBody) {
  for (const entry of body.entry ?? []) {
    if (!entry.id) continue;
    let { data: config } = await supabaseAdmin()
      .from('instagram_config')
      .select('*')
      .eq('ig_business_account_id', entry.id)
      .maybeSingle();
    if (!config) {
      const byPage = await supabaseAdmin()
        .from('instagram_config')
        .select('*')
        .eq('page_id', entry.id)
        .maybeSingle();
      config = byPage.data;
    }
    if (!config) {
      console.warn('[instagram/webhook] no config for account:', entry.id);
      continue;
    }

    const { data: account } = await supabaseAdmin()
      .from('accounts')
      .select('owner_user_id, status')
      .eq('id', config.account_id)
      .maybeSingle();
    if (!account?.owner_user_id) continue;
    const suspended = account.status === 'suspended';
    const accessToken = decrypt(config.access_token);

    for (const event of entry.messaging ?? []) {
      const message = normalizeInstagramMessage(event);
      if (!message) continue;
      await persistInstagramMessage({
        message,
        accountId: config.account_id,
        ownerUserId: account.owner_user_id,
        accessToken,
        suspended,
      });
    }
  }
}

async function persistInstagramMessage(args: {
  message: NonNullable<ReturnType<typeof normalizeInstagramMessage>>;
  accountId: string;
  ownerUserId: string;
  accessToken: string;
  suspended: boolean;
}) {
  const { message, accountId, ownerUserId, accessToken } = args;
  let { data: contact } = await supabaseAdmin()
    .from('contacts')
    .select('*')
    .eq('account_id', accountId)
    .eq('instagram_user_id', message.senderId)
    .maybeSingle();

  if (!contact) {
    const profile = await getInstagramUserProfile({
      instagramScopedId: message.senderId,
      accessToken,
    });
    const { data, error } = await supabaseAdmin()
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        phone: null,
        instagram_user_id: message.senderId,
        instagram_username: profile?.username || null,
        name:
          profile?.name || profile?.username || `Instagram ${message.senderId}`,
        avatar_url: profile?.profile_picture_url || null,
      })
      .select()
      .single();
    if (error) {
      // A concurrent retry may have won the unique IGSID insert.
      const raced = await supabaseAdmin()
        .from('contacts')
        .select('*')
        .eq('account_id', accountId)
        .eq('instagram_user_id', message.senderId)
        .maybeSingle();
      contact = raced.data;
    } else contact = data;
  }
  if (!contact) return;

  let { data: conversation } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contact.id)
    .eq('channel', 'instagram')
    .maybeSingle();
  if (!conversation) {
    const created = await supabaseAdmin()
      .from('conversations')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        contact_id: contact.id,
        channel: 'instagram',
      })
      .select()
      .single();
    conversation = created.data;
  }
  if (!conversation) return;

  await ensureInstagramDeal({
    accountId,
    ownerUserId,
    contactId: contact.id,
    conversationId: conversation.id,
    title:
      contact.name ||
      contact.instagram_username ||
      `Instagram ${message.senderId}`,
  });

  let replyToId: string | null = null;
  if (message.replyToMessageId) {
    const parent = await supabaseAdmin()
      .from('messages')
      .select('id')
      .eq('conversation_id', conversation.id)
      .eq('message_id', message.replyToMessageId)
      .maybeSingle();
    replyToId = parent.data?.id || null;
  }

  const inserted = await supabaseAdmin()
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: message.contentType,
      content_text: message.contentText,
      media_url: message.mediaUrl,
      message_id: message.messageId,
      status: 'delivered',
      created_at: message.createdAt,
      reply_to_message_id: replyToId,
      interactive_reply_id:
        message.contentType === 'interactive' ? message.contentText : null,
    });
  if (inserted.error) {
    if (inserted.error.code !== '23505') {
      console.error(
        '[instagram/webhook] message insert failed:',
        inserted.error
      );
    }
    return;
  }

  await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: message.contentText || `[${message.contentType}]`,
      last_message_at: message.createdAt,
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);

  if (args.suspended) {
    console.warn(
      '[instagram/webhook] suspended account: message captured, active processing skipped',
      accountId
    );
  }
}

async function ensureInstagramDeal(args: {
  accountId: string;
  ownerUserId: string;
  contactId: string;
  conversationId: string;
  title: string;
}) {
  const existing = await supabaseAdmin()
    .from('deals')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .limit(1)
    .maybeSingle();
  if (existing.data) return;

  const pipeline = await supabaseAdmin()
    .from('pipelines')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('is_default', true)
    .maybeSingle();
  if (!pipeline.data) return;
  const stage = await supabaseAdmin()
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipeline.data.id)
    .eq('stage_type', 'open')
    .order('position')
    .limit(1)
    .maybeSingle();
  if (!stage.data) return;

  await supabaseAdmin().from('deals').insert({
    account_id: args.accountId,
    user_id: args.ownerUserId,
    pipeline_id: pipeline.data.id,
    stage_id: stage.data.id,
    contact_id: args.contactId,
    conversation_id: args.conversationId,
    title: args.title,
    source: 'instagram',
  });
}
