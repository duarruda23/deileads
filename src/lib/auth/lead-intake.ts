// ============================================================
// Lead intake token utilities — pure, server-side, no Supabase.
//
// Same shape as src/lib/auth/invitations.ts (32 bytes CSPRNG,
// base64url, SHA-256 hash at rest) — see that file for the full
// rationale. The one difference: intake tokens don't expire. An
// account wires this token into a landing page's form action once;
// forcing periodic re-issuance would silently break every deployed
// form. Revocation (lead_intake_tokens.revoked_at) is the lever
// instead — an admin can kill a compromised/retired token any time.
// ============================================================

import { createHash, randomBytes } from "node:crypto";

export interface GeneratedLeadIntakeToken {
  /** Plaintext token — return to the creator ONCE, never persist. */
  token: string;
  /** SHA-256 hex digest of the token. Persist this in the DB. */
  hash: string;
}

export function generateLeadIntakeToken(): GeneratedLeadIntakeToken {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashLeadIntakeToken(token) };
}

/** Deterministic SHA-256 of a plaintext token — same input, same output. */
export function hashLeadIntakeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
