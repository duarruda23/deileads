import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  exchangeEmbeddedSignupCode,
  requestSmbAppDataSync,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import { encrypt } from '@/lib/whatsapp/encryption'
import { resolveCaller, resolveTargetUserId } from '@/lib/whatsapp/config-access'

// Service-role client — same reason as /api/whatsapp/config: the
// cross-account phone_number_id conflict check can't see other
// accounts' rows under RLS.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

const META_ID_RE = /^\d{5,30}$/

/**
 * POST /api/whatsapp/embedded-signup
 *
 * Body: {
 *   code: string            // FB.login authResponse.code (valid ~30s)
 *   phone_number_id: string // from the WA_EMBEDDED_SIGNUP message event
 *   waba_id: string
 *   event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' | 'FINISH'
 *   user_id?: string        // admin+ connecting a teammate's number
 * }
 *
 * Finishes Embedded Signup server-side:
 *   1. code → business token
 *   2. verify the phone number with that token
 *   3. subscribe the WABA to this app (webhooks)
 *   4. save the whatsapp_config row (token encrypted)
 *   5. coexistence only: request the one-time contacts + history sync
 *
 * Coexistence numbers come back already registered on Meta's side, so
 * /register (and the 2FA PIN) is skipped — calling it would pull the
 * number out of the WhatsApp Business app. A plain `FINISH` (new number
 * created inside the flow) is saved as a manual, not-yet-registered
 * connection; the existing "Not registered" banner + PIN path in the
 * settings form takes it from there.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const caller = await resolveCaller(supabase, user.id)
    if (!caller) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }
    const accountId = caller.accountId

    const body = await request.json().catch(() => ({}))
    const { code, phone_number_id, waba_id, event } = body as Record<string, unknown>

    if (typeof code !== 'string' || !code) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 })
    }
    if (
      typeof phone_number_id !== 'string' || !META_ID_RE.test(phone_number_id) ||
      typeof waba_id !== 'string' || !META_ID_RE.test(waba_id)
    ) {
      return NextResponse.json(
        { error: 'phone_number_id and waba_id are required' },
        { status: 400 },
      )
    }
    const isCoexistence = event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'

    const targetUserId = await resolveTargetUserId(
      supabase,
      accountId,
      user.id,
      caller.isAdmin,
      typeof body.user_id === 'string' ? body.user_id : null,
    )

    // One physical number → one whatsapp_config row, globally (013/034).
    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id, user_id')
      .eq('phone_number_id', phone_number_id)
      .maybeSingle()
    if (claimedError) {
      console.error('[embedded-signup] ownership check failed:', claimedError)
      return NextResponse.json({ error: 'Failed to validate configuration' }, { status: 500 })
    }
    if (claimed && claimed.account_id !== accountId) {
      return NextResponse.json(
        { error: 'This WhatsApp phone number is already linked to another account.' },
        { status: 409 },
      )
    }
    if (claimed && claimed.user_id !== targetUserId) {
      return NextResponse.json(
        { error: 'This WhatsApp number is already connected to a different teammate on your account.' },
        { status: 409 },
      )
    }

    let accessToken: string
    try {
      accessToken = await exchangeEmbeddedSignupCode({ code })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[embedded-signup] code exchange failed:', message)
      return NextResponse.json({ error: `Meta API error: ${message}` }, { status: 400 })
    }

    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({ phoneNumberId: phone_number_id, accessToken })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[embedded-signup] phone verification failed:', message)
      return NextResponse.json({ error: `Meta API error: ${message}` }, { status: 400 })
    }

    let subscribedAppsAt: string | null = null
    try {
      await subscribeWabaToApp({ wabaId: waba_id, accessToken })
      subscribedAppsAt = new Date().toISOString()
    } catch (err) {
      // Non-fatal, same as the manual path — Verify Registration
      // surfaces it and a re-save retries.
      console.warn(
        '[embedded-signup] subscribed_apps failed (non-fatal):',
        err instanceof Error ? err.message : err,
      )
    }

    let encryptedAccessToken: string
    try {
      encryptedAccessToken = encrypt(accessToken)
    } catch (err) {
      console.error('[embedded-signup] encryption failed:', err)
      return NextResponse.json(
        { error: 'Failed to encrypt token. Check ENCRYPTION_KEY.' },
        { status: 500 },
      )
    }

    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id, phone_number_id, smb_contacts_sync_at, smb_history_sync_at')
      .eq('account_id', accountId)
      .eq('user_id', targetUserId)
      .maybeSingle()
    const sameNumber = existing?.phone_number_id === phone_number_id

    const now = new Date().toISOString()
    // verify_token is left untouched: the webhook callback is set once
    // per app, and GET verification matches against any row's token.
    const baseRow: Record<string, unknown> = {
      phone_number_id,
      waba_id,
      access_token: encryptedAccessToken,
      status: 'connected',
      connected_at: now,
      registered_at: isCoexistence ? now : null,
      subscribed_apps_at: subscribedAppsAt,
      last_registration_error: null,
      onboarding_type: isCoexistence ? 'coexistence' : 'manual',
      updated_at: now,
    }
    if (!sameNumber) {
      baseRow.smb_contacts_sync_at = null
      baseRow.smb_history_sync_at = null
      baseRow.smb_sync_error = null
    }

    if (existing) {
      const { error } = await supabase
        .from('whatsapp_config')
        .update(baseRow)
        .eq('account_id', accountId)
        .eq('user_id', targetUserId)
      if (error) {
        console.error('[embedded-signup] update failed:', error)
        return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 })
      }
    } else {
      const { error } = await supabase
        .from('whatsapp_config')
        .insert({ account_id: accountId, user_id: targetUserId, ...baseRow })
      if (error) {
        console.error('[embedded-signup] insert failed:', error)
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
      }

      const { count: primaryCount } = await supabase
        .from('whatsapp_config')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('is_primary', true)
      if (!primaryCount) {
        await supabase
          .from('whatsapp_config')
          .update({ is_primary: true })
          .eq('account_id', accountId)
          .eq('user_id', targetUserId)
      }
    }

    // Meta only accepts each sync once, within 24h of onboarding.
    // Contacts first so history threads land on named contacts.
    const sync = { contacts: false, history: false, error: null as string | null }
    if (isCoexistence) {
      const alreadyContacts = sameNumber && existing?.smb_contacts_sync_at
      const alreadyHistory = sameNumber && existing?.smb_history_sync_at
      const syncUpdate: Record<string, unknown> = {}
      const errors: string[] = []

      for (const [syncType, done, column, key] of [
        ['smb_app_state_sync', alreadyContacts, 'smb_contacts_sync_at', 'contacts'],
        ['history', alreadyHistory, 'smb_history_sync_at', 'history'],
      ] as const) {
        if (done) {
          sync[key] = true
          continue
        }
        try {
          await requestSmbAppDataSync({ phoneNumberId: phone_number_id, accessToken, syncType })
          syncUpdate[column] = new Date().toISOString()
          sync[key] = true
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.error(`[embedded-signup] ${syncType} sync request failed:`, message)
          errors.push(`${syncType}: ${message}`)
        }
      }

      sync.error = errors.length ? errors.join(' | ') : null
      syncUpdate.smb_sync_error = sync.error
      await supabase
        .from('whatsapp_config')
        .update(syncUpdate)
        .eq('account_id', accountId)
        .eq('user_id', targetUserId)
    }

    return NextResponse.json({
      success: true,
      coexistence: isCoexistence,
      registered: isCoexistence,
      subscribed: subscribedAppsAt != null,
      sync,
      phone_info: phoneInfo,
    })
  } catch (error) {
    console.error('Error in WhatsApp embedded-signup POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
