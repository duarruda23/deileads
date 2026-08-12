-- ============================================================
-- 027_site_lead_intake.sql — submit_site_lead RPC
--
-- Backs POST /api/public/leads/[accountId] — the public, no-session
-- endpoint a site form (Virgo-built LP or the client's own) posts to.
-- Same shape as the invitation RPCs in 019: SECURITY DEFINER,
-- SQLSTATE-coded refusals, granted to `anon`.
--
-- What this migration does
--   1. `pipelines.is_default` — a site-form lead has to land
--      *somewhere* on the Kanban with no human picking a pipeline.
--      Adds a per-account "this is the one" flag (at most one true
--      per account, mirroring 026's one-won/one-lost-stage pattern),
--      backfilled to each account's oldest pipeline so every
--      existing account already has a default without anyone having
--      to configure anything.
--   2. `submit_site_lead(...)` RPC — validates the token, finds or
--      creates the contact by phone, creates a `deals` row with
--      `source = 'site_form'` in the default pipeline's first
--      'open' stage, stamps `utm_ref`, and updates the token's
--      `last_used_at`.
--
-- Sender-of-record for the NOT NULL `contacts.user_id` /
-- `deals.user_id` FKs: `accounts.owner_user_id` — same "arbitrary
-- but stable" choice the WhatsApp webhook makes with the config
-- owner (see processMessage()'s comment in
-- src/app/api/whatsapp/webhook/route.ts), just anchored to the
-- account instead of a specific channel config since a site form
-- isn't tied to any one channel.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- PIPELINES — is_default
-- ============================================================
ALTER TABLE pipelines
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipelines_one_default_per_account
  ON pipelines(account_id) WHERE is_default = true;

-- Backfill: oldest pipeline per account becomes the default, only
-- for accounts that don't already have one marked.
WITH ranked AS (
  SELECT id, account_id,
         row_number() OVER (PARTITION BY account_id ORDER BY created_at ASC, id ASC) AS rn
  FROM pipelines
)
UPDATE pipelines p
SET is_default = true
FROM ranked r
WHERE p.id = r.id
  AND r.rn = 1
  AND NOT EXISTS (
    SELECT 1 FROM pipelines d WHERE d.account_id = p.account_id AND d.is_default = true
  );

-- ============================================================
-- submit_site_lead(...)
--
-- Refusal codes (SQLSTATE), matching the invitation RPCs' pattern:
--   22023 — token not found / revoked (route maps to 400)
--   23514 — account has no pipeline/stage to receive the lead into
--           yet (route maps to 409 — "reason: not_configured", a
--           real state for a brand-new account nobody has opened
--           the Kanban on yet)
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_site_lead(
  p_token_hash TEXT,
  p_name TEXT,
  p_phone TEXT,
  p_email TEXT DEFAULT NULL,
  p_utm JSONB DEFAULT NULL
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

  INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, contact_id, title, source, utm_ref)
  VALUES (
    v_owner_user_id,
    v_token.account_id,
    v_pipeline_id,
    v_stage_id,
    v_contact_id,
    COALESCE(NULLIF(p_name, ''), p_phone),
    'site_form',
    p_utm
  )
  RETURNING id INTO v_deal_id;

  UPDATE lead_intake_tokens SET last_used_at = NOW() WHERE id = v_token.id;

  RETURN json_build_object('ok', true, 'deal_id', v_deal_id, 'contact_id', v_contact_id);
END;
$$;

ALTER FUNCTION public.submit_site_lead(TEXT, TEXT, TEXT, TEXT, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.submit_site_lead(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_site_lead(TEXT, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;
