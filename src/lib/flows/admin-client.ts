import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { retryFetch } from '@/lib/supabase/retry-fetch'

// Lazy, shared service-role client for the Flows engine.
// Mirrors src/lib/automations/admin-client.ts — same shape so anyone
// reading either file picks up the convention immediately.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { global: { fetch: retryFetch } },
    )
  }
  return _adminClient
}
