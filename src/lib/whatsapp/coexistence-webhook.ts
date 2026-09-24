import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'

/**
 * Webhook fields only coexistence numbers (WhatsApp Business app +
 * Cloud API on the same number) receive:
 *
 *   smb_message_echoes  — a message the business sent from the phone
 *                         app. Mirrored into the inbox as an agent
 *                         message so the CRM thread stays complete.
 *   history             — the one-time chat history import (up to 6
 *                         months) requested after onboarding. Arrives
 *                         in chunks; may instead carry an error when the
 *                         business declined history sharing.
 *   smb_app_state_sync  — the phone's contact book (add / edit /
 *                         remove). Adds and edits upsert contacts;
 *                         removals are ignored — the CRM never deletes
 *                         a contact because it left the phone.
 *
 * None of these create Kanban cards or fire automations/flows: they
 * are data mirroring, not new customer activity. A customer's next
 * real inbound message goes through the regular `messages` path,
 * which creates the card as usual.
 */

export const COEXISTENCE_WEBHOOK_FIELDS = [
  'smb_message_echoes',
  'history',
  'smb_app_state_sync',
] as const
export type CoexistenceWebhookField = (typeof COEXISTENCE_WEBHOOK_FIELDS)[number]

export function isCoexistenceWebhookField(field: string): field is CoexistenceWebhookField {
  return (COEXISTENCE_WEBHOOK_FIELDS as readonly string[]).includes(field)
}

/** Message shape shared by echoes and history (same as inbound). */
export interface CoexistenceMessage {
  id: string
  from?: string
  to?: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; caption?: string }
  video?: { id: string; caption?: string }
  document?: { id: string; filename?: string; caption?: string }
  audio?: { id: string }
  sticker?: { id: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  history_context?: { status?: string }
}

interface CoexistenceValue {
  metadata?: { display_phone_number?: string; phone_number_id?: string }
  message_echoes?: CoexistenceMessage[]
  history?: Array<{
    metadata?: { phase?: number; chunk_order?: number; progress?: number }
    threads?: Array<{ id: string; messages?: CoexistenceMessage[] }>
    errors?: Array<{ code?: number; title?: string; message?: string }>
  }>
  state_sync?: Array<{
    type?: string
    action?: string
    contact?: { full_name?: string; first_name?: string; phone_number?: string }
  }>
}

/** One message ready to insert, tied to the customer it belongs to. */
export interface MirroredMessage {
  customerPhone: string
  senderType: 'customer' | 'agent'
  metaMessageId: string
  contentType: string
  contentText: string | null
  mediaUrl: string | null
  status: 'sent' | 'delivered' | 'read' | 'failed'
  createdAt: string
}

const ALLOWED_CONTENT_TYPES = new Set([
  'text', 'image', 'document', 'audio', 'video', 'location', 'template', 'interactive',
])

const MIRROR_STATUSES = new Set(['sent', 'delivered', 'read', 'failed'])

function toIso(timestamp: string): string {
  const seconds = parseInt(timestamp, 10)
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : new Date().toISOString()
}

/**
 * Map a mirrored message to what the messages table stores. Media is
 * NOT verified against Meta here (unlike live inbound) — a history
 * import can carry thousands of items, and the media proxy already
 * resolves the id lazily when the bubble is opened.
 */
export function mapMirroredContent(message: CoexistenceMessage): {
  contentType: string
  contentText: string | null
  mediaUrl: string | null
} {
  const media = (id?: string) => (id ? `/api/whatsapp/media/${id}` : null)
  switch (message.type) {
    case 'text':
      return { contentType: 'text', contentText: message.text?.body ?? null, mediaUrl: null }
    case 'image':
      return { contentType: 'image', contentText: message.image?.caption ?? null, mediaUrl: media(message.image?.id) }
    case 'video':
      return { contentType: 'video', contentText: message.video?.caption ?? null, mediaUrl: media(message.video?.id) }
    case 'document':
      return {
        contentType: 'document',
        contentText: message.document?.caption ?? message.document?.filename ?? null,
        mediaUrl: media(message.document?.id),
      }
    case 'audio':
      return { contentType: 'audio', contentText: null, mediaUrl: media(message.audio?.id) }
    case 'sticker':
      return { contentType: 'image', contentText: null, mediaUrl: media(message.sticker?.id) }
    case 'location': {
      const loc = message.location
      const text = loc
        ? [loc.name, loc.address, `${loc.latitude},${loc.longitude}`].filter(Boolean).join(' - ')
        : null
      return { contentType: 'location', contentText: text, mediaUrl: null }
    }
    default:
      return {
        contentType: ALLOWED_CONTENT_TYPES.has(message.type) ? message.type : 'text',
        contentText: `[${message.type}]`,
        mediaUrl: null,
      }
  }
}

