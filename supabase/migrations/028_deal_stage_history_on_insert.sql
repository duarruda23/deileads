-- ============================================================
-- 028_deal_stage_history_on_insert.sql
--
-- Bug found while end-to-end testing 027's submit_site_lead RPC:
-- deal_stage_history's trigger (026) only fires AFTER UPDATE, so a
-- brand-new deal created directly into a stage (site intake, native
-- leadgen, manual create) gets ZERO history rows until it's moved
-- for the first time — defeating "capture this automatically, never
-- rely on application code remembering" from 026's own rationale.
-- The 026 migration's one-time backfill covered pre-existing deals
-- but not this ongoing gap for every deal created afterward.
--
-- Fix: redefine log_deal_stage_change() to also run AFTER INSERT,
-- logging from_stage_id = NULL (there was no prior stage — same
-- convention the 026 backfill already used).
--
-- Not editing 026_deal_tracking.sql in place — it's already applied
-- and pushed; fixing forward with a new migration is the same
-- pattern the rest of this codebase uses (e.g. 013 over 001).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.log_deal_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO deal_stage_history (deal_id, account_id, from_stage_id, to_stage_id, moved_by_user_id)
    VALUES (NEW.id, NEW.account_id, NULL, NEW.stage_id, auth.uid());
  ELSIF TG_OP = 'UPDATE' AND NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    INSERT INTO deal_stage_history (deal_id, account_id, from_stage_id, to_stage_id, moved_by_user_id)
    VALUES (NEW.id, NEW.account_id, OLD.stage_id, NEW.stage_id, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.log_deal_stage_change() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_deal_stage_change ON deals;
CREATE TRIGGER on_deal_stage_change
  AFTER INSERT OR UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION public.log_deal_stage_change();
