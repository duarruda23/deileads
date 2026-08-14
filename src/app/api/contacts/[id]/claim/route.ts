import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { cascadeLeadOwner } from "@/lib/leads/assign-owner";

/**
 * POST /api/contacts/[id]/claim — "caça-leads": any agent+ can claim
 * an unowned lead for themselves. Race-safe: the contacts update only
 * succeeds if owner_id is still NULL at write time (`.is('owner_id',
 * null)` in the filter), so two vendors clicking at the same moment
 * can't both win — the loser gets a 409.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const { data: callerProfile } = await ctx.supabase
      .from("profiles")
      .select("id")
      .eq("user_id", ctx.userId)
      .maybeSingle();

    if (!callerProfile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 500 });
    }

    const { data: claimed, error } = await ctx.supabase
      .from("contacts")
      .update({ owner_id: callerProfile.id, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .is("owner_id", null)
      .select("id");

    if (error) {
      console.error("[POST contacts/claim] update error:", error);
      return NextResponse.json({ error: "Failed to claim lead" }, { status: 500 });
    }

    if (!claimed || claimed.length === 0) {
      return NextResponse.json(
        { error: "This lead was already claimed by a teammate" },
        { status: 409 },
      );
    }

    await cascadeLeadOwner(ctx.supabase, ctx.accountId, id, callerProfile.id, {
      onlyIfUnassigned: true,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
