-- ============================================================
-- 039_site_lead_intake_notes.sql
--
-- Adds an optional `p_notes` param to `submit_site_lead` (027), so a
-- site form can attach freeform context (e.g. an Instagram handle
-- collected in a conversational LP) to the deal's existing `notes`
-- column, which the RPC didn't touch before.
--
-- Trailing param with a default, but a new arg count still means a
-- new pg_proc overload rather than a true replace — Postgres
-- resolves overloads by exact type list, not by default presence.
-- Kept as a single overload (DROP + CREATE, not just OR REPLACE) to
-- avoid PostgREST ambiguity between two callable `submit_site_lead`
-- signatures; the one caller (site-lead-intake route) is updated in
-- this same change to always pass all 6 args.
-- ============================================================
DROP FUNCTION IF EXISTS public.submit_site_lead(TEXT, TEXT, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.submit_site_lead(
  p_token_hash TEXT,
  p_name TEXT,
  p_phone TEXT,
  p_email TEXT DEFAULT NULL,
  p_utm JSONB DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token lead_intake_tokens%ROWTYPE;
  v_owner_user_id UUID;
  v_contact_id UUID;
  v_pipeline_id UUID;
  v_stage_id UUID;
  v_deal_id UUID;
  v_phone_normalized TEXT := regexp_replace(p_phone, '\D', '', 'g');
BEGIN
  SELECT * INTO v_token
  FROM lead_intake_tokens
  WHERE token_hash = p_token_hash;

  IF NOT FOUND OR v_token.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid or revoked intake token' USING ERRCODE = '22023';
  END IF;

  SELECT owner_user_id INTO v_owner_user_id
  FROM accounts WHERE id = v_token.account_id;

  -- Find or create the contact, scoped to this account, matched on
  -- normalized phone (same dedup key as 022's phone_normalized).
  SELECT id INTO v_contact_id
  FROM contacts
  WHERE account_id = v_token.account_id
    AND phone_normalized = v_phone_normalized
  LIMIT 1;

  IF v_contact_id IS NULL THEN
    INSERT INTO contacts (user_id, account_id, phone, name, email)
    VALUES (v_owner_user_id, v_token.account_id, p_phone, NULLIF(p_name, ''), p_email)
    RETURNING id INTO v_contact_id;
  END IF;

  -- Default pipeline + its first 'open' stage (lowest position).
  -- A brand-new account with no pipeline yet is a real state (nobody
  -- has opened the dashboard to create one) — refuse clearly instead
  -- of inserting a deal with a NULL stage_id, which the NOT NULL
  -- constraint would reject with an opaque 23502 anyway.
  SELECT id INTO v_pipeline_id FROM pipelines
  WHERE account_id = v_token.account_id AND is_default = true;

  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'Account has no default pipeline configured yet' USING ERRCODE = '23514';
  END IF;

  SELECT id INTO v_stage_id FROM pipeline_stages
  WHERE pipeline_id = v_pipeline_id AND stage_type = 'open'
  ORDER BY position ASC
  LIMIT 1;

  IF v_stage_id IS NULL THEN
    RAISE EXCEPTION 'Default pipeline has no open stage configured yet' USING ERRCODE = '23514';
  END IF;

  INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, contact_id, title, source, utm_ref, notes)
  VALUES (
    v_owner_user_id,
    v_token.account_id,
    v_pipeline_id,
    v_stage_id,
    v_contact_id,
    COALESCE(NULLIF(p_name, ''), p_phone),
    'site_form',
    p_utm,
    NULLIF(p_notes, '')
  )
  RETURNING id INTO v_deal_id;

  UPDATE lead_intake_tokens SET last_used_at = NOW() WHERE id = v_token.id;

  RETURN json_build_object('ok', true, 'deal_id', v_deal_id, 'contact_id', v_contact_id);
END;
$$;

ALTER FUNCTION public.submit_site_lead(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.submit_site_lead(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_site_lead(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO anon, authenticated;
