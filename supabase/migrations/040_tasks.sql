-- ============================================================
-- 040_tasks.sql — follow-up tasks per contact/deal.
--
-- Gap flagged explicitly in the 20/08/2026 vendor onboarding call
-- ("vou fazer essa parte de criar tarefas... follow up", never built)
-- and confirmed still missing on 26/08/2026: there was no table, API,
-- or screen for a vendor to schedule a follow-up on a lead. Notes
-- (contact_notes) are freeform and undated; this is the actionable,
-- due-dated counterpart.
--
-- Shape mirrors contact_notes/deals: account_id for direct filtering,
-- assigned_to as the "owner" column so it slots into the existing
-- can_view_owner()/lead_visibility_grants model from 034/035 with no
-- new predicate needed. contact_id is required (a task always anchors
-- to a lead); deal_id is optional context for when the task was
-- created from a specific pipeline card, since one contact can have
-- deals in more than one pipeline (see Funil Larissa/Funil Vitória).
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_account ON tasks(account_id);
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deal ON tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_open
  ON tasks(assigned_to, due_at) WHERE completed_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at ON tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Same shape as contacts/deals (035): visible to whoever can see the
-- owner (self, admin+, unassigned, or an explicit visibility grant).
DROP POLICY IF EXISTS tasks_select ON tasks;
CREATE POLICY tasks_select ON tasks
  FOR SELECT USING (is_account_member(account_id) AND can_view_owner(account_id, assigned_to));

DROP POLICY IF EXISTS tasks_insert ON tasks;
CREATE POLICY tasks_insert ON tasks
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS tasks_update ON tasks;
CREATE POLICY tasks_update ON tasks
  FOR UPDATE USING (
    is_account_member(account_id, 'agent')
    AND (
      is_account_member(account_id, 'admin')
      OR assigned_to = (SELECT p.id FROM profiles p WHERE p.user_id = auth.uid())
      OR assigned_to IS NULL
    )
  );

DROP POLICY IF EXISTS tasks_delete ON tasks;
CREATE POLICY tasks_delete ON tasks
  FOR DELETE USING (
    is_account_member(account_id, 'agent')
    AND (
      is_account_member(account_id, 'admin')
      OR assigned_to = (SELECT p.id FROM profiles p WHERE p.user_id = auth.uid())
      OR assigned_to IS NULL
    )
  );
