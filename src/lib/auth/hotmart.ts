// ============================================================
// Hotmart hottok hashing — pure, server-side, no Supabase.
//
// Unlike our own generated tokens (invitations, lead-intake), the
// "hottok" isn't something we mint — it's a fixed secret Hotmart
// assigns per Hotmart account, pasted in by the Cliente Admin from
// their Hotmart dashboard. We still never store it in plaintext:
// same SHA-256-at-rest pattern as every other token in this codebase,
// so a leaked DB snapshot can't be replayed as a valid webhook call.
// ============================================================

import { createHash } from "node:crypto";

/** Deterministic SHA-256 of a plaintext hottok — same input, same output. */
export function hashHottok(hottok: string): string {
  return createHash("sha256").update(hottok.trim()).digest("hex");
}
