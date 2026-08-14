-- ============================================================
-- 033_hotmart_integration.sql — native Hotmart webhook integration
--
-- Any account can now wire up Hotmart directly (Settings → Hotmart):
-- paste the Hottok from their Hotmart account, pick which purchase
-- events should create/advance a Kanban lead, and point Hotmart's
-- webhook config at one fixed URL (POST /api/public/hotmart).
--
-- How Hotmart's webhook works (developers.hotmart.com, fetched
-- 14/08/2026) — this migration's design follows directly from it:
--   - Every request carries `X-HOTMART-HOTTOK`, a token fixed per
--     Hotmart account (not per-webhook, not per-event). Hotmart
--     doesn't let us template the destination URL with an account
--     id — we give them ONE URL to paste into their panel — so the
--     hottok itself is what tells us which Deileads account a given
--     request belongs to. `hottok_hash` is therefore UNIQUE and IS
--     the lookup key, same shape as invitation/lead-intake tokens
--     but looked up by hash instead of a path segment.
--   - `PURCHASE_APPROVED` / `PURCHASE_BILLET_PRINTED` payloads carry
--     `data.purchase.transaction` (stable across an order's whole
--     lifecycle) but `PURCHASE_OUT_OF_SHOPPING_CART` (cart
--     abandonment) does NOT — it fires before any transaction
--     exists. So transaction id can't be the cross-event dedup key.
--     Phone (already the dedup key for site-lead-intake, 027) is the
--     one field every event shape reliably carries when the buyer
--     gave it — reused here for the same purpose.
--
-- What this migration does
--   1. `deal_source_enum` gains 'hotmart'.
--   2. `deals.external_ref` — free-text slot for `purchase.transaction`
--      when the event provides one (support/debugging reference, not
--      the dedup key — see above).
--   3. `hotmart_config` — one row per account, same tier as
--      `whatsapp_config`/`instagram_config`. `enabled_events` is a
--      plain TEXT[] rather than an enum-backed table: Hotmart may add
--      event types over time, and the UI only ever offers a curated
--      subset (see hotmart-config.tsx) — nothing here needs to change
--      when that subset grows.
--   4. `submit_hotmart_lead(...)` RPC — same SECURITY DEFINER /
--      SQLSTATE-coded-refusal shape as `submit_site_lead` (027).
--      Business rule: an approval-type event always advances the
--      contact's most recent Hotmart-sourced deal to the pipeline's
--      'won' stage; every other enabled event only creates a deal if
--      the contact doesn't already have one — it never moves a deal
--      backward. A card that reached 'won' from an early test event
--      never gets un-won by a late-arriving webhook retry.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- DEALS — 'hotmart' source + external_ref
-- ============================================================
ALTER TYPE deal_source_enum ADD VALUE IF NOT EXISTS 'hotmart';

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS external_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_deals_external_ref
  ON deals(external_ref) WHERE external_ref IS NOT NULL;

-- ============================================================
-- HOTMART_CONFIG
-- ============================================================
CREATE TABLE IF NOT EXISTS hotmart_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  hottok_hash TEXT NOT NULL UNIQUE,
  enabled_events TEXT[] NOT NULL DEFAULT ARRAY[
    'PURCHASE_OUT_OF_SHOPPING_CART',
    'PURCHASE_BILLET_PRINTED',
    'PURCHASE_APPROVED'
  ],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One Hotmart connection per CRM account — same invariant as
-- whatsapp_config/instagram_config.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hotmart_config_account
  ON hotmart_config(account_id);

ALTER TABLE hotmart_config ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON hotmart_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hotmart_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS — same tiers as instagram_config (settings-class: admin+ writes).
DROP POLICY IF EXISTS hotmart_config_select ON hotmart_config;
CREATE POLICY hotmart_config_select ON hotmart_config FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS hotmart_config_insert ON hotmart_config;
CREATE POLICY hotmart_config_insert ON hotmart_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS hotmart_config_update ON hotmart_config;
CREATE POLICY hotmart_config_update ON hotmart_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS hotmart_config_delete ON hotmart_config;
CREATE POLICY hotmart_config_delete ON hotmart_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- submit_hotmart_lead(...)
--
-- Refusal codes (SQLSTATE), matching submit_site_lead's pattern:
--   22023 — no account has this hottok configured (route maps to 400)
--   23514 — account's default pipeline is missing a required stage
--           (route maps to 409)
-- A disabled event or a payload with no phone are NOT refusals —
-- Hotmart doesn't retry on 4xx/5xx forever and we don't want it to;
-- both return `{ ok: true, skipped: true, reason: ... }` with 200.
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_hotmart_lead(
  p_hottok_hash TEXT,
  p_event TEXT,
  p_name TEXT,
  p_phone TEXT,
  p_email TEXT DEFAULT NULL,
  p_transaction TEXT DEFAULT NULL,
  p_utm JSONB DEFAULT NULL
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

  SELECT owner_user_id INTO v_owner_user_id FROM accounts WHERE id = v_config.account_id;

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
        utm_ref = COALESCE(utm_ref, p_utm)
    WHERE id = v_deal_id;
  ELSE
    INSERT INTO deals (user_id, account_id, pipeline_id, stage_id, contact_id, title, source, utm_ref, external_ref)
    VALUES (
      v_owner_user_id, v_config.account_id, v_pipeline_id, v_target_stage_id, v_contact_id,
      COALESCE(NULLIF(p_name, ''), p_phone), 'hotmart', p_utm, p_transaction
    )
    RETURNING id INTO v_deal_id;
  END IF;

  RETURN json_build_object('ok', true, 'deal_id', v_deal_id, 'contact_id', v_contact_id);
END;
$$;

ALTER FUNCTION public.submit_hotmart_lead(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.submit_hotmart_lead(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_hotmart_lead(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO anon;