/** Echoes: messages the business sent from the phone app. */
export function extractEchoMessages(value: CoexistenceValue): MirroredMessage[] {
  const out: MirroredMessage[] = []
  for (const m of value.message_echoes ?? []) {
    const customerPhone = normalizePhone(m.to ?? '')
    if (!m.id || !customerPhone) continue
    out.push({
      customerPhone,
      senderType: 'agent',
      metaMessageId: m.id,
      ...mapMirroredContent(m),
      status: 'sent',
      createdAt: toIso(m.timestamp),
    })
  }
  return out
}

/**
 * History chunks: each thread is one customer (thread id = their
 * number). A message is outbound when `from` is the business number.
 */
export function extractHistoryMessages(value: CoexistenceValue): MirroredMessage[] {
  const businessPhone = normalizePhone(value.metadata?.display_phone_number ?? '')
  const out: MirroredMessage[] = []
  for (const chunk of value.history ?? []) {
    for (const thread of chunk.threads ?? []) {
      const customerPhone = normalizePhone(thread.id)
      if (!customerPhone) continue
      for (const m of thread.messages ?? []) {
        if (!m.id) continue
        const fromBusiness = businessPhone !== '' && normalizePhone(m.from ?? '') === businessPhone
        const historyStatus = (m.history_context?.status ?? '').toLowerCase()
        out.push({
          customerPhone,
          senderType: fromBusiness ? 'agent' : 'customer',
          metaMessageId: m.id,
          ...mapMirroredContent(m),
          status: MIRROR_STATUSES.has(historyStatus)
            ? (historyStatus as MirroredMessage['status'])
            : fromBusiness ? 'sent' : 'delivered',
          createdAt: toIso(m.timestamp),
        })
      }
    }
  }
  return out
}

/** History errors, e.g. 2593109 "History sync is turned off by business". */
export function extractHistoryErrors(value: CoexistenceValue): string[] {
  const out: string[] = []
  for (const chunk of value.history ?? []) {
    for (const e of chunk.errors ?? []) {
      out.push(`${e.code ?? '?'}: ${e.message ?? e.title ?? 'unknown error'}`)
    }
  }
  return out
}

/** Contact-book adds/edits. Removals are dropped on purpose. */
export function extractStateSyncContacts(
  value: CoexistenceValue,
): Array<{ phone: string; name: string | null }> {
  const out: Array<{ phone: string; name: string | null }> = []
  for (const item of value.state_sync ?? []) {
    if (item.type !== 'contact' || item.action === 'remove') continue
    const phone = normalizePhone(item.contact?.phone_number ?? '')
    if (!phone) continue
    const name = item.contact?.full_name || item.contact?.first_name || null
    out.push({ phone, name })
  }
  return out
}

// ============================================================
// Persistence
// ============================================================

interface ConfigRow {
  id: string
  account_id: string
  user_id: string
}

interface Ctx {
  db: SupabaseClient
  config: ConfigRow
  ownerProfileId: string | null
}

async function findOrCreateContact(
  ctx: Ctx,
  phone: string,
  name: string | null,
): Promise<{ id: string; name?: string | null; phone: string } | null> {
  const existing = await findExistingContact(ctx.db, ctx.config.account_id, phone)
  if (existing) return existing

  const { data, error } = await ctx.db
    .from('contacts')
    .insert({
      account_id: ctx.config.account_id,
      user_id: ctx.config.user_id,
      owner_id: ctx.ownerProfileId,
      phone,
      name: name || phone,
    })
    .select()
    .single()
  if (error) {
    if (isUniqueViolation(error)) {
      return findExistingContact(ctx.db, ctx.config.account_id, phone)
    }
    console.error('[coexistence] contact insert failed:', error.message)
    return null
  }
  return data
}

async function findOrCreateConversation(
  ctx: Ctx,
  contactId: string,
): Promise<{ id: string; last_message_at: string | null } | null> {
  const { data: existing } = await ctx.db
    .from('conversations')
    .select('id, last_message_at')
    .eq('account_id', ctx.config.account_id)
    .eq('contact_id', contactId)
    .maybeSingle()
  if (existing) return existing

  const { data, error } = await ctx.db
    .from('conversations')
    .insert({
      account_id: ctx.config.account_id,
      user_id: ctx.config.user_id,
      assigned_agent_id: ctx.ownerProfileId,
      contact_id: contactId,
    })
    .select('id, last_message_at')
    .single()
  if (error) {
    console.error('[coexistence] conversation insert failed:', error.message)
    return null
  }
  return data
}

