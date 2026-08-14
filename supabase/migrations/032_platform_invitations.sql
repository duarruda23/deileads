-- ============================================================
-- 032_platform_invitations.sql — token-based platform onboarding
--
-- Why this exists
-- ----------------
-- `admin_create_account` (030) and `admin_add_virgo_seller` (030)
-- were originally driven by `/api/admin/accounts` and
-- `/api/admin/platform-users`, which called
-- `supabase.auth.admin.inviteUserByEmail()` to create the person
-- and email them a "set your password" link. That depends on the
-- project's mailer actually delivering — this project has no SMTP
-- configured and `mailer_autoconfirm` is off, so the email never
-- arrives and the invitee has no way to set a password. Confirmed
-- in practice: the Super Admin sent an invite and the recipient
-- landed on the plain login screen with no account to sign into.
--
-- Fix: mirror `account_invitations` (017/019) — a shareable,
-- token-based link the admin copies/sends themselves (WhatsApp,
-- whatever), with password creation happening entirely server-side
-- (see `createAndSignInInvitee` in src/lib/auth/invite-signup.ts,
-- which uses the Admin API's `createUser({ email_confirm: true })`
-- instead of the client `signUp()` + confirmation-email path).
-- No outbound email involved anywhere in this flow.
--
-- Two invitation kinds share one table because they're the same
-- shape (a link that, once redeemed by an authenticated caller,
-- provisions something) and the same UI (/join/<token>):
--   - 'new_account'  — creates a brand-new client account with the
--     redeemer as its owner (account_name is the account to create).
--   - 'virgo_seller' — adds the redeemer to virgo-interno as an
--     agent (account_name is irrelevant, always NULL).
--
-- Unlike account_invitations, there's no `role` column — the kind
-- itself determines what redemption does.
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind TEXT NOT NULL CHECK (kind IN ('new_account', 'virgo_seller')),
  account_name TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT platform_invitations_account_name_required
    CHECK (kind <> 'new_account' OR account_name IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_platform_invitations_pending
  ON platform_invitations(expires_at)
  WHERE accepted_at IS NULL;

ALTER TABLE platform_invitations ENABLE ROW LEVEL SECURITY;

-- Only Super Admins ever see/manage these rows via the client SDK.
-- The peek RPC below is the only anonymous-reachable surface, and
-- it's SECURITY DEFINER (bypasses RLS by design, same as
-- peek_invitation).
DROP POLICY IF EXISTS platform_invitations_select ON platform_invitations;
CREATE POLICY platform_invitations_select ON platform_invitations FOR SELECT
  USING (is_platform_admin());

DROP POLICY IF EXISTS platform_invitations_modify ON platform_invitations;
CREATE POLICY platform_invitations_modify ON platform_invitations FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- ============================================================
-- peek_platform_invitation(p_token_hash text)
--
-- Same contract as peek_invitation (019): anonymous read by token
-- hash, uniform { ok, reason? } / { ok, kind, account_name?,
-- expires_at } JSON shape so /join/<token> doesn't special-case
-- which table matched.
-- ============================================================
CREATE OR REPLACE FUNCTION public.peek_platform_invitation(
  p_token_hash TEXT
) RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv platform_invitations%ROWTYPE;
BEGIN
  SELECT * INTO v_inv
  FROM platform_invitations
  WHERE token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'used');
  END IF;

  IF v_inv.expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'reason', 'expired');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'kind', v_inv.kind,
    'account_name', v_inv.account_name,
    'expires_at', v_inv.expires_at
  );
END;
$$;

ALTER FUNCTION public.peek_platform_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.peek_platform_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_platform_invitation(TEXT) TO anon, authenticated;

-- ============================================================
-- redeem_platform_invitation(p_token_hash text)
--
-- Authenticated. By the time this is called, the caller already
-- exists as an auth.users row with a fresh personal account (either
-- because they just self-registered via createAndSignInInvitee, or
-- — edge case — they redeemed while already logged in). Dispatches
-- to the existing 030 RPCs, which already encapsulate the "move
-- profile into the right account" logic — this function only owns
-- invite validation + marking it accepted.
--
-- Calling admin_create_account/admin_add_virgo_seller here works
-- despite them being GRANTed to service_role only: both are
-- SECURITY DEFINER owned by `postgres`, and so is this function —
-- Postgres object owners always retain implicit EXECUTE on their
-- own functions regardless of REVOKE ALL FROM PUBLIC, so the call
-- succeeds without widening either function's grants.
--
-- Refusal codes mirror redeem_invitation (019):
--   22023 — invite invalid (not_found / used / expired)
--   42501 — caller not authenticated
-- ============================================================
CREATE OR REPLACE FUNCTION public.redeem_platform_invitation(
  p_token_hash TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv platform_invitations%ROWTYPE;
  v_account_id UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM platform_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  IF v_inv.kind = 'new_account' THEN
    v_account_id := admin_create_account(v_inv.account_name, v_caller_id);
  ELSIF v_inv.kind = 'virgo_seller' THEN
    v_account_id := admin_add_virgo_seller(v_caller_id, v_inv.created_by_user_id);
  ELSE
    RAISE EXCEPTION 'Unknown invitation kind' USING ERRCODE = '22023';
  END IF;

  UPDATE platform_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  RETURN json_build_object('ok', true, 'kind', v_inv.kind, 'accountId', v_account_id);
END;
$$;

ALTER FUNCTION public.redeem_platform_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_platform_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_platform_invitation(TEXT) TO authenticated;
