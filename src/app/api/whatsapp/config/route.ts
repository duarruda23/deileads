import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

/**
 * Resolve the caller's account_id + account_role from their profile.
 * Inlined here (rather than going through `@/lib/auth/account.getCurrentAccount`)
 * because the GET handler wants to return shaped 200s for every
 * non-auth failure mode, not throw — keeping the helper minimal lets
 * the existing response branches stay as-is.
 *
 * Returns null if the user has no profile or no account; callers
 * should treat that the same as "not connected".
 */
async function resolveCaller(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ accountId: string; isAdmin: boolean } | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return {
    accountId: data.account_id as string,
    isAdmin: data.account_role === 'owner' || data.account_role === 'admin',
  }
}

/**
 * 034: whatsapp_config moved from one-row-per-account to one-row-
 * per-vendor (UNIQUE(account_id, user_id)). Every handler below now
 * resolves a *target* user_id — the caller's own by default, or
 * another account member's if the caller is admin+ and passes one
 * explicitly (`?userId=` on GET/DELETE, `user_id` in the POST body).
 * A non-admin who tries to target someone else silently falls back
 * to their own row rather than erroring — same "fail to your own
 * scope" posture as the rest of the 034 access model.
 */
async function resolveTargetUserId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  callerId: string,
  isAdmin: boolean,
  requestedUserId: string | null,
): Promise<string> {
  if (!isAdmin || !requestedUserId || requestedUserId === callerId) return callerId
  const { data } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .eq('user_id', requestedUserId)
    .maybeSingle()
  return data?.user_id ?? callerId
}

// Lazy-initialised service-role client. We need it to detect a
// phone_number_id already claimed by a *different* account — under
// RLS, the user's own session can't see other accounts' rows, so the
// conflict would be invisible without the service role.
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

/**
 * GET /api/whatsapp/config?userId=<optional>
 *
 * Used by the "Test API Connection" button and by the settings list
 * to check whether one vendor's connection is healthy. Defaults to
 * the caller's own row; admins may pass `?userId=` to check a
 * teammate's. Returns 200 in all non-auth cases so the UI can render
 * an appropriate message rather than show a 500.
 *
 * Response shape:
 *   { connected: true,  phone_info: {...} }
 *   { connected: false, reason: 'no_config',        message: '...' }
 *   { connected: false, reason: 'token_corrupted',  message: '...', needs_reset: true }
 *   { connected: false, reason: 'meta_api_error',   message: '...' }
 */
