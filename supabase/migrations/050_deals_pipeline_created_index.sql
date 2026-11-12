-- ============================================================
-- 050_deals_pipeline_created_index.sql — funil lento.
--
-- A tela de funis lê os negócios de um funil ordenados por
-- created_at desc, paginados de 500 em 500 (.range). Só existia
-- índice em pipeline_id, então o Postgres filtrava e ordenava a
-- cada página — custo que cresce com o funil "Entrada Geral".
-- O índice composto entrega as linhas já na ordem pedida.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_deals_pipeline_created
  ON deals (pipeline_id, created_at DESC);

-- Tarefas em aberto da conta (carregadas junto com o funil).
-- idx_tasks_account_open já cobre; nada a fazer aqui.
