-- ============================================================
-- 043_platform_account_creation_data_safety.sql
--
-- Incident (08/09/2026): a Super Admin redeemed a 'new_account'
-- platform invitation (032) while already logged in as an existing,
-- populated account owner (the real Ítalo/Donas de Loja account —
-- hotmart_config, hotmart_products, tasks, real contacts/deals).
-- admin_create_account (030) blindly deletes "whatever account the
-- target owner_user_id currently has" before creating the new one,
-- with zero check that the old account holds real data — an
-- assumption that's only true for a brand-new signup's fresh,
-- auto-provisioned personal account. The result: the real account
-- was cascade-deleted and the same login now pointed at a fresh
-- empty "Controlojas" account instead. Recovered from a Supabase
-- PITR backup; this migration is the code fix so it can't recur.
--
-- redeem_invitation (019, same-account teammate invites) already had
-- this exact protection — a v_has_data check that refuses the move
-- with SQLSTATE 23505 if the caller's current account has any domain
-- rows. admin_create_account and admin_add_virgo_seller (030, the
-- platform-level "create a brand-new client account" / "add a Virgo
-- seller" flows) never got the same check. This migration adds it,
-- via a shared helper so the growing list of domain tables lives in
-- one place instead of two.
--
-- account_has_domain_data() mirrors 019's list (contacts,
-- conversations, broadcasts, automations, flows, pipelines,
-- message_templates, tags, custom_fields, contact_notes,
-- whatsapp_config) plus deals (present in the schema, omitted from
-- 019's original list — an oversight worth closing here too) and
-- every table added since 019: hotmart_config, hotmart_products,
-- hotmart_product_groups (033/042), tasks (040).
--
-- Behavior change: admin_create_account/admin_add_virgo_seller now
-- RAISE with SQLSTATE 23505 ("account already contains data") instead
-- of silently deleting when the target user's current account is
-- non-empty — the API routes calling these RPCs need to surface that
-- as a clear error ("this person already has an account with data;
-- invite a different email") rather than a generic 500. A genuinely
-- fresh signup's auto-provisioned personal account is always empty,
-- so the legitimate path (inviting someone who doesn't exist yet) is
-- completely unaffected.
--
-- Applied directly to production (nxjwcndjxvfwghwftxte) via the
-- Supabase Management API on 08/09/2026, ahead of this commit, given
-- the severity — this file brings the migration history back in
-- sync with what's already live.
-- ============================================================

CREATE OR REPLACE FUNCTION public.account_has_domain_data(
  p_account_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM hotmart_config WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM hotmart_products WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM hotmart_product_groups WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM tasks WHERE account_id = p_account_id
    LIMIT 1
  );
$$;

ALTER FUNCTION public.account_has_domain_data(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.account_has_domain_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_has_domain_data(UUID) TO service_role;

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
  SELECT account_id, full_name, email, avatar_url
  INTO v_old_account_id, v_full_name, v_email, v_avatar_url
  FROM profiles WHERE user_id = p_owner_user_id;

  -- Safety (added 043, missing since 030): refuse instead of silently
  -- deleting if the user's current account already holds real data —
  -- it means they're an existing account owner (or were moved into
  -- one), not a fresh signup's disposable personal account.
  IF v_old_account_id IS NOT NULL
     AND account_has_domain_data(v_old_account_id) THEN
    RAISE EXCEPTION
      'This user already owns an account with data — invite a different email to create a new account'
      USING ERRCODE = '23505';
  END IF;

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

    -- Same safety as admin_create_account above.
    IF v_old_account_id IS NOT NULL
       AND account_has_domain_data(v_old_account_id) THEN
      RAISE EXCEPTION
        'This user already owns an account with data — cannot bootstrap virgo-interno through them'
        USING ERRCODE = '23505';
    END IF;

    DELETE FROM accounts WHERE id = v_old_account_id;

    INSERT INTO accounts (name, owner_user_id, is_internal)
    VALUES ('Virgo (Interno)', p_acting_admin_user_id, true)
    RETURNING id INTO v_internal_account_id;

    INSERT INTO profiles (user_id, full_name, email, avatar_url, account_id, account_role)
    VALUES (p_acting_admin_user_id, v_full_name, v_email, v_avatar_url, v_internal_account_id, 'owner');
  END IF;

  -- The new seller is only ever moving INTO virgo-interno (never
  -- creating an account of their own), but still worth refusing if
  -- they somehow already own a populated account, same reasoning.
  SELECT account_id INTO v_old_account_id
  FROM profiles WHERE user_id = p_new_user_id;

  IF v_old_account_id IS NOT NULL
     AND v_old_account_id <> v_internal_account_id
     AND account_has_domain_data(v_old_account_id) THEN
    RAISE EXCEPTION
      'This user already owns an account with data — cannot add them as a Virgo seller'
      USING ERRCODE = '23505';
  END IF;

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
