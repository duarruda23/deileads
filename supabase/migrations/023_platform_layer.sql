-- ============================================================
-- 023_platform_layer.sql — CRM Virgo: platform admin layer
--
-- wacrm (post-017) is already multi-tenant-per-account, but every
-- account is fully independent — there is no concept of an operator
-- who manages *many* accounts. CRM Virgo needs exactly that: Virgo
-- is the platform operator, and every account created going forward
-- is one of Virgo's traffic clients (or Virgo's own internal sales
-- pipeline, marked `is_internal`).
--
-- What this migration does
--   1. Adds `platform_role` to `profiles` (nullable — most users
--      have none; only Virgo staff do).
--   2. Adds `is_internal` to `accounts` — true only for Virgo's own
--      reserved account (its "vendedores" use the normal Kanban/inbox
--      UI against this account, no parallel system needed).
--   3. Adds `is_platform_admin()` SECURITY DEFINER helper, mirroring
--      `is_account_member()` from 017.
--   4. Extends the `accounts` / `profiles` RLS policies so a platform
--      admin can read (and, for `accounts`, update) every row, not
--      just the ones they're a member of. Every other table stays
--      scoped to `is_account_member()` only — a platform admin does
--      NOT get blanket read access to every client's leads/messages
--      by default. Cross-account visibility for the admin-geral
--      overview screens goes through dedicated aggregate views/RPCs
--      (added in a follow-up migration once those screens exist),
--      not through relaxing the base tables.
--
-- What this migration does NOT do
--   - Does not grant any `platform_role`. There is no bootstrap admin
--     seeded here — assign the first Super Admin manually after
--     deploy (see the commented example at the bottom) rather than
--     hardcoding an identity into a schema migration.
--   - Does not create the `virgo-interno` account row. Creating it is
--     an application/seed step (needs a real owner_user_id from a
--     real signed-up user), not schema.
--   - Does not touch WhatsApp/Instagram/lead-source tables — those
--     are separate follow-up migrations (024+).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- TYPES
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platform_role_enum') THEN
    CREATE TYPE platform_role_enum AS ENUM ('super_admin');
  END IF;
END $$;

-- ============================================================
-- PROFILES — platform_role
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS platform_role platform_role_enum;

CREATE INDEX IF NOT EXISTS idx_profiles_platform_role
  ON profiles(platform_role) WHERE platform_role IS NOT NULL;

-- ============================================================
-- ACCOUNTS — is_internal (Virgo's own reserved account)
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

-- At most one internal account should ever exist — guards against
-- accidentally flagging a real client account by mistake.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_single_internal
  ON accounts((is_internal))
  WHERE is_internal = true;

-- ============================================================
-- PLATFORM ADMIN HELPER
--
-- Mirrors is_account_member()'s shape (SECURITY DEFINER, STABLE)
-- so it composes the same way inside policy USING/WITH CHECK
-- clauses.
-- ============================================================
CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.platform_role = 'super_admin'
  );
$$;

ALTER FUNCTION is_platform_admin() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_platform_admin() TO authenticated, service_role;

-- ============================================================
-- RLS — ACCOUNTS: platform admins read + update every account
--
-- Client-facing behaviour (is_account_member) is unchanged; this
-- only adds an OR branch for platform admins.
-- ============================================================
DROP POLICY IF EXISTS accounts_select ON accounts;
CREATE POLICY accounts_select ON accounts FOR SELECT
  USING (is_account_member(id) OR is_platform_admin());

DROP POLICY IF EXISTS accounts_update ON accounts;
CREATE POLICY accounts_update ON accounts FOR UPDATE
  USING (is_account_member(id, 'admin') OR is_platform_admin())
  WITH CHECK (is_account_member(id, 'admin') OR is_platform_admin());

-- Platform admins create new accounts (onboarding a client) directly
-- via the admin API — no client-side INSERT policy needed/added here
-- (the signup trigger still handles the personal-account-per-user
-- path for normal sign-ups; admin-created accounts for clients use
-- the service role from the /api/admin/accounts route).

-- ============================================================
-- RLS — PROFILES: platform admins can list who's who across accounts
--
-- Needed for the admin-geral account list to show each account's
-- Cliente Admin. Does not grant UPDATE — a platform admin still
-- cannot edit a client user's profile, only view it.
-- ============================================================
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (auth.uid() = user_id OR is_account_member(account_id) OR is_platform_admin());

-- ============================================================
-- Bootstrap note (manual, post-deploy — do not hardcode an identity
-- into a schema migration):
--
--   UPDATE profiles SET platform_role = 'super_admin'
--   WHERE email = 'eduardo@virgo.example';
-- ============================================================
