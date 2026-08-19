import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Exchanges the PKCE `code` Supabase Auth appends to email links
// (password recovery, signup confirmation, email-change confirmation)
// for a real session, then redirects to wherever the link was meant
// to land (`next`, e.g. `/reset-password`). Every `resetPasswordForEmail`
// / `signUp` / `updateUser({ email })` call in this app points its
// `redirectTo` at this route — without it those links 404 before any
// client code runs.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  const url = new URL('/login', origin)
  url.searchParams.set('error', 'auth-link-invalid')
  return NextResponse.redirect(url)
}
