-- ============================================================
-- 041_hotmart_contact_race_fix.sql — fix duplicate-key crash in
-- submit_hotmart_lead's find-or-create contact step.
--
-- Observed in production (Vercel runtime errors, account "Italo",
-- 7 occurrences 2026-08-21..2026-08-27): "duplicate key value
-- violates unique constraint idx_contacts_account_phone_normalized".
--
-- Root cause: the SELECT-then-INSERT pattern is not atomic. Hotmart
-- fires multiple events for the same buyer close together (e.g.
-- PURCHASE_OUT_OF_SHOPPING_CART followed almost immediately by
-- PURCHASE_APPROVED, or a retried delivery after a timeout) and two
-- overlapping calls can both run the SELECT, both find no existing
-- contact, and both attempt the INSERT — the second one violates the
-- unique index instead of finding the row the first one just created.
-- The whole RPC raises, the webhook route 500s, and that event's deal
-- (a real sale, in the observed cases) never gets recorded.
--
-- Fix: make the insert conflict-safe with `ON CONFLICT ... DO NOTHING`
-- against the same partial unique index from 022, then fall back to
-- the SELECT only if the insert actually lost the race.
-- ============================================================

DROP FUNCTION IF EXISTS public.submit_hotmart_lead(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT);

CREATE FUNCTION public.submit_hotmart_lead(
  p_hottok_hash TEXT,
  p_event TEXT,
  p_name TEXT,
  p_phone TEXT,
  p_email TEXT DEFAULT NULL,
  p_transaction TEXT DEFAULT NULL,
  p_utm JSONB DEFAULT NULL,
  p_value NUMERIC DEFAULT NULL,
  p_currency TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config hotmart_config%ROWTYPE;
  v_owner_user_id UUID;
  v_contact_id UUID;
  v_pipeline_id UUID;
  v_open_stage_id UUID;
  v_won_stage_id UUID;
  v_target_stage_id UUID;
  v_deal_id UUID;
  v_existing_deal_id UUID;
  v_phone_normalized TEXT;
  v_default_currency TEXT;
  v_is_won BOOLEAN := p_event IN ('PURCHASE_APPROVED', 'PURCHASE_COMPLETE');
BEGIN
  SELECT * INTO v_config FROM hotmart_config WHERE hottok_hash = p_hottok_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No account configured for this Hotmart token' USING ERRCODE = '22023';
  END IF;

  IF NOT (p_event = ANY(v_config.enabled_events)) THEN
    RETURN json_build_object('ok', true, 'skipped', true, 'reason', 'event_disabled');
  END IF;

  IF p_phone IS NULL OR btrim(p_phone) = '' THEN
    RETURN json_build_object('ok', true, 'skipped', true, 'reason', 'no_phone');
  END IF;

  v_phone_normalized := regexp_replace(p_phone, '\D', '', 'g');

  SELECT owner_user_id, default_currency INTO v_owner_user_id, v_default_currency
  FROM accounts WHERE id = v_config.account_id;

  SELECT id INTO v_pipeline_id FROM pipelines
  WHERE account_id = v_config.account_id AND is_default = true;

  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'Account has no default pipeline configured yet' USING ERRCODE = '23514';
  END IF;

  SELECT id INTO v_open_stage_id FROM pipeline_stages
  WHERE pipeline_id = v_pipeline_id AND stage_type = 'open'
  ORDER BY position ASC LIMIT 1;

  SELECT id INTO v_won_stage_id FROM pipeline_stages
  WHERE pipeline_id = v_pipeline_id AND stage_type = 'won' LIMIT 1;

  IF v_open_stage_id IS NULL OR (v_is_won AND v_won_stage_id IS NULL) THEN
    RAISE EXCEPTION 'Default pipeline is missing a required stage' USING ERRCODE = '23514';
  END IF;

  v_target_stage_id := CASE WHEN v_is_won THEN v_won_stage_id ELSE v_open_stage_id END;

  -- Find or create the contact, scoped to this account, matched on
  -- normalized phone (same dedup key as site-lead-intake, 027).
  -- Insert first with ON CONFLICT DO NOTHING against the partial
  -- unique index (022) instead of SELECT-then-INSERT: two overlapping
  -- Hotmart events for the same buyer can both miss on the SELECT and
  -- race the INSERT — this makes the second one a safe no-op instead
  -- of a crash, then the fallback SELECT picks up whichever row won.
  INSERT INTO contacts (user_id, account_id, phone, name, email)
  VALUES (v_owner_user_id, v_config.account_id, p_phone, NULLIF(p_name, ''), p_email)
  ON CONFLICT (account_id, phone_normalized) WHERE phone_normalized <> '' DO NOTHING
  RETURNING id INTO v_contact_id;

  IF v_contact_id IS NULL THEN
    SELECT id INTO v_contact_id FROM contacts
    WHERE account_id = v_config.account_id AND phone_normalized = v_phone_normalized
    LIMIT 1;
  END IF;

  -- Most recent Hotmart-sourced deal for this contact, if any —
  -- advance it forward on approval; otherwise leave its stage as-is
  -- (never regress a deal just because an earlier-stage event
  -- arrived out of order or got retried late).
  SELECT id INTO v_existing_deal_id FROM deals
  WHERE account_id = v_config.account_id
    AND contact_id = v_contact_id
    AND source = 'hotmart'
  ORDER BY created_at DESC LIMIT 1;

  IF v_existing_deal_id IS NOT NULL THEN
    v_deal_id := v_existing_deal_id;
    UPDATE deals
    SET stage_id = CASE WHEN v_is_won THEN v_won_stage_id ELSE stage_id END,
        external_ref = COALESCE(external_ref, p_transaction),
        utm_ref = COALESCE(utm_ref, p_utm),
        value = CASE WHEN v_is_won AND p_value IS NOT NULL THEN p_value ELSE value END,
        currency = CASE WHEN v_is_won AND p_currency IS NOT NULL THEN p_currency ELSE currency END
    WHERE id = v_deal_id;
  ELSE
    INSERT INTO deals (
      user_id, account_id, pipeline_id, stage_id, contact_id, title, source, utm_ref, external_ref, value, currency
    )
    VALUES (
      v_owner_user_id, v_config.account_id, v_pipeline_id, v_target_stage_id, v_contact_id,
      COALESCE(NULLIF(p_name, ''), p_phone), 'hotmart', p_utm, p_transaction,
      COALESCE(p_value, 0), COALESCE(p_currency, v_default_currency, 'USD')
    )
    RETURNING id INTO v_deal_id;
  END IF;

  RETURN json_build_object('ok', true, 'deal_id', v_deal_id, 'contact_id', v_contact_id);
END;
$$;

ALTER FUNCTION public.submit_hotmart_lead(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.submit_hotmart_lead(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_hotmart_lead(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT) TO anon;
