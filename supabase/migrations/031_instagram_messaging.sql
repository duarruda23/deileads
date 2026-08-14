-- Instagram Messaging API completion: webhook verification/subscription
-- metadata plus database-backed message deduplication.

ALTER TABLE instagram_config
  ADD COLUMN IF NOT EXISTS verify_token TEXT,
  ADD COLUMN IF NOT EXISTS subscribed_apps_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_instagram_config_business_account
  ON instagram_config(ig_business_account_id);

-- Meta retries webhook deliveries. Message ids are not guaranteed unique
-- across channels/accounts, so scope idempotency to the conversation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_meta_id
  ON messages(conversation_id, message_id)
  WHERE message_id IS NOT NULL;
