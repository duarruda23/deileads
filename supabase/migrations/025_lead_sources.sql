-- ============================================================
-- 025_lead_sources.sql — CRM Virgo: leads from site forms and
-- native Meta Lead Ads forms, not just from a conversation
--
-- Every `deals` row today implicitly came from a WhatsApp
-- conversation (conversation_id NOT NULL-ish in practice, even
-- though the column allows NULL). CRM Virgo needs deals that exist
-- on the Kanban with zero conversation — a site-form submission or a
-- native Meta Lead Ads fill-out, where the salesperson decides how
-- to reach out (see escopo.md "Cartão de lead sem conversa").
--
-- What this migration does
--   1. `deals.source` — where the deal came from. Backfilled from
--      the linked conversation's channel where one exists, 'manual'
--      otherwise (accurate for every pre-existing row: there was no
--      other way to create a deal before this migration).
--   2. `deals.campaign_ref` / `deals.utm_ref` — attribution data.
--      `campaign_ref` holds a Meta campaign/ad/creative id (native
--      lead form path); `utm_ref` holds the raw query-string params
--      from a site-form submit (site path). Both nullable — most
--      deals won't have either.
--   3. `lead_intake_tokens` — one revocable token per account,
--      authenticating the public `POST /api/public/leads/:accountId`
--      endpoint (no user session there — see arquitetura-tecnica.md).
--      Stores `token_hash` (SHA-256) only, exact same pattern as
--      `account_invitations.token_hash` from 017 — a leaked DB
--      snapshot must not yield a usable token. The plaintext token
--      is shown to the Cliente Admin exactly once, at creation.
--
-- What this migration does NOT do
--   - Does not add the native Meta Lead Ads webhook-subscription
--     bookkeeping (which Page is subscribed, leadgen_id processed
--     log) — that's an application/API concern, not schema, and can
--     reuse `deals.campaign_ref` + `created_at` for basic dedup
--     without a dedicated table until proven insufficient.
--   - Does not build the "hosted form builder" from the escopo's
--     Segunda Fase — this migration only makes deals.source /
--     utm_ref exist so *any* site form (Virgo-built LP or the
--     client's own) can start populating the Kanban immediately.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- DEALS — source + attribution
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'deal_source_enum') THEN
    CREATE TYPE deal_source_enum AS ENUM ('whatsapp', 'instagram', 'site_form', 'meta_leadgen', 'manual');
  END IF;
END $$;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS source deal_source_enum,
  ADD COLUMN IF NOT EXISTS campaign_ref TEXT,
  ADD COLUMN IF NOT EXISTS utm_ref JSONB;

-- Backfill: infer from the linked conversation's channel; deals with
-- no conversation predate this migration and had no other origin.
UPDATE deals d
SET source = c.channel::deal_source_enum
FROM conversations c
WHERE d.conversation_id = c.id
  AND d.source IS NULL;

UPDATE deals SET source = 'manual' WHERE source IS NULL;

ALTER TABLE deals ALTER COLUMN source SET NOT NULL;
ALTER TABLE deals ALTER COLUMN source SET DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_deals_source ON deals(source);
CREATE INDEX IF NOT EXISTS idx_deals_campaign_ref ON deals(campaign_ref) WHERE campaign_ref IS NOT NULL;

-- deals.contact_id / pipeline_id / stage_id are NOT NULL today —
-- fine for the conversation-first flow, but a lead-source intake
-- (site/native) needs to create contact + deal atomically without a
-- conversation. That's an application-layer concern (the intake
-- route creates the contact row first, in the same request, before
-- inserting the deal) — no schema relaxation needed since a contact
-- always exists by the time a deal is written, conversation or not.

-- ============================================================
-- LEAD_INTAKE_TOKENS
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_intake_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lead_intake_tokens_account
  ON lead_intake_tokens(account_id)
  WHERE revoked_at IS NULL;

ALTER TABLE lead_intake_tokens ENABLE ROW LEVEL SECURITY;

-- Same visibility model as account_invitations (017): admins+ manage
-- them client-side; the public intake route looks up by token_hash
-- via the service role (bypasses RLS), never via a client session.
DROP POLICY IF EXISTS lead_intake_tokens_select ON lead_intake_tokens;
CREATE POLICY lead_intake_tokens_select ON lead_intake_tokens FOR SELECT
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS lead_intake_tokens_modify ON lead_intake_tokens;
CREATE POLICY lead_intake_tokens_modify ON lead_intake_tokens FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
