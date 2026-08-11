-- ============================================================
-- 026_deal_tracking.sql — CRM Virgo: stage history + loss reason
--
-- This is the "Rastreamento" module from escopo.md: without a log of
-- every stage change and a real value/reason on close, there is no
-- way to answer "o que dá bom e o que não dá" later — the data has
-- to be captured as it happens, not reconstructed after the fact.
--
-- What this migration does
--   1. `pipeline_stages.stage_type` — 'open' | 'won' | 'lost'.
--      Defaults every existing stage to 'open' (safe: nothing was
--      previously marked as a closing stage, so this changes no
--      existing behaviour). The UI uses this to decide when to
--      prompt for deal value / loss reason on drag-drop.
--   2. `deal_stage_history` — append-only log, one row per stage
--      change. Populated automatically by an AFTER UPDATE trigger on
--      `deals` (not left to application code to remember) so it can
--      never silently go missing — same reasoning wacrm already
--      applies to `updated_at` via `update_updated_at_column()`.
--   3. `loss_reasons` — small per-account catalog (not freeform
--      text) so "motivos de perda mais comuns" reports later group
--      cleanly instead of fragmenting across near-duplicate strings.
--   4. `deals.loss_reason_id` — FK into the catalog above.
--
-- What this migration does NOT do
--   - Does not enforce "loss_reason_id required when moving into a
--     lost stage" at the database level. A hard CHECK/trigger would
--     block the move entirely if the API call arrives before the
--     reason does (e.g. optimistic drag-drop UI), and would break on
--     any pre-existing deal already sitting in a lost stage without
--     one. That validation belongs in the API route, which can
--     return a proper 4xx instead of a opaque constraint violation.
--   - Does not seed default loss reasons per account. Seeding is an
--     application/onboarding concern (new-account bootstrap), not
--     schema — keeps this migration about structure only.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- PIPELINE_STAGES — stage_type
-- ============================================================
ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS stage_type TEXT NOT NULL DEFAULT 'open';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_stages_stage_type_check'
      AND conrelid = 'pipeline_stages'::regclass
  ) THEN
    ALTER TABLE pipeline_stages
      ADD CONSTRAINT pipeline_stages_stage_type_check
      CHECK (stage_type IN ('open', 'won', 'lost'));
  END IF;
END $$;

-- At most one won stage and one lost stage per pipeline — keeps the
-- "which column is the closing column" question unambiguous for the
-- UI and for reporting. Multiple 'open' stages are, of course, fine.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_stages_one_won_per_pipeline
  ON pipeline_stages(pipeline_id) WHERE stage_type = 'won';
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_stages_one_lost_per_pipeline
  ON pipeline_stages(pipeline_id) WHERE stage_type = 'lost';

-- ============================================================
-- LOSS_REASONS (per-account catalog)
-- ============================================================
CREATE TABLE IF NOT EXISTS loss_reasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, label)
);

ALTER TABLE loss_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loss_reasons_select ON loss_reasons;
CREATE POLICY loss_reasons_select ON loss_reasons FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS loss_reasons_modify ON loss_reasons;
CREATE POLICY loss_reasons_modify ON loss_reasons FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ============================================================
-- DEALS — loss_reason_id
-- ============================================================
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS loss_reason_id UUID REFERENCES loss_reasons(id) ON DELETE SET NULL;

-- ============================================================
-- DEAL_STAGE_HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS deal_stage_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  moved_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_stage_history_deal
  ON deal_stage_history(deal_id, moved_at);
CREATE INDEX IF NOT EXISTS idx_deal_stage_history_account
  ON deal_stage_history(account_id);

ALTER TABLE deal_stage_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_stage_history_select ON deal_stage_history;
CREATE POLICY deal_stage_history_select ON deal_stage_history FOR SELECT
  USING (is_account_member(account_id));
-- No client INSERT/UPDATE/DELETE policy — rows are written only by
-- the trigger below (SECURITY DEFINER, bypasses RLS) or the service
-- role. Nothing should ever edit history after the fact.

-- ============================================================
-- TRIGGER — auto-log every deals.stage_id change
--
-- SECURITY DEFINER so it can insert into deal_stage_history
-- regardless of the calling user's RLS grants on that table (there
-- are none for clients, by design — see above).
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_deal_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    INSERT INTO deal_stage_history (deal_id, account_id, from_stage_id, to_stage_id, moved_by_user_id)
    VALUES (NEW.id, NEW.account_id, OLD.stage_id, NEW.stage_id, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.log_deal_stage_change() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_deal_stage_change ON deals;
CREATE TRIGGER on_deal_stage_change
  AFTER UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION public.log_deal_stage_change();

-- Backfill: one synthetic "creation" row per existing deal, so every
-- deal has at least one history entry (its current stage, moved_by
-- unknown — NULL is honest here, we don't know who created it).
INSERT INTO deal_stage_history (deal_id, account_id, from_stage_id, to_stage_id, moved_by_user_id, moved_at)
SELECT d.id, d.account_id, NULL, d.stage_id, NULL, d.created_at
FROM deals d
WHERE NOT EXISTS (
  SELECT 1 FROM deal_stage_history h WHERE h.deal_id = d.id
);
