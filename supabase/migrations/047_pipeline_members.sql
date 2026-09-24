-- ============================================================
-- 047_pipeline_members.sql — funis com responsáveis.
--
-- Até aqui um funil era só um nome: "Funil Larissa" não tinha
-- nenhuma ligação com a Larissa. "Assumir" um lead preenchia
-- assigned_to/owner_id mas deixava o negócio no funil onde estava,
-- então o lead aparecia como dela no banco e nunca no funil dela
-- (bug reportado na conta Italo, 24/09).
--
-- pipeline_members liga um funil a uma ou mais pessoas (um vendedor
-- ou um grupo). Funil sem nenhum membro continua sendo um funil
-- geral, visível e utilizável por todos como antes. Ao assumir um
-- lead, a aplicação oferece os funis dos quais a pessoa é membro
-- como destino.
--
-- Isto NÃO muda visibilidade de negócios: quem enxerga qual deal
-- continua sendo decidido por deals_select / can_view_owner (035).
-- ============================================================

CREATE TABLE IF NOT EXISTS pipeline_members (
  pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pipeline_id, profile_id)
);

CREATE INDEX IF NOT EXISTS pipeline_members_profile_idx
  ON pipeline_members (profile_id);
CREATE INDEX IF NOT EXISTS pipeline_members_account_idx
  ON pipeline_members (account_id);

ALTER TABLE pipeline_members ENABLE ROW LEVEL SECURITY;

-- Qualquer membro da conta lê (o diálogo de "assumir" de um agent
-- precisa saber de quais funis ele é responsável).
DROP POLICY IF EXISTS pipeline_members_select ON pipeline_members;
CREATE POLICY pipeline_members_select ON pipeline_members
  FOR SELECT USING (is_account_member(account_id));

-- Escrita é admin+, mesmo nível de pipelines_insert/update/delete.
-- O WITH CHECK garante que funil e pessoa pertencem à mesma conta
-- da linha — sem isso um admin poderia apontar pra um profile/funil
-- de outra conta passando um account_id que ele controla.
DROP POLICY IF EXISTS pipeline_members_insert ON pipeline_members;
CREATE POLICY pipeline_members_insert ON pipeline_members
  FOR INSERT WITH CHECK (
    is_account_member(account_id, 'admin')
    AND EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_id AND p.account_id = pipeline_members.account_id)
    AND EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = profile_id AND pr.account_id = pipeline_members.account_id)
  );

DROP POLICY IF EXISTS pipeline_members_delete ON pipeline_members;
CREATE POLICY pipeline_members_delete ON pipeline_members
  FOR DELETE USING (is_account_member(account_id, 'admin'));

GRANT SELECT, INSERT, DELETE ON pipeline_members TO authenticated;
