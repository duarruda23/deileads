import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { sendInstagramText } from '@/lib/instagram/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = (await request.json().catch(() => null)) as {
      conversation_id?: unknown;
      content_text?: unknown;
    } | null;
    const conversationId =
      typeof body?.conversation_id === 'string' ? body.conversation_id : '';
    const text =
      typeof body?.content_text === 'string' ? body.content_text.trim() : '';
    if (!conversationId || !text) {
      return NextResponse.json(
        { error: 'conversation_id and content_text are required' },
        { status: 400 }
      );
    }

    const { data: conversation } = await ctx.supabase
      .from('conversations')
      .select('id, channel, contact:contacts(id, instagram_user_id)')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    const contact = Array.isArray(conversation?.contact)
      ? conversation.contact[0]
      : conversation?.contact;
    if (
      !conversation ||
      conversation.channel !== 'instagram' ||
      !contact?.instagram_user_id
    ) {
      return NextResponse.json(
        { error: 'Instagram conversation not found' },
        { status: 404 }
      );
    }

    const { data: config } = await ctx.supabase
      .from('instagram_config')
      .select('page_id, ig_business_account_id, access_token, status')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!config || config.status !== 'connected') {
      return NextResponse.json(
        { error: 'Instagram is not connected' },
        { status: 400 }
      );
    }

    let sent;
    try {
      sent = await sendInstagramText({
        instagramAccountId: config.ig_business_account_id,
        pageId: config.page_id || undefined,
        recipientId: contact.instagram_user_id,
        accessToken: decrypt(config.access_token),
        text,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Instagram send failed' },
        { status: 502 }
      );
    }

    const { data: message, error } = await ctx.supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: 'text',
        content_text: text,
        message_id: sent.messageId,
        status: 'sent',
      })
      .select()
      .single();
    if (error || !message) {
      return NextResponse.json(
        { error: 'Message reached Instagram but could not be saved locally' },
        { status: 500 }
      );
    }

    await ctx.supabase
      .from('conversations')
      .update({
        last_message_text: text,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    // A human reply pauses any WhatsApp-oriented flow attached to the same
    // contact, avoiding a bot response after the agent has taken over.
    await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', ctx.accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'active');

    return NextResponse.json({ success: true, message_id: message.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
