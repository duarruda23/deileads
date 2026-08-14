import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { cascadeLeadOwner } from "@/lib/leads/assign-owner";

/**
 * POST /api/contacts/[id]/reassign — admin-only. Moves a lead's
 * contact + deal(s) + conversation to a specific vendor (or `null` to
 * release it back to the unclaimed pool) in one call, so reassigning
 * from the contact detail view's Owner field can't split ownership
 * the way a contacts-only update would (see cascadeLeadOwner).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const ownerId = (body as { owner_id?: string | null }).owner_id ?? null;

    if (ownerId) {
      const { data: target } = await ctx.supabase
        .from("profiles")
        .select("id")
        .eq("id", ownerId)
        .eq("account_id", ctx.accountId)
        .maybeSingle();
      if (!target) {
        return NextResponse.json({ error: "Teammate not found" }, { status: 400 });
      }
    }

    const { error } = await ctx.supabase
      .from("contacts")
      .update({ owner_id: ownerId, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[POST contacts/reassign] update error:", error);
      return NextResponse.json({ error: "Failed to reassign lead" }, { status: 500 });
    }

    await cascadeLeadOwner(ctx.supabase, ctx.accountId, id, ownerId);

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
