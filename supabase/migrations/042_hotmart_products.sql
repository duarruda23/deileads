-- ============================================================
-- 042_hotmart_products.sql — Hotmart product catalog + auto-tagging
--
-- Closes the gap flagged 05-07/09/2026: the Hotmart webhook (033)
-- only ever knew buyer/price/UTM data, never *which product* was
-- bought — so an account selling several Hotmart products had no
-- way to tell them apart in the CRM. This migration adds:
--
--   1. API credentials on hotmart_config (Client ID + encrypted
--      Client Secret) — separate from the Hottok, which only
--      authenticates inbound webhook calls and can't be used to
--      call Hotmart's own API back.
--   2. hotmart_products — a per-account cache of the seller's real
--      Hotmart catalog, populated by /api/account/hotmart-products/sync
--      (pulls Hotmart's Product List API) and, defensively, by the
--      webhook itself the first time it sees a product id it
--      doesn't recognize yet (so the catalog is never stuck empty
--      just because nobody has pressed "sync" — see submit_hotmart_lead
--      below).
--   3. hotmart_product_groups — the "produtos correlacionados" the
--      account admin defines by hand: several raw Hotmart products
--      (e.g. two price variants of the same offer) folded into one
--      logical product, linked to one tag. A product belongs to at
--      most one group — hence group_id lives directly on
--      hotmart_products rather than a many-to-many join table.
--   4. submit_hotmart_lead gains p_product_id/p_product_name: when a
--      purchase event's product resolves to a group with a tag, the
--      contact gets that tag automatically — no per-account
--      automation needs to be hand-built just to know "this lead
--      bought the Desafio". Classification that *combines* multiple
--      tags (e.g. "comprou Desafio E Análise") is still a job for
--      the existing automations engine (tag_added trigger +
--      tag_presence condition) — this migration only guarantees the
--      base ingredient (the right tag lands on the right contact)
--      is there to build on.
--
-- Builds on top of 041 (contact-insert race fix) — this is the
-- current real signature/body of submit_hotmart_lead as of this
-- migration, confirmed by reading 037 and 041 directly rather than
-- assuming 033's original shape was still current. DROP+CREATE
-- (not CREATE OR REPLACE) matches the convention 037/041 already
-- established for this function.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- HOTMART_CONFIG — API credentials for calling Hotmart back
-- ============================================================
ALTER TABLE hotmart_config
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS client_secret TEXT,
  ADD COLUMN IF NOT EXISTS products_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN hotmart_config.client_id IS
  'Hotmart OAuth client id (Ferramentas -> Credenciais, NOT the Hottok). Plaintext -- not a secret on its own.';
COMMENT ON COLUMN hotmart_config.client_secret IS
  'Hotmart OAuth client secret, AES-256-GCM encrypted at rest via src/lib/whatsapp/encryption.ts (encrypt()/decrypt(), keyed by ENCRYPTION_KEY). Same reasoning as whatsapp_config.access_token: must be reversible to call Hotmart''s API, so it can''t be hashed like the Hottok.';

-- ============================================================
-- HOTMART_PRODUCT_GROUPS -- the account's own "produto correlacionado"
-- ============================================================
CREATE TABLE IF NOT EXISTS hotmart_product_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Nullable: an admin can create the group first and wire the tag
  -- later. ON DELETE SET NULL rather than CASCADE -- deleting a tag
  -- elsewhere in Settings shouldn't silently delete the grouping.
  tag_id UUID REFERENCES tags(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotmart_product_groups_account
  ON hotmart_product_groups(account_id);

ALTER TABLE hotmart_product_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hotmart_product_groups_select ON hotmart_product_groups;
CREATE POLICY hotmart_product_groups_select ON hotmart_product_groups FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS hotmart_product_groups_insert ON hotmart_product_groups;
CREATE POLICY hotmart_product_groups_insert ON hotmart_product_groups FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS hotmart_product_groups_update ON hotmart_product_groups;
CREATE POLICY hotmart_product_groups_update ON hotmart_product_groups FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS hotmart_product_groups_delete ON hotmart_product_groups;
CREATE POLICY hotmart_product_groups_delete ON hotmart_product_groups FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON hotmart_product_groups;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hotmart_product_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- HOTMART_PRODUCTS -- cache of the account's real Hotmart catalog
-- ============================================================
CREATE TABLE IF NOT EXISTS hotmart_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Hotmart's own numeric product id, kept as text (same convention
  -- as deals.external_ref for Hotmart's transaction id -- we never
  -- do arithmetic on it, and text sidesteps any bigint/precision
  -- mismatch with whatever Hotmart's API actually returns).
  hotmart_product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  group_id UUID REFERENCES hotmart_product_groups(id) ON DELETE SET NULL,
  -- NULL until the Product List API has actually returned this row;
  -- a product first seen via the webhook (see submit_hotmart_lead)
  -- is inserted with this left NULL so the UI can tell "confirmed by
  -- a real sync" apart from "guessed from one purchase event".
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, hotmart_product_id)
);

CREATE INDEX IF NOT EXISTS idx_hotmart_products_account
  ON hotmart_products(account_id);
