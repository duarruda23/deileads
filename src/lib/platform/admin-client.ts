import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for admin-geral work (account
// creation, Virgo seller invites). Mirrors the pattern used elsewhere
// (src/lib/automations/admin-client.ts, src/lib/flows/admin-client.ts) —
// each feature area keeps its own copy rather than sharing one, which
// is this codebase's existing convention.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
