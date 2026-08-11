-- ============================================================
-- 024_instagram_channel.sql — CRM Virgo: Instagram Direct as a
-- second channel alongside WhatsApp
--
-- wacrm's schema hard-assumes WhatsApp everywhere: contacts are
-- identified by `phone` (NOT NULL), and `conversations` has no
-- notion of "which channel this thread is on" because there was
-- only ever one. This migration generalises both, following the
-- same one-config-per-account pattern whatsapp_config already uses
-- (see 017's "one WhatsApp number per account" comment) rather than
-- introducing a new generic "channels" abstraction — mirroring what
-- already works is less risk than a new abstraction layer.
--
-- What this migration does
--   1. `instagram_config` — mirrors `whatsapp_config`'s shape
--      (account-scoped, one per account, access token + connection
--      state). Instagram Messaging API auth is an IG Business
--      Account id + a Page-scoped access token, not a phone number.
--   2. `conversations.channel` — 'whatsapp' | 'instagram', NOT NULL.
--      Backfilled to 'whatsapp' for every existing row (accurate:
--      whatsapp was the only channel that could have created them).
--      Messages don't get their own channel column — they inherit
--      it from their conversation.
--   3. `contacts.phone` → nullable, + `instagram_user_id` /
--      `instagram_username`. An Instagram-only contact (first
--      touched via IG, never gave a phone number) has no phone —
--      forcing NOT NULL here was the wacrm-is-whatsapp-only
--      assumption leaking into the data model. A CHECK constraint
--      keeps every contact identifiable by at least one channel.
--   4. Dedup for `instagram_user_id`, mirroring 022's phone dedup
--      (partial UNIQUE index, no generated/normalised column needed
--      since IGSIDs are already a fixed numeric string — no format
--      variance like phone numbers have).
--
-- What this migration does NOT do
--   - Does not touch `merge_duplicate_contacts()` (022) — that
--     function only ever matched on phone_normalized. An Instagram-
--     duplicate-merge pass is a follow-up if it turns out to be
--     needed in practice, not assumed upfront.
--   - Does not add Instagram-equivalents of `message_templates` /
--     broadcasts. Instagram's 24-hour-window template requirement
--     works differently from WhatsApp's (Meta-approved HSM templates
--     don't exist the same way) — that's its own follow-up once the
--     inbox itself works.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- INSTAGRAM_CONFIG
-- ============================================================
CREATE TABLE IF NOT EXISTS instagram_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,               -- Facebook Page backing the IG account
  ig_business_account_id TEXT NOT NULL, -- Instagram Business Account id
  access_token TEXT NOT NULL,           -- Page-scoped token (encrypt at rest, same as whatsapp_config.access_token)
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  last_registration_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One Instagram account per CRM account — same invariant as
-- whatsapp_config's UNIQUE(account_id) from 017.
CREATE UNIQUE INDEX IF NOT EXISTS idx_instagram_config_account
  ON instagram_config(account_id);

ALTER TABLE instagram_config ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON instagram_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON instagram_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS — same tiers as whatsapp_config (settings-class: admin+ writes).
DROP POLICY IF EXISTS instagram_config_select ON instagram_config;
CREATE POLICY instagram_config_select ON instagram_config FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS instagram_config_insert ON instagram_config;
CREATE POLICY instagram_config_insert ON instagram_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS instagram_config_update ON instagram_config;
CREATE POLICY instagram_config_update ON instagram_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS instagram_config_delete ON instagram_config;
CREATE POLICY instagram_config_delete ON instagram_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- CONVERSATIONS — channel
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT;

UPDATE conversations SET channel = 'whatsapp' WHERE channel IS NULL;

ALTER TABLE conversations ALTER COLUMN channel SET NOT NULL;
ALTER TABLE conversations ALTER COLUMN channel SET DEFAULT 'whatsapp';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_channel_check'
      AND conrelid = 'conversations'::regclass
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_channel_check
      CHECK (channel IN ('whatsapp', 'instagram'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel);

-- ============================================================
-- CONTACTS — Instagram identity, phone becomes optional
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS instagram_user_id TEXT,   -- IGSID (numeric string), stable per contact per app
  ADD COLUMN IF NOT EXISTS instagram_username TEXT;  -- @handle, display-only — can change, never used for lookup

ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_has_identity_check'
      AND conrelid = 'contacts'::regclass
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_has_identity_check
      CHECK (phone IS NOT NULL OR instagram_user_id IS NOT NULL);
  END IF;
END $$;

-- Dedup per account, mirroring 022 (partial index — NULLs excluded
-- automatically, no merge-function needed since this is a fresh
-- column with no pre-existing duplicates to clean up).
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_instagram_user_id
  ON contacts (account_id, instagram_user_id)
  WHERE instagram_user_id IS NOT NULL;
