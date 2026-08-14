-- ============================================================
-- 034_lead_ownership.sql — per-vendor lead ownership + multi-number
-- WhatsApp, foundation for the "each vendor sees only their own
-- leads" access model.
--
-- Schema-only migration. Deliberately does NOT touch the SELECT
-- policies on contacts/deals/conversations/messages/contact_notes —
-- those stay wide-open (is_account_member(account_id), no owner
-- filter) until a follow-up migration flips them. Reasoning: every
-- agent in an account currently sees every lead; rewriting RLS in
-- the same migration that introduces the owner column would ship
-- the access change before anyone has had a chance to backfill/
-- verify who actually owns what. This migration only adds the data
-- model and leaves visibility unchanged.
--
-- What this migration does
--   1. contacts.owner_id — which vendor this lead belongs to.
--      Backfilled to the account's Owner so nothing goes dark for
--      whoever already had full access; real per-vendor assignment
--      is a manual follow-up once this ships.
--   2. whatsapp_config: account_id was UNIQUE (one number per
--      account, ever). Swapped for UNIQUE(account_id, user_id) so
--      each vendor can connect their own number under the same
--      account. `user_id` already existed on this table (legacy,
--      not used for tenancy per 017's own comment) — repurposed
--      here as "which vendor owns this connection," not dropped.
--   3. whatsapp_config.is_primary — the one number Broadcasts and
--      Message Templates keep using regardless of per-vendor
--      numbers (avoids fanning out template approval across N
--      WABAs — see plan doc). Existing rows default to primary so
--      today's single-number accounts keep working unchanged.
--   4. lead_visibility_grants — admin-only, read-only cross-vendor
--      sharing: "viewer_user_id may see owner_user_id's leads."
--      Nothing consults this table yet (RLS unchanged in this
--      migration); it exists so the grants UI has somewhere to
--      write before the enforcing policy ships.
--   5. can_view_owner(account_id, owner_id) — the predicate the
--      follow-up RLS migration will call. Defined now, alongside
--      the table it reads, so that migration is a pure policy
--      swap with no schema changes of its own.
-- ============================================================

-- ------------------------------------------------------------
-- 1. contacts.owner_id
-- ------------------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Backfill: every existing contact belongs to its account's Owner.
-- Owner/Admin already see everything regardless of this column, so
-- this is a no-op for who currently has access — it only gives
-- legacy rows *some* explicit owner instead of NULL (which would
-- read as "unassigned, admin-only" once the follow-up RLS ships).
UPDATE contacts c
SET owner_id = (
  SELECT p.id
  FROM profiles p
  WHERE p.account_id = c.account_id
    AND p.account_role = 'owner'
  LIMIT 1
)
WHERE c.owner_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id);

-- conversations.assigned_agent_id (migration 001) has always been a
-- bare UUID with no FK and no reader anywhere in the app — it was
-- write-only/decorative. Pinning it to profiles(id) now makes it the
-- same id space as contacts.owner_id and deals.assigned_to, so
-- can_view_owner()'s `owner_id = profiles.id` comparison works
-- identically across all three tables. Any pre-existing values that
-- aren't a valid profiles.id would fail this ADD CONSTRAINT — expected
-- to be a no-op today since nothing has ever written to this column.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_assigned_agent_id_fkey'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_assigned_agent_id_fkey
      FOREIGN KEY (assigned_agent_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2 & 3. whatsapp_config: one row per vendor, one marked primary
-- ------------------------------------------------------------
ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_config_account_owner_key'
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_account_owner_key UNIQUE (account_id, user_id);
  END IF;
END $$;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

-- Every account had exactly one row before this migration (the old
-- UNIQUE(account_id) guaranteed it) — that row becomes primary so
-- broadcasts/templates keep working with zero reconfiguration.
UPDATE whatsapp_config SET is_primary = true WHERE is_primary = false;

-- At most one primary per account, enforced at the DB level (not
-- just app logic) so a future bug can't silently leave an account
-- with zero or two primaries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_one_primary
  ON whatsapp_config(account_id) WHERE is_primary;

-- ------------------------------------------------------------
-- 4. lead_visibility_grants
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_visibility_grants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- who gains visibility
  viewer_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- whose leads become visible to them
  owner_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, viewer_user_id, owner_user_id),
  CHECK (viewer_user_id <> owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_visibility_grants_account ON lead_visibility_grants(account_id);
CREATE INDEX IF NOT EXISTS idx_lead_visibility_grants_viewer ON lead_visibility_grants(viewer_user_id);

ALTER TABLE lead_visibility_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_visibility_grants_select ON lead_visibility_grants;
CREATE POLICY lead_visibility_grants_select ON lead_visibility_grants
  FOR SELECT USING (is_account_member(account_id));

-- Admin+ only: creating/revoking a grant is a settings-class action,
-- same tier as inviting members or connecting WhatsApp.
DROP POLICY IF EXISTS lead_visibility_grants_write ON lead_visibility_grants;
CREATE POLICY lead_visibility_grants_write ON lead_visibility_grants
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- 5. can_view_owner — predicate the follow-up RLS migration uses.
--
-- True when the caller is admin+ (sees everything), owns the row
-- themselves, or has been explicitly granted read access to that
-- owner's leads via lead_visibility_grants. Mirrors is_account_member
-- (029_account_status.sql) in shape: STABLE + SECURITY DEFINER so it
-- can read `profiles`/`lead_visibility_grants` regardless of the
-- caller's own RLS visibility into those tables.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION can_view_owner(target_account_id UUID, target_owner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    target_owner_id IS NULL  -- unassigned rows: visible to any account member (same as before this feature existed) until someone claims them
    OR is_account_member(target_account_id, 'admin')
    OR target_owner_id = (SELECT p.id FROM profiles p WHERE p.user_id = auth.uid())
    OR EXISTS (
      SELECT 1
      FROM lead_visibility_grants g
      JOIN profiles me ON me.user_id = auth.uid()
      WHERE g.account_id = target_account_id
        AND g.viewer_user_id = me.id
        AND g.owner_user_id = target_owner_id
    );
$$;

GRANT EXECUTE ON FUNCTION can_view_owner(UUID, UUID) TO authenticated, service_role;
