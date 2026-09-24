-- 046_whatsapp_coexistence.sql
--
-- Coexistência (WhatsApp Business app + Cloud API no mesmo número).
--
-- Até aqui toda conexão era "manual": o admin colava Phone Number ID,
-- token e PIN, e o backend chamava /register. Um número que já vive no
-- app WhatsApp Business do celular não pode passar por /register sem
-- ser tirado do app — o caminho oficial é o Embedded Signup com
-- featureType=whatsapp_business_app_onboarding, que já entrega o número
-- registrado e exige que o parceiro peça, uma única vez e em até 24h,
-- a sincronização de contatos e histórico (POST /{phone}/smb_app_data).
--
-- Colunas novas:
--   onboarding_type        'manual' (padrão, comportamento antigo) ou
--                          'coexistence' (veio do Embedded Signup).
--   smb_contacts_sync_at   quando o pedido de sync de contatos foi aceito.
--   smb_history_sync_at    quando o pedido de sync de histórico foi aceito.
--   smb_sync_error         último erro de sync (pedido recusado pela Meta
--                          ou histórico desativado pela empresa no app).
--
-- Idempotente.

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS onboarding_type TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS smb_contacts_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS smb_history_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS smb_sync_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_onboarding_type_check'
      AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_onboarding_type_check
      CHECK (onboarding_type IN ('manual', 'coexistence'));
  END IF;
END $$;

-- Mensagens importadas do histórico e ecos do app chegam em lote e
-- podem ser reentregues pela Meta; a deduplicação é feita por
-- (conversation_id, message_id). O índice existente é só em message_id.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_message_id
  ON messages (conversation_id, message_id)
  WHERE message_id IS NOT NULL;
