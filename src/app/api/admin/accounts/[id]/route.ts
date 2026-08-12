// ============================================================
// PATCH /api/admin/accounts/[id]
//
// Super Admin only. Rename and/or suspend/reactivate a client
// account. Uses the caller's own (RLS-scoped) session client, not
// the service role — 023's accounts_update policy already lets a
// platform admin update any account row, so there's no need to
// bypass RLS here (unlike account creation, which needs the Admin
// Auth API).
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { createClient } from "@/lib/supabase/server";

const VALID_STATUSES = ["active", "suspended"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin();

    const { id } = await params;
    const body = await request.json();

    const update: Record<string, string> = {};
    if (typeof body.name === "string" && body.name.trim() !== "") {
      update.name = body.name.trim();
    }
    if (typeof body.status === "string") {
      if (!VALID_STATUSES.includes(body.status)) {
        return NextResponse.json(
          { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
          { status: 400 },
        );
      }
      update.status = body.status;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "Nothing to update — provide name and/or status" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("accounts")
      .update(update)
      .eq("id", id)
      .eq("is_internal", false); // defense-in-depth — never let this route touch virgo-interno

    if (error) {
      console.error("[PATCH /api/admin/accounts/:id] update error:", error);
      return NextResponse.json(
        { error: "Failed to update account" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
