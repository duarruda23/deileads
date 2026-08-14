import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Move a lead's deal(s) and conversation to the same owner as its
 * contact, so ownership never splits across tables — a vendor could
 * otherwise end up "owning" the conversation while another owns the
 * deal, which is exactly the double-handling risk 034/035's
 * `can_view_owner` exists to prevent. `profileId` is a `profiles.id`,
 * or `null` to release the lead back to the unclaimed pool.
 *
 * Pass `onlyIfUnassigned: true` for a self-serve claim (only touch
 * rows that were still unowned, so a claim can't clobber an
 * unrelated assignment); omit it for an explicit admin reassignment
 * or automation action, which deliberately moves the whole lead.
 */
export async function cascadeLeadOwner(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  profileId: string | null,
  { onlyIfUnassigned = false }: { onlyIfUnassigned?: boolean } = {},
): Promise<void> {
  let dealsQuery = db
    .from("deals")
    .update({ assigned_to: profileId })
    .eq("contact_id", contactId)
    .eq("account_id", accountId);
  let convQuery = db
    .from("conversations")
    .update({ assigned_agent_id: profileId })
    .eq("contact_id", contactId)
    .eq("account_id", accountId);

  if (onlyIfUnassigned) {
    dealsQuery = dealsQuery.is("assigned_to", null);
    convQuery = convQuery.is("assigned_agent_id", null);
  }

  await Promise.all([dealsQuery, convQuery]);
}
