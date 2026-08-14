// ============================================================
// createAndSignInInvitee — provisions the auth.users row for
// someone redeeming an invite link, without ever depending on
// Supabase sending an email.
//
// Why this exists: the normal client `supabase.auth.signUp()` only
// activates the account after the user clicks a confirmation link
// Supabase emails them (`mailer_autoconfirm` is off for this
// project, and there's no SMTP configured — the email never sends).
// That silently stranded both the account-invitation flow
// (/join/<token>) and the Cliente Admin / Virgo seller onboarding
// flows, which used `inviteUserByEmail` for the same reason.
//
// This uses the Admin API to create the user with `email_confirm:
// true` (bypassing the mailer entirely — same trick used to
// bootstrap the very first Super Admin by hand), then signs them in
// on the request's own Supabase client so the session cookie lands
// on the response. Callers pass the request-scoped SSR client (from
// `@/lib/supabase/server`) so `auth.uid()` resolves correctly for
// whatever RPC they call next in the same request.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/platform/admin-client";

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super("An account with this email already exists. Sign in instead.");
    this.name = "EmailAlreadyRegisteredError";
  }
}

export interface InviteeSignupParams {
  email: string;
  password: string;
  fullName: string;
}

export async function createAndSignInInvitee(
  supabase: SupabaseClient,
  { email, password, fullName }: InviteeSignupParams,
): Promise<void> {
  const admin = supabaseAdmin();

  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createErr) {
    // GoTrue returns a 422/"already registered" style error for a
    // duplicate email — surface it as a typed error so the route
    // can map it to 409 instead of a generic 500.
    if (
      createErr.status === 422 ||
      /already.*registered|already.*exists/i.test(createErr.message)
    ) {
      throw new EmailAlreadyRegisteredError();
    }
    throw createErr;
  }

  // Sign in on the SAME client the caller will use for the redeem
  // RPC right after — this is what makes `auth.uid()` resolve inside
  // that call without a second round trip or a client-side redirect.
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr) throw signInErr;
}