export async function GET(request: Request) {
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
        {
          connected: false,
          reason: 'no_account',
          message: 'Your profile is not linked to an account.',
        },
        { status: 200 },
      )
    }

    const { searchParams } = new URL(request.url)
    const targetUserId = await resolveTargetUserId(
      supabase,
      caller.accountId,
      user.id,
      caller.isAdmin,
      searchParams.get('userId'),
    )

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token, status')
      .eq('account_id', caller.accountId)
      .eq('user_id', targetUserId)
      .maybeSingle()

    if (configError) {
      console.error('Error fetching whatsapp_config:', configError)
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 }
      )
    }

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      )
    }

    // Try to decrypt the stored token with the current ENCRYPTION_KEY.
    // If this fails, the key changed (or was never consistent across envs).
    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('[whatsapp/config GET] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments (local vs Hostinger vs Vercel). Click "Reset Configuration" below, then re-save.',
        },
        { status: 200 }
      )
    }

    // Validate credentials against Meta
    try {
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      })
      return NextResponse.json({ connected: true, phone_info: phoneInfo })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[whatsapp/config GET] Meta API verification failed:', message)
      return NextResponse.json(
        {
          connected: false,
          reason: 'meta_api_error',
          message: `Meta API rejected the credentials: ${message}`,
        },
        { status: 200 }
      )
    }
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/whatsapp/config
 *
 * Saves or updates one vendor's WhatsApp config. Body may include
 * `user_id` to target a teammate's row — honored only for admin+
 * callers (see resolveTargetUserId), otherwise ignored in favor of
 * the caller's own id. Verifies credentials with Meta first, then
 * encrypts and stores.
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

    const body = await request.json()
    const { phone_number_id, waba_id, access_token, verify_token, pin } = body
    const targetUserId = await resolveTargetUserId(
      supabase,
      accountId,
      user.id,
      caller.isAdmin,
      typeof body.user_id === 'string' ? body.user_id : null,
    )

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: 'access_token and phone_number_id are required' },
        { status: 400 }
      )
    }

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json(
          { error: 'PIN must be exactly 6 digits.' },
          { status: 400 }
        )
      }
    }

    // Reject if another account has already claimed this phone_number_id.
    // A single physical number can only ever back one whatsapp_config row
    // globally (migration 013) — letting two accounts (or two vendors
    // within different accounts) bind the same number causes the
    // webhook's `.eq('phone_number_id', ...)` lookup to see >1 row and
    // drop the message. See issue #136.
    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phone_number_id)
      .neq('account_id', accountId)
      .maybeSingle()

    if (claimedError) {
      console.error('Error checking phone_number_id ownership:', claimedError)
      return NextResponse.json(
        { error: 'Failed to validate configuration' },
        { status: 500 }
      )
    }

    if (claimed) {
      return NextResponse.json(
        {
          error:
            'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one wacrm user.',
        },
        { status: 409 }
      )
    }

    // Same check, scoped to *this* account: another vendor on the same
    // team already claimed this number. 034 allows multiple numbers
    // per account, but never the same number twice.
    const { data: claimedWithinAccount, error: withinAccountError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('user_id')
      .eq('phone_number_id', phone_number_id)
      .eq('account_id', accountId)
      .neq('user_id', targetUserId)
      .maybeSingle()

    if (withinAccountError) {
      console.error('Error checking phone_number_id ownership (same account):', withinAccountError)
      return NextResponse.json(
        { error: 'Failed to validate configuration' },
        { status: 500 }
      )
    }

    if (claimedWithinAccount) {
      return NextResponse.json(
        { error: 'This WhatsApp number is already connected to a different teammate on your account.' },
        { status: 409 }
      )
    }

    // Verify credentials with Meta BEFORE saving
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken: access_token,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Meta API verification failed during save:', message)
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 400 }
      )
    }

    // Encrypt sensitive tokens before storing
    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null
    try {
      encryptedAccessToken = encrypt(access_token)
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('Encryption failed:', message)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
        },
        { status: 500 }
      )
    }

    // Look up any pre-existing row for this vendor so we know whether
    // this number is already registered with Meta — if so we can skip
    // /register when the user didn't provide a PIN this time around.
    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id, registered_at, phone_number_id, is_primary')
      .eq('account_id', accountId)
      .eq('user_id', targetUserId)
      .maybeSingle()

    const sameNumber =
      existing?.phone_number_id === phone_number_id &&
      existing?.registered_at != null

    // Step 1: register the phone number for inbound webhooks.
    //
    // Attempted on first save AND whenever the user supplies a fresh
    // PIN (e.g. they rotated the 2FA PIN in Meta Manager). Skipped
    // when the same number is already registered and no PIN was
    // supplied — re-registering an already-active number with a
    // stale PIN would actually fail and undo the active subscription.
    let registeredAt: string | null = existing?.registered_at ?? null
    let registrationError: string | null = null
    // True when registration was deliberately skipped because no PIN
    // was supplied (see below). Distinct from registrationError — this
    // is not a failure, just an incomplete-but-valid save.
    let registrationSkipped = false

    const needsRegistration = !sameNumber || (typeof pin === 'string' && pin.length > 0)
    if (needsRegistration) {
      if (!pin) {
        // No PIN provided. Meta TEST numbers (Developer Console) are
        // pre-registered by Meta and expose no two-step verification
        // PIN to set, so requiring one made them impossible to connect
        // (issue #242). The /register + PIN step only matters for
        // production numbers under a shared WABA (issue #136), so treat
        // it as best-effort: skip it, save the (already Meta-verified)
        // credentials as connected, and leave registered_at null. The
        // UI surfaces a separate "Not registered" banner with a path to
        // add a PIN later for users who do need inbound webhook routing.
        registrationSkipped = true
      } else {
        try {
          await registerPhoneNumber({
            phoneNumberId: phone_number_id,
            accessToken: access_token,
            pin,
          })
          registeredAt = new Date().toISOString()
        } catch (err) {
          registrationError =
            err instanceof Error ? err.message : 'Unknown Meta API error'
          console.error('Phone number /register failed:', registrationError)
          // We deliberately fall through and still save the row so the
          // user can retry without re-entering everything. The UI
          // surfaces `last_registration_error` so they see WHY it's
          // not actually live yet.
        }
      }
    }

    // Step 2: subscribe the WABA to this app. Idempotent on Meta's
    // side, so we call on every save and persist the timestamp.
    // Skipped only when there's no waba_id (legacy rows from before
    // we required it).
    let subscribedAppsAt: string | null = null
    if (waba_id) {
      try {
        await subscribeWabaToApp({
          wabaId: waba_id,
          accessToken: access_token,
        })
        subscribedAppsAt = new Date().toISOString()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('WABA subscribed_apps failed (non-fatal):', message)
        // Subscription failures are rare once the App has the right
        // permissions; we don't block save on them — the diagnostic
        // endpoint surfaces this state too.
      }
    }

    // Persist everything in one shot. If /register failed we still
    // store the credentials and the error so the UI can guide the
    // user through a retry.
    const baseRow = {
      phone_number_id,
      waba_id: waba_id || null,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      status: registrationError ? 'disconnected' : 'connected',
      connected_at: registrationError ? null : new Date().toISOString(),
      registered_at: registrationError ? null : registeredAt,
      subscribed_apps_at: subscribedAppsAt ?? null,
      last_registration_error: registrationError,
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update(baseRow)
        .eq('account_id', accountId)
        .eq('user_id', targetUserId)

      if (updateError) {
        console.error('Error updating whatsapp_config:', updateError)
        return NextResponse.json(
          { error: 'Failed to update configuration' },
          { status: 500 }
        )
      }
    } else {
      // First connection for this vendor. is_primary defaults false —
      // an account's very first-ever connection is promoted to primary
      // separately (see the primary-promotion block below), and every
      // subsequent vendor connection stays non-primary until an admin
      // explicitly changes it (PATCH, not implemented in this route —
      // see the settings list UI).
      const { error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({
          account_id: accountId,
          user_id: targetUserId,
          ...baseRow,
        })

      if (insertError) {
        console.error('Error inserting whatsapp_config:', insertError)
        return NextResponse.json(
          { error: 'Failed to save configuration' },
          { status: 500 }
        )
      }

      // If this account has no primary yet (e.g. its only-ever row was
      // just deleted, or this really is the first connection), make
      // this one primary so broadcasts/templates have a number to use.
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

    if (registrationError) {
      // Save succeeded but the number isn't actually live. Return
      // 200 with a structured error so the UI can show the specific
      // remediation step instead of a generic toast.
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        registration_error: registrationError,
        phone_info: phoneInfo,
      })
    }

    return NextResponse.json({
      success: true,
      saved: true,
      registered: registeredAt != null,
      // Credentials are valid and saved, but inbound webhook
      // registration was skipped because no PIN was supplied (e.g. a
      // Meta test number). The UI shows the "Not registered" banner
      // rather than claiming the number is fully live.
      registration_skipped: registrationSkipped,
      phone_info: phoneInfo,
    })
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/config?userId=<optional>
 *
 * Removes one vendor's WhatsApp configuration row (default: the
 * caller's own; admins may target `?userId=`). Used by the "Reset
 * Configuration" button to recover from a corrupted encrypted token
 * (mismatched ENCRYPTION_KEY across environments), or to disconnect
 * a vendor who's leaving.
 */
