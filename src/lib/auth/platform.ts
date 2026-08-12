// ============================================================
// Server-side platform (Super Admin) context — mirrors
// src/lib/auth/account.ts's shape exactly, one level up: this
// checks `profiles.platform_role`, not `profiles.account_role`.
//
// Deliberately separate from account.ts rather than folded into
// it — a platform admin route should never accidentally accept an
// account-scoped role check (or vice versa). Two small modules with
// one job each beats one module with a `scope: "platform" | "account"`
// parameter threaded through every call site.
// ============================================================

import { createClient } from "@/lib/supabase/server";
import { ForbiddenError, UnauthorizedError } from "./account";

export interface PlatformContext {
  userId: string;
}

/**
 * Throws `UnauthorizedError` if there's no session, `ForbiddenError`
 * if the caller isn't a Super Admin. Use at the top of every
 * `/api/admin/*` route the same way account.ts's `requireRole` is
 * used for `/api/account/*`.
 */
export async function requirePlatformAdmin(): Promise<PlatformContext> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("platform_role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[requirePlatformAdmin] profile fetch error:", error);
    throw new ForbiddenError("Could not load platform context");
  }
  if (!data || data.platform_role !== "super_admin") {
    throw new ForbiddenError("This action requires Super Admin access");
  }

  return { userId: user.id };
}
