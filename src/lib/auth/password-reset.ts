import { supabaseAdmin } from '@/lib/platform/admin-client'

/**
 * Password reset on someone else's behalf — a gestor (account
 * owner/admin) for a vendor, or the Super Admin for a gestor. Server
 * only (service role).
 *
 * - `link`: generates a one-time recovery link without sending
 *   anything, so the gestor can hand it over on WhatsApp (vendors'
 *   inboxes are unreliable and the link must not depend on email
 *   arriving).
 * - `email`: sends the regular recovery email through the project's
 *   SMTP. The email template points at /auth/confirm with the token
 *   hash, so it works in whatever browser opens it.
 *
 * Both land on /auth/confirm → /reset-password.
 */
export type PasswordResetMode = 'link' | 'email'

export async function createPasswordReset(
  email: string,
  mode: PasswordResetMode,
  origin: string
): Promise<{ link?: string; error?: string }> {
  const admin = supabaseAdmin()

  if (mode === 'email') {
    const { error } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/reset-password`,
    })
    if (error) {
      console.error('[password-reset] email failed:', error.message)
      return { error: 'Não foi possível enviar o e-mail de redefinição' }
    }
    return {}
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
  })
  const tokenHash = data?.properties?.hashed_token
  if (error || !tokenHash) {
    console.error('[password-reset] generateLink failed:', error?.message)
    return { error: 'Não foi possível gerar o link de redefinição' }
  }
  const url = new URL('/auth/confirm', origin)
  url.searchParams.set('token_hash', tokenHash)
  url.searchParams.set('type', 'recovery')
  url.searchParams.set('next', '/reset-password')
  return { link: url.toString() }
}

export function isPasswordResetMode(v: unknown): v is PasswordResetMode {
  return v === 'link' || v === 'email'
}
