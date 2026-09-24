import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { cascadeLeadOwner } from "@/lib/leads/assign-owner";
import { entryStageId } from "@/lib/pipelines/members";

/**
 * POST /api/contacts/[id]/claim — "caça-leads": any agent+ can claim
 * an unowned lead for themselves. Race-safe: the contacts update only
 * succeeds if owner_id is still NULL at write time (`.is('owner_id',
 * null)` in the filter), so two vendors clicking at the same moment
 * can't both win — the loser gets a 409.
 *
 * Optional body `{ pipeline_id }`: also move the claimer's deal(s) for
 * this contact into that pipeline's entry stage. Only accepted for a
 * pipeline the claimer is responsible for (pipeline_members, 047) —
 * that's the "which of my pipelines does this lead go to" choice.
 * Returns the moved deals so the client can fire deal_stage_changed.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const targetPipelineId =
      (body as { pipeline_id?: string | null }).pipeline_id ?? null;

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

    if (!targetPipelineId) {
      return NextResponse.json({ success: true, moved: [] });
    }

    // The claim itself already succeeded — a bad/foreign pipeline id
    // only skips the move, it doesn't undo the claim.
    const { data: membership } = await ctx.supabase
      .from("pipeline_members")
      .select("pipeline_id")
      .eq("pipeline_id", targetPipelineId)
      .eq("profile_id", callerProfile.id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    const stageId = membership
      ? await entryStageId(ctx.supabase, targetPipelineId)
      : null;
    if (!stageId) {
      return NextResponse.json({
        success: true,
        moved: [],
        warning: "Lead assumido, mas não foi possível movê-lo para esse funil",
      });
    }

    const { data: moved, error: moveError } = await ctx.supabase
      .from("deals")
      .update({ pipeline_id: targetPipelineId, stage_id: stageId })
      .eq("contact_id", id)
      .eq("account_id", ctx.accountId)
      .eq("assigned_to", callerProfile.id)
      .neq("pipeline_id", targetPipelineId)
      .select("id, contact_id, pipeline_id, stage_id");
    if (moveError) {
      console.error("[POST contacts/claim] move error:", moveError);
      return NextResponse.json({
        success: true,
        moved: [],
        warning: "Lead assumido, mas não foi possível movê-lo para esse funil",
      });
    }

    return NextResponse.json({ success: true, moved: moved ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