export async function DELETE(request: Request) {
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

    const { searchParams } = new URL(request.url)
    const targetUserId = await resolveTargetUserId(
      supabase,
      caller.accountId,
      user.id,
      caller.isAdmin,
      searchParams.get('userId'),
    )

    const { data: deletedRow, error: deleteError } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', caller.accountId)
      .eq('user_id', targetUserId)
      .select('is_primary')
      .maybeSingle()

    if (deleteError) {
      console.error('Error deleting whatsapp_config:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete configuration' },
        { status: 500 }
      )
    }

    // Deleting the primary number leaves broadcasts/templates with
    // nothing to send from — promote whichever connection remains
    // (oldest first) so the account isn't silently stuck.
    if (deletedRow?.is_primary) {
      const { data: next } = await supabase
        .from('whatsapp_config')
        .select('user_id')
        .eq('account_id', caller.accountId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (next) {
        await supabase
          .from('whatsapp_config')
          .update({ is_primary: true })
          .eq('account_id', caller.accountId)
          .eq('user_id', next.user_id)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/whatsapp/config
 *
 * Body: { user_id: string, is_primary: true }
 *
 * Admin+ only: designates which vendor's connection Broadcasts and
 * Message Templates send from. Demotes whichever row currently holds
 * `is_primary` first — the unique partial index (034) only allows one
 * per account, so skipping the demotion would 409 on the promote.
 */
export async function PATCH(request: Request) {
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
    if (!caller.isAdmin) {
      return NextResponse.json(
        { error: 'Only admins can change which number is primary.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const { user_id, is_primary } = body
    if (typeof user_id !== 'string' || is_primary !== true) {
      return NextResponse.json(
        { error: 'user_id and is_primary: true are required' },
        { status: 400 },
      )
    }

    await supabase
      .from('whatsapp_config')
      .update({ is_primary: false })
      .eq('account_id', caller.accountId)
      .eq('is_primary', true)

    const { error: promoteError } = await supabase
      .from('whatsapp_config')
      .update({ is_primary: true })
      .eq('account_id', caller.accountId)
      .eq('user_id', user_id)

    if (promoteError) {
      console.error('Error promoting whatsapp_config to primary:', promoteError)
      return NextResponse.json({ error: 'Failed to update primary connection' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config PATCH:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
