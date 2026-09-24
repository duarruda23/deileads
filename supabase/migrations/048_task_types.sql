-- ============================================================
-- 048_task_types.sql — tipo de tarefa + índice pro marcador do Kanban.
--
-- Tasks (040) existed but nobody used them (0 rows in every account
-- on 24/09): creating one meant opening the contact, and nothing in
-- the pipeline showed whether a lead had a next step scheduled. This
-- adds the task type (Ligar, WhatsApp, Reunião, Follow-up, Enviar
-- proposta, Outro) shown as an icon on the task and on the Kanban
-- card's task marker.
--
-- Stored as text + CHECK rather than an enum so adding a type later
-- is a one-line constraint swap instead of ALTER TYPE.
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'follow_up';

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check
  CHECK (task_type IN ('call', 'whatsapp', 'meeting', 'follow_up', 'proposal', 'other'));

-- The Kanban marker and the sidebar counter both read "open tasks of
-- this account, by due date".
CREATE INDEX IF NOT EXISTS idx_tasks_account_open
  ON tasks (account_id, due_at) WHERE completed_at IS NULL;