CREATE INDEX IF NOT EXISTS idx_hotmart_products_group
  ON hotmart_products(group_id) WHERE group_id IS NOT NULL;

ALTER TABLE hotmart_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hotmart_products_select ON hotmart_products;
CREATE POLICY hotmart_products_select ON hotmart_products FOR SELECT
  USING (is_account_member(account_id));
-- INSERT/DELETE are service-role-only in practice (sync route + the
-- webhook's service-role client) -- no browser flow ever creates or
-- removes a catalog row directly. UPDATE is exposed to admins
-- because assigning group_id from the "produtos correlacionados"
-- screen is a normal RLS-scoped write, same tier as tags.
DROP POLICY IF EXISTS hotmart_products_update ON hotmart_products;
CREATE POLICY hotmart_products_update ON hotmart_products FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON hotmart_products;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hotmart_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- submit_hotmart_lead -- add product id/name, auto-tag on group match
--
-- Everything below the "PRODUCT RESOLUTION" comment is new; every
-- other line is copied verbatim from 041 so its race-condition fix
-- and won-transition value/currency logic survive unchanged.
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
  p_currency TEXT DEFAULT NULL,
  p_product_id TEXT DEFAULT NULL,
  p_product_name TEXT DEFAULT NULL
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
  v_hotmart_product_row_id UUID;
  v_tag_id UUID;
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
  -- unique index (022) instead of SELECT-then-INSERT (041's race fix)
  -- -- two overlapping Hotmart events for the same buyer can both
  -- miss on a SELECT and race the INSERT.
  INSERT INTO contacts (user_id, account_id, phone, name, email)
  VALUES (v_owner_user_id, v_config.account_id, p_phone, NULLIF(p_name, ''), p_email)
  ON CONFLICT (account_id, phone_normalized) WHERE phone_normalized <> '' DO NOTHING
  RETURNING id INTO v_contact_id;

  IF v_contact_id IS NULL THEN
    SELECT id INTO v_contact_id FROM contacts
    WHERE account_id = v_config.account_id AND phone_normalized = v_phone_normalized
    LIMIT 1;
  END IF;

  -- Most recent Hotmart-sourced deal for this contact, if any --
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

  -- ----------------------------------------------------------
  -- PRODUCT RESOLUTION + AUTO-TAG.
  --
  -- Runs on every event that carries a product id, not only
  -- PURCHASE_APPROVED -- a cart-abandonment or billet-printed lead
  -- benefits from the same segmentation while the sale is still
  -- open, which is exactly what the 05/09 request asked for
  -- ("conforme os leads do desafio vao entrando em contato... ja
  -- cair essa separacao").
  -- ----------------------------------------------------------
  IF p_product_id IS NOT NULL AND btrim(p_product_id) <> '' THEN
    -- Register the product the first time it's seen, even before
    -- anyone presses "Sincronizar produtos" -- keeps the catalog from
    -- being stuck empty. synced_at stays NULL so the UI can tell
    -- this apart from a row the Product List API actually confirmed.
    -- Race-safe for the same reason the contact insert above is:
    -- ON CONFLICT DO NOTHING, then a fallback SELECT.
    INSERT INTO hotmart_products (account_id, hotmart_product_id, name)
    VALUES (v_config.account_id, p_product_id, COALESCE(NULLIF(p_product_name, ''), p_product_id))
    ON CONFLICT (account_id, hotmart_product_id) DO NOTHING
    RETURNING id INTO v_hotmart_product_row_id;

    IF v_hotmart_product_row_id IS NULL THEN
      -- Conflict -- the row already existed. Fetch its id, and if it
      -- was previously stored with the id-as-placeholder name (an
      -- earlier event that carried no product.name) and this event
      -- now has a real one, backfill it.
      SELECT id INTO v_hotmart_product_row_id FROM hotmart_products
      WHERE account_id = v_config.account_id AND hotmart_product_id = p_product_id;

      IF p_product_name IS NOT NULL AND btrim(p_product_name) <> '' THEN
        UPDATE hotmart_products SET name = p_product_name
        WHERE id = v_hotmart_product_row_id AND name = p_product_id;
      END IF;
    END IF;

    SELECT g.tag_id INTO v_tag_id
    FROM hotmart_products hp
    JOIN hotmart_product_groups g ON g.id = hp.group_id
    WHERE hp.id = v_hotmart_product_row_id;

    IF v_tag_id IS NOT NULL THEN
      INSERT INTO contact_tags (contact_id, tag_id)
      VALUES (v_contact_id, v_tag_id)
      ON CONFLICT (contact_id, tag_id) DO NOTHING;
    END IF;
  END IF;

  RETURN json_build_object(
    'ok', true, 'deal_id', v_deal_id, 'contact_id', v_contact_id,
    'tag_applied', v_tag_id IS NOT NULL
  );
END;
$$;

ALTER FUNCTION public.submit_hotmart_lead(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT, TEXT, TEXT
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.submit_hotmart_lead(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_hotmart_lead(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, TEXT, TEXT, TEXT
) TO anon;
