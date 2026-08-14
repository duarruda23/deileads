// ============================================================
// /api/account/lead-visibility-grants
//
// 034/035: admin-only management of cross-vendor read access —
// "let viewer_user_id see owner_user_id's leads/deals/conversations,
// read-only." Mirrors /api/account/members' auth conventions
// (requireRole / toErrorResponse) and members-tab.tsx's roster-list
// UI pattern on the client side.
//
// Request/response bodies use auth.users.id (the same id the
// Members roster already exposes as `user_id`) — this route does
// the auth.users.id → profiles.id translation internally so the
// client never needs to know profiles.id exists.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

interface GrantRow {
  id: string;
  created_at: string;
  viewer: { user_id: string; full_name: string | null } | null;
  owner: { user_id: string; full_name: string | null } | null;
}

/** GET — list grants for the caller's account. Any member can view
 *  (matches the `lead_visibility_grants_select` RLS policy); only
 *  admin+ can create/revoke (enforced below and by RLS). */
export async function GET() {
  try {
    const ctx = await requireRole("viewer");

    const { data, error } = await ctx.supabase
      .from("lead_visibility_grants")
      .select(
        "id, created_at, viewer:profiles!lead_visibility_grants_viewer_user_id_fkey(user_id, full_name), owner:profiles!lead_visibility_grants_owner_user_id_fkey(user_id, full_name)",
      )
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET lead-visibility-grants] fetch error:", error);
      return NextResponse.json({ error: "Failed to load grants" }, { status: 500 });
    }

    const grants = (data as unknown as GrantRow[]).map((g) => ({
      id: g.id,
      created_at: g.created_at,
      viewer_user_id: g.viewer?.user_id ?? null,
      viewer_name: g.viewer?.full_name ?? null,
      owner_user_id: g.owner?.user_id ?? null,
      owner_name: g.owner?.full_name ?? null,
    }));

    return NextResponse.json({ grants });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST — create a grant. Body: { viewer_user_id, owner_user_id }
 *  (auth.users.id values, as returned by /api/account/members). */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const body = await request.json();
    const { viewer_user_id, owner_user_id } = body as {
      viewer_user_id?: string;
      owner_user_id?: string;
    };

    if (!viewer_user_id || !owner_user_id) {
      return NextResponse.json(
        { error: "viewer_user_id and owner_user_id are required" },
        { status: 400 },
      );
    }
    if (viewer_user_id === owner_user_id) {
      return NextResponse.json(
        { error: "A teammate can't be granted access to their own leads" },
        { status: 400 },
      );
    }

    // Resolve both auth.users.id values to profiles.id, scoped to
    // this account — also doubles as "both users are actually on
    // this team" validation.
    const { data: profiles, error: profilesError } = await ctx.supabase
      .from("profiles")
      .select("id, user_id")
      .eq("account_id", ctx.accountId)
      .in("user_id", [viewer_user_id, owner_user_id]);

    if (profilesError) {
      console.error("[POST lead-visibility-grants] profile lookup error:", profilesError);
      return NextResponse.json({ error: "Failed to validate teammates" }, { status: 500 });
    }

    const viewerProfile = profiles?.find((p) => p.user_id === viewer_user_id);
    const ownerProfile = profiles?.find((p) => p.user_id === owner_user_id);
    if (!viewerProfile || !ownerProfile) {
      return NextResponse.json(
        { error: "Both teammates must belong to your account" },
        { status: 400 },
      );
    }

    const { data: callerProfile } = await ctx.supabase
      .from("profiles")
      .select("id")
      .eq("user_id", ctx.userId)
      .maybeSingle();

    const { data: inserted, error: insertError } = await ctx.supabase
      .from("lead_visibility_grants")
      .insert({
        account_id: ctx.accountId,
        viewer_user_id: viewerProfile.id,
        owner_user_id: ownerProfile.id,
        created_by: callerProfile?.id,
      })
      .select("id")
      .single();

    if (insertError) {
      // UNIQUE(account_id, viewer_user_id, owner_user_id)
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: "This teammate already has access to those leads" },
          { status: 409 },
        );
      }
      console.error("[POST lead-visibility-grants] insert error:", insertError);
      return NextResponse.json({ error: "Failed to create grant" }, { status: 500 });
    }

    return NextResponse.json({ id: inserted.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** DELETE /api/account/lead-visibility-grants?id=<grant id> */
export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { error } = await ctx.supabase
      .from("lead_visibility_grants")
      .delete()
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[DELETE lead-visibility-grants] delete error:", error);
      return NextResponse.json({ error: "Failed to revoke grant" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
