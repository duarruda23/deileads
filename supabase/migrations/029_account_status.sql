-- ============================================================
-- 029_account_status.sql — suspend/reactivate a client account
--
-- The escopo's admin-geral MVP includes "suspender/reativar" a
-- client account, but `accounts` has no status column at all today
-- — every account is implicitly active forever. This adds one and,
-- critically, makes it actually mean something: `is_account_member()`
-- (017) is the single choke point every domain table's RLS policy
-- calls through, so teaching it about status is enough to lock a
-- suspended account's own members out of their data without
-- touching a single other policy.
--
-- What this migration does
--   1. `accounts.status` — 'active' | 'suspended', defaults active
--      (every existing account stays exactly as accessible as it
--      was before this migration).
--   2. `is_account_member()` redefined to also require the account
--      be 'active'. Platform admins are unaffected — their access
--      to the `accounts`/`profiles` tables goes through
--      `is_platform_admin()` in a separate OR branch (023), not
--      through this function, so a Super Admin can still see and
--      reactivate a suspended account.
--
-- What this migration does NOT do
--   - Does not touch `accounts_select`/`accounts_update` policies
--     (023) — a platform admin already sees every account
--     regardless of status, which is exactly what's needed to
--     reactivate one.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_status_check'
      AND conrelid = 'accounts'::regclass
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_status_check
      CHECK (status IN ('active', 'suspended'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN accounts a ON a.id = p.account_id
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND a.status = 'active'
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;