/**
 * Insert mirrored messages grouped by customer. Idempotent on
 * (conversation_id, message_id) — Meta redelivers webhooks, and a
 * history chunk may overlap live echoes. Bumps the conversation's
 * last message only when the mirrored one is newer; never touches
 * unread_count (the business already saw these on the phone).
 */
async function persistMirroredMessages(ctx: Ctx, messages: MirroredMessage[]) {
  const byCustomer = new Map<string, MirroredMessage[]>()
  for (const m of messages) {
    const list = byCustomer.get(m.customerPhone) ?? []
    list.push(m)
    byCustomer.set(m.customerPhone, list)
  }

  for (const [phone, list] of byCustomer) {
    const contact = await findOrCreateContact(ctx, phone, null)
    if (!contact) continue
    const conversation = await findOrCreateConversation(ctx, contact.id)
    if (!conversation) continue

    const ids = list.map((m) => m.metaMessageId)
    const { data: already } = await ctx.db
      .from('messages')
      .select('message_id')
      .eq('conversation_id', conversation.id)
      .in('message_id', ids)
    const seen = new Set((already ?? []).map((r: { message_id: string }) => r.message_id))
    const fresh = list.filter((m) => {
      if (seen.has(m.metaMessageId)) return false
      seen.add(m.metaMessageId)
      return true
    })
    if (fresh.length === 0) continue

    const { error } = await ctx.db.from('messages').insert(
      fresh.map((m) => ({
        conversation_id: conversation.id,
        sender_type: m.senderType,
        content_type: m.contentType,
        content_text: m.contentText,
        media_url: m.mediaUrl,
        message_id: m.metaMessageId,
        status: m.status,
        created_at: m.createdAt,
      })),
    )
    if (error) {
      console.error('[coexistence] message insert failed:', error.message)
      continue
    }

    const newest = fresh.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
    const current = conversation.last_message_at
    if (!current || newest.createdAt > new Date(current).toISOString()) {
      await ctx.db
        .from('conversations')
        .update({
          last_message_text: newest.contentText || `[${newest.contentType}]`,
          last_message_at: newest.createdAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversation.id)
    }
  }
}

async function persistStateSyncContacts(
  ctx: Ctx,
  contacts: Array<{ phone: string; name: string | null }>,
) {
  for (const c of contacts) {
    const existing = await findExistingContact(ctx.db, ctx.config.account_id, c.phone)
    if (!existing) {
      await findOrCreateContact(ctx, c.phone, c.name)
      continue
    }
    // The phone's address-book name only fills a blank — it never
    // overwrites a name someone typed in the CRM.
    const currentName = (existing.name ?? '').trim()
    const placeholder = !currentName || normalizePhone(currentName) === normalizePhone(existing.phone)
    if (c.name && placeholder) {
      await ctx.db
        .from('contacts')
        .update({ name: c.name, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
  }
}

/**
 * Entry point from the WhatsApp webhook route for the three
 * coexistence fields. Never throws — a failure logs and the route
 * still acks 200 so Meta doesn't retry-storm a history import.
 */
export async function handleCoexistenceWebhookChange(
  change: { field: CoexistenceWebhookField; value: unknown },
  db: SupabaseClient,
): Promise<void> {
  try {
    const value = (change.value ?? {}) as CoexistenceValue
    const phoneNumberId = value.metadata?.phone_number_id
    if (!phoneNumberId) return

    const { data: config } = await db
      .from('whatsapp_config')
      .select('id, account_id, user_id')
      .eq('phone_number_id', phoneNumberId)
      .maybeSingle()
    if (!config) {
      console.warn('[coexistence] no config for phone_number_id:', phoneNumberId)
      return
    }

    const { data: profile } = await db
      .from('profiles')
      .select('id')
      .eq('user_id', config.user_id)
      .eq('account_id', config.account_id)
      .maybeSingle()
    const ctx: Ctx = { db, config, ownerProfileId: profile?.id ?? null }

    switch (change.field) {
      case 'smb_message_echoes':
        await persistMirroredMessages(ctx, extractEchoMessages(value))
        return
      case 'history': {
        const errors = extractHistoryErrors(value)
        if (errors.length > 0) {
          await db
            .from('whatsapp_config')
            .update({ smb_sync_error: `history: ${errors.join(' | ')}` })
            .eq('id', config.id)
        }
        await persistMirroredMessages(ctx, extractHistoryMessages(value))
        return
      }
      case 'smb_app_state_sync':
        await persistStateSyncContacts(ctx, extractStateSyncContacts(value))
        return
    }
  } catch (err) {
    console.error('[coexistence] webhook handling failed:', err)
  }
}
