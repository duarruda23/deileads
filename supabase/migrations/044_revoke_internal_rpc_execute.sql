-- 044_revoke_internal_rpc_execute.sql
--
-- Fecha um furo de segurança: as migrations 030/043 faziam
-- `REVOKE ALL ... FROM PUBLIC` + `GRANT ... TO service_role`, mas o Supabase
-- concede EXECUTE direto às roles `anon` e `authenticated` via default
-- privileges — e `REVOKE FROM PUBLIC` não remove grants explícitos a essas
-- roles. Resultado: admin_create_account / admin_add_virgo_seller (SECURITY
-- DEFINER, sem checagem de auth.uid() dentro) eram chamáveis por qualquer
-- pessoa com a chave anon pública via /rest/v1/rpc/*.
--
-- Aqui revogamos EXECUTE de anon e authenticated SÓ das funções que são de
-- uso interno (service_role, cron, triggers). NÃO mexemos nas que o app
-- chama com sessão de usuário nem nas usadas em políticas RLS:
--   is_account_member, can_view_owner, is_platform_admin (RLS),
--   set_member_role, remove_account_member, transfer_account_ownership,
--   redeem_invitation, redeem_platform_invitation, peek_invitation,
--   peek_platform_invitation, submit_site_lead, submit_hotmart_lead
--   (os dois últimos são endpoints públicos protegidos por hash de token).
--
-- Reversível: basta dar GRANT EXECUTE de novo.

REVOKE EXECUTE ON FUNCTION public.admin_create_account(TEXT, UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_add_virgo_seller(UUID, UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.account_has_domain_data(UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._bcast_bump(UUID, TEXT, INTEGER) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_broadcast_counts(UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.merge_duplicate_contacts() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.broadcast_recipient_aggregate_trigger() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_deal_stage_change() FROM anon, authenticated;

-- Garante que service_role continua podendo chamar as de admin.
GRANT EXECUTE ON FUNCTION public.admin_create_account(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_add_virgo_seller(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_has_domain_data(UUID) TO service_role;

-- Algumas dessas funções herdavam EXECUTE via PUBLIC (default do Postgres),
-- então revogar só de anon/authenticated não bastava. Revogamos de PUBLIC
-- também e devolvemos explicitamente ao service_role.
REVOKE EXECUTE ON FUNCTION public.admin_create_account(TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_add_virgo_seller(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.account_has_domain_data(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._bcast_bump(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_broadcast_counts(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_duplicate_contacts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.broadcast_recipient_aggregate_trigger() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_deal_stage_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._bcast_bump(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_broadcast_counts(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_contacts() TO service_role;

-- Dois avisos menores do advisor, sem risco de comportamento:
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public._bcast_cols_for_status(TEXT) SET search_path = public;
