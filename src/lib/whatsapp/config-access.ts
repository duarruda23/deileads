import type { createClient } from '@/lib/supabase/server'

type ServerSupabase = Awaited<ReturnType<typeof createClient>>

/**
 * Resolve the caller's account_id + account_role from their profile.
 *
 * Returns null if the user has no profile or no account; callers
 * should treat that the same as "not connected".
 */
export async function resolveCaller(
  supabase: ServerSupabase,
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
 * per-vendor (UNIQUE(account_id, user_id)). Every handler resolves a
 * *target* user_id — the caller's own by default, or another account
 * member's if the caller is admin+ and passes one explicitly. A
 * non-admin who tries to target someone else silently falls back to
 * their own row rather than erroring — same "fail to your own scope"
 * posture as the rest of the 034 access model.
 */
export async function resolveTargetUserId(
  supabase: ServerSupabase,
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
