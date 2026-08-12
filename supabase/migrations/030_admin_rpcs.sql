-- ============================================================
-- 030_admin_rpcs.sql — admin_create_account + admin_add_virgo_seller
--
-- Both RPCs are called from Next.js API routes AFTER the route has
-- already verified the caller is a Super Admin using the caller's
-- own session (src/lib/auth/platform.ts's requirePlatformAdmin()).
-- The RPCs themselves then run via the service-role client, which
-- is why they're granted to `service_role` only, not `authenticated`
-- — the authorization check already happened one layer up in TS;
-- these are privileged operations that should never be reachable
-- directly from a client session even if the TS check were somehow
-- bypassed.
--
-- Why a brand-new auth.users signup gets "moved," not inserted:
-- `handle_new_user()` (017) fires on every new auth.users row and
-- gives it a personal account + owner profile automatically — that
-- includes users created via the Admin API (inviteUserByEmail),
-- which is how the API route creates the person before calling
-- either RPC below. So both RPCs reuse the exact "move profile,
-- delete the now-empty orphan account" logic `redeem_invitation`
-- (019) already proved out, rather than reinventing it.
--
-- admin_create_account(p_account_name, p_owner_user_id)
--   New client account. Creates it, moves p_owner_user_id's profile
--   there as 'owner', deletes their orphan personal account, and
--   seeds a default pipeline + first open stage so the account is
--   immediately usable (including for site-lead-intake, which
--   requires a default pipeline to exist — see 027).
--
-- admin_add_virgo_seller(p_new_user_id, p_acting_admin_user_id)
--   Adds a Virgo salesperson to the platform's own reserved
--   "virgo-interno" account (023's `is_internal`), as an 'agent'
--   (this codebase's role name for "Vendedor/Atendente" in the
--   escopo's language). Bootstraps the internal account on first
--   call if it doesn't exist yet — 023 deliberately didn't seed it
--   (no real user to own it at migration time); this is that seed
--   step, using whichever Super Admin happens to invite the first
--   seller as the owner.
--
-- Idempotent — safe to run multiple times (the functions themselves;
-- calling them twice with the same user obviously moves that user
-- twice, which is a caller error, not a migration concern).
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_create_account(
  p_account_name TEXT,
  p_owner_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_account_id UUID;
  v_old_account_id UUID;
  v_default_pipeline_id UUID;
  v_full_name TEXT;
  v_email TEXT;
  v_avatar_url TEXT;
BEGIN
  -- `accounts.owner_user_id` is UNIQUE (017's "one account per user"
  -- invariant) — a NEW account can't be inserted for this user while
  -- their auto-created personal account (same owner_user_id) still
  -- exists, even momentarily within this same transaction (Postgres
  -- checks UNIQUE immediately, not deferred). So this has to delete-
  -- then-recreate, not insert-then-delete like it first looked.
  --
  -- Deleting the old account CASCADEs and removes the owner's profile
  -- row too (profiles.account_id ON DELETE CASCADE) — capture what a
  -- fresh profile row needs before that happens, then reinsert it
  -- pointed at the new account.
  SELECT account_id, full_name, email, avatar_url
  INTO v_old_account_id, v_full_name, v_email, v_avatar_url
  FROM profiles WHERE user_id = p_owner_user_id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  INSERT INTO accounts (name, owner_user_id)
  VALUES (p_account_name, p_owner_user_id)
  RETURNING id INTO v_new_account_id;

  INSERT INTO profiles (user_id, full_name, email, avatar_url, account_id, account_role)
  VALUES (p_owner_user_id, v_full_name, v_email, v_avatar_url, v_new_account_id, 'owner');

  -- Seed a default pipeline so the account works immediately for
  -- site-lead-intake (027) without anyone opening the Kanban first.
  INSERT INTO pipelines (user_id, account_id, name, is_default)
  VALUES (p_owner_user_id, v_new_account_id, 'Vendas', true)
  RETURNING id INTO v_default_pipeline_id;

  INSERT INTO pipeline_stages (pipeline_id, name, position, stage_type)
  VALUES
    (v_default_pipeline_id, 'Novo Lead', 0, 'open'),
    (v_default_pipeline_id, 'Em Contato', 1, 'open'),
    (v_default_pipeline_id, 'Qualificado', 2, 'open'),
    (v_default_pipeline_id, 'Fechado Ganho', 3, 'won'),
    (v_default_pipeline_id, 'Fechado Perdido', 4, 'lost');

  RETURN v_new_account_id;
END;
$$;

ALTER FUNCTION public.admin_create_account(TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_create_account(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_account(TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_add_virgo_seller(
  p_new_user_id UUID,
  p_acting_admin_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_internal_account_id UUID;
  v_old_account_id UUID;
  v_full_name TEXT;
  v_email TEXT;
  v_avatar_url TEXT;
BEGIN
  SELECT id INTO v_internal_account_id
  FROM accounts WHERE is_internal = true;

  IF v_internal_account_id IS NULL THEN
    -- Same delete-then-recreate reasoning as admin_create_account —
    -- can't INSERT a new account for p_acting_admin_user_id while
    -- their personal account (same owner_user_id) still exists.
    SELECT account_id, full_name, email, avatar_url
    INTO v_old_account_id, v_full_name, v_email, v_avatar_url
    FROM profiles WHERE user_id = p_acting_admin_user_id;

    DELETE FROM accounts WHERE id = v_old_account_id;

    INSERT INTO accounts (name, owner_user_id, is_internal)
    VALUES ('Virgo (Interno)', p_acting_admin_user_id, true)
    RETURNING id INTO v_internal_account_id;

    INSERT INTO profiles (user_id, full_name, email, avatar_url, account_id, account_role)
    VALUES (p_acting_admin_user_id, v_full_name, v_email, v_avatar_url, v_internal_account_id, 'owner');
  END IF;

  -- The new seller is only ever moving INTO virgo-interno (never
  -- creating an account of their own), so this part has no ordering
  -- hazard — same shape as redeem_invitation (019).
  SELECT account_id INTO v_old_account_id
  FROM profiles WHERE user_id = p_new_user_id;

  UPDATE profiles
  SET account_id = v_internal_account_id,
      account_role = 'agent'
  WHERE user_id = p_new_user_id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_internal_account_id;
END;
$$;

ALTER FUNCTION public.admin_add_virgo_seller(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_add_virgo_seller(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_add_virgo_seller(UUID, UUID) TO service_role;
