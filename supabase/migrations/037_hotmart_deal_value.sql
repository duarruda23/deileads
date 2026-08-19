-- ============================================================
-- 037_hotmart_deal_value.sql — carry the sale price onto Hotmart deals
--
-- submit_hotmart_lead (033) never read `data.purchase.price` from the
-- webhook payload, so every Hotmart-created deal was left at the
-- `deals` table defaults: value = 0, currency = 'USD'. A cart lands
-- in "Fechado Ganho" showing "US$ 0" no matter what the buyer
-- actually paid or in what currency.
--
-- Adds p_value/p_currency params, populated by route.ts from
-- `purchase.price.{value,currency_value}` (only present once a
-- transaction exists — cart-abandonment still has neither, same as
-- before).
--
-- On insert: use the price if we have one, falling back to the
-- account's default_currency (not a hardcoded 'USD') when Hotmart
-- didn't send a currency.
-- On update (a deal already exists for this contact from an earlier
-- event): only overwrite value/currency on the transition to 'won' —
-- that's the one event whose price is the authoritative final sale
-- amount. A late/retried earlier-stage event must not stomp a value
-- already recorded from approval.
-- ============================================================

DROP FUNCTION IF EXISTS public.submit_hotmart_lead(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB);

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
  -- Only PURCHASE_APPROVED/PURCHASE_COMPLETE count as "won" — every
  -- other enabled event (billet printed, cart abandoned, etc.) is
  -- treated as still-open.
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
  SELECT id INTO v_contact_id FROM contacts
  WHERE account_id = v_config.account_id AND phone_normalized = v_phone_normalized
  LIMIT 1;

  IF v_contact_id IS NULL THEN
    INSERT INTO contacts (user_id, account_id, phone, name, email)
    VALUES (v_owner_user_id, v_config.account_id, p_phone, NULLIF(p_name, ''), p_email)
    RETURNING id INTO v_contact_id;
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
    -- Cart abandonment (the earliest possible event) never carries
    -- `purchase.origin`/transaction — only later events do. Backfill
    -- external_ref/utm_ref from whichever event happens to bring them
    -- first, on every touch, not just the winning one — otherwise
    -- attribution data from an event that arrives after the deal
    -- already exists gets silently dropped.
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
