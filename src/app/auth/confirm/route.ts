import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

// Token-hash landing for Supabase email links (the recovery email
// template points here, as do the links a gestor/Super Admin copies
// from "Redefinir senha").
//
// Why not /auth/callback: that route exchanges a PKCE `code`, which
// only works in the same browser that *requested* the link (the code
// verifier lives in that browser's cookies). A vendor who asks for a
// reset on the computer and opens the email on the phone — or a reset
// sent by someone else, from the server or the Supabase dashboard —
// always failed there with "link expired". verifyOtp with the token
// hash has no such dependency: any browser that opens the link gets
// the session.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const rawNext = searchParams.get('next') ?? '/dashboard'
  // Only same-site paths — never let the link bounce to another host.
  const next =
    rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard'

  if (tokenHash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    console.error('[auth/confirm] verifyOtp failed:', error.message)
  }

  const url = new URL('/login', origin)
  url.searchParams.set('error', 'auth-link-invalid')
  return NextResponse.redirect(url)
}
