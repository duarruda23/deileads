// ============================================================
// POST /api/public/leads/[accountId]
//
// Public — no auth, no session. A site form (a Virgo-built landing
// page, or the client's own site) posts here on submit. Backed by
// the SECURITY DEFINER `submit_site_lead` RPC from migration 027,
// same shape as the invitation peek/redeem routes.
//
// Security model
//   - The `token` field (not the URL) is the actual authority — a
//     per-account secret from `lead_intake_tokens`, hashed before
//     it ever reaches the DB (same pattern as invitation tokens).
//   - `[accountId]` in the path is NOT re-validated against the
//     token's account. It exists for readable URLs / server logs
//     only. A token is only ever handed out for one specific
//     account, so a copy-pasted wrong `accountId` with a *correct*
//     token for a *different* account would still land the lead in
//     the account the token actually belongs to — which is the
//     token owner's account either way, never someone else's. Since
//     that's not a security hole (just a possibly-confusing URL),
//     we don't add a mismatch check that could otherwise turn a
//     harmless URL typo into a confusing failure for a legitimate
//     integration.
//   - Honeypot field (`company`, see below) — a hidden form field a
//     human visitor never fills but a naive bot does. Tripping it
//     returns a fake 200 success (never tell the bot it was caught)
//     without touching the DB.
//   - Per-IP rate limit — public + unauthenticated + writes data,
//     so this is the tightest budget in rate-limit.ts.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { hashLeadIntakeToken } from "@/lib/auth/lead-intake";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

interface SiteLeadPayload {
  token?: string;
  name?: string;
  phone?: string;
  email?: string;
  utm?: Record<string, string>;
  /** Freeform context to attach to the deal's `notes` column — e.g.
   *  an Instagram handle collected by a conversational LP. */
  notes?: string;
  /** Honeypot — render this input hidden (CSS, not `type="hidden"`,
   *  which some bots skip) in the actual form. Real visitors never
   *  see or fill it. */
  company?: string;
}

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "22023") {
    return NextResponse.json(
      { ok: false, error: "Invalid or revoked intake token" },
      { status: 400 },
    );
  }
  if (err.code === "23514") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "This account has no default pipeline/stage configured yet — open the Kanban once to create one before using site intake.",
      },
      { status: 409 },
    );
  }
  console.error("[site-lead-intake] unexpected RPC error:", err);
  return NextResponse.json(
    { ok: false, error: "Failed to submit lead" },
    { status: 500 },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  // accountId is intentionally unused for authorization — see the
  // file-level comment above. Awaiting it anyway keeps the route
  // signature honest about the URL shape and avoids an unused-param
  // lint warning without a `void` no-op.
  await params;

  const ip = getClientIp(request);
  const limit = checkRateLimit(`site-lead:${ip}`, RATE_LIMITS.siteLeadIntake);
  if (!limit.success) return rateLimitResponse(limit);

  let body: SiteLeadPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // Honeypot tripped — pretend success, do nothing.
  if (body.company && body.company.trim() !== "") {
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  if (!body.token || typeof body.token !== "string") {
    return NextResponse.json(
      { ok: false, error: "Missing intake token" },
      { status: 400 },
    );
  }

  const phone = body.phone?.trim();
  if (!phone) {
    return NextResponse.json(
      { ok: false, error: "Phone is required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_site_lead", {
    p_token_hash: hashLeadIntakeToken(body.token),
    p_name: body.name ?? null,
    p_phone: phone,
    p_email: body.email ?? null,
    p_utm: body.utm ?? null,
    p_notes: body.notes ?? null,
  });

  if (error) return rpcErrorToResponse(error);

  return NextResponse.json(data, { status: 201 });
}
