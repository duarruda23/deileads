-- ============================================================
-- 049_agents_manage_pipelines.sql — vendedor edita funil.
--
-- Até aqui criar/renomear funil e mexer em etapas/responsáveis era
-- admin+ (017 e 047). Os vendedores (papel agent) pediram pra
-- organizar os próprios funis sem depender de admin (28/09).
--
-- Passa pra agent+: criar e renomear funil, criar/editar/reordenar/
-- apagar etapas e definir responsáveis. Apagar etapa com negócio
-- continua barrado pela FK (a UI já avisa antes).
--
-- Continua admin+: APAGAR um funil inteiro, porque o CASCADE leva
-- todos os negócios dele junto.
--
-- Viewer segue somente leitura.
-- ============================================================

-- ---- pipelines ------------------------------------------------
DROP POLICY IF EXISTS pipelines_insert ON pipelines;
CREATE POLICY pipelines_insert ON pipelines
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS pipelines_update ON pipelines;
CREATE POLICY pipelines_update ON pipelines
  FOR UPDATE USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- pipelines_delete fica como está (admin).

-- ---- pipeline_stages ------------------------------------------
DROP POLICY IF EXISTS pipeline_stages_modify ON pipeline_stages;
CREATE POLICY pipeline_stages_modify ON pipeline_stages FOR ALL USING (
  EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_stages.pipeline_id AND is_account_member(p.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_stages.pipeline_id AND is_account_member(p.account_id, 'agent'))
);

-- ---- pipeline_members -----------------------------------------
DROP POLICY IF EXISTS pipeline_members_insert ON pipeline_members;
CREATE POLICY pipeline_members_insert ON pipeline_members
  FOR INSERT WITH CHECK (
    is_account_member(account_id, 'agent')
    AND EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_id AND p.account_id = pipeline_members.account_id)
    AND EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = profile_id AND pr.account_id = pipeline_members.account_id)
  );

DROP POLICY IF EXISTS pipeline_members_delete ON pipeline_members;
CREATE POLICY pipeline_members_delete ON pipeline_members
  FOR DELETE USING (is_account_member(account_id, 'agent'));
