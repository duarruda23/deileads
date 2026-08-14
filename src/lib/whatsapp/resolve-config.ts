import type { SupabaseClient } from '@supabase/supabase-js'
import type { WhatsAppConfig } from '@/types'

/**
 * 034: whatsapp_config moved from one-row-per-account to one-row-
 * per-vendor. Every send/react/media path that used to do
 * `.eq('account_id', accountId).single()` now has to pick the RIGHT
 * vendor's row instead of assuming there's only one.
 *
 * `ownerProfileId` is a `profiles.id` value — the same id space as
 * `contacts.owner_id` / `deals.assigned_to` / `conversations.assigned_agent_id`
 * (034). `whatsapp_config.user_id`, by contrast, is an `auth.users.id`
 * (it predates 034 and was never repointed at `profiles`). This
 * helper does the profiles.id → auth.users.id translation internally
 * so every call site can just pass the owner column's value straight
 * through without re-deriving that join itself.
 *
 * Resolution order:
 *   1. The row belonging to `ownerProfileId` (the lead/conversation's
 *      assigned vendor) — keeps a customer's thread going out from
 *      the same number that's been talking to them.
 *   2. The account's primary row (`is_primary`) — covers leads with
 *      no owner yet (legacy data, or a contact created before 034)
 *      and anything sent by an admin on a vendor's behalf.
 *
 * Returns null if neither exists (account has no WhatsApp connected
 * at all) — callers already handle "no config" as a user-facing error.
 */
export async function resolveWhatsappConfigForOwner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  accountId: string,
  ownerProfileId: string | null,
): Promise<WhatsAppConfig | null> {
  if (ownerProfileId) {
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('id', ownerProfileId)
      .maybeSingle()

    if (ownerProfile?.user_id) {
      const { data } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', accountId)
        .eq('user_id', ownerProfile.user_id)
        .maybeSingle()
      if (data) return data as WhatsAppConfig
    }
  }

  const { data: primary } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_primary', true)
    .maybeSingle()

  return (primary as WhatsAppConfig) ?? null
}
