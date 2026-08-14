-- ============================================================
-- 035_lead_ownership_rls.sql — the access-control flip for 034.
--
-- 034 added the schema (owner_id / assigned_to / assigned_agent_id,
-- lead_visibility_grants, can_view_owner()) without changing who can
-- see what — every agent could still see every lead. This migration
-- is the actual behavior change: from here on, an `agent` role only
-- sees contacts/deals/conversations/messages/contact_notes they own,
-- unless an admin has granted them read access to another vendor's
-- leads (lead_visibility_grants) or the row is unowned (owner_id IS
-- NULL — can_view_owner treats that as visible to the whole account,
-- same as before this feature existed, since nothing has claimed it
-- yet).
--
-- Deliberately a separate migration from 034: run 034 first, let the
-- owner_id backfill (or a manual reassignment pass) settle, THEN run
-- this one. Applying both at once risks agents suddenly losing
-- access to real leads because the backfill didn't land the way
-- everyone expected.
--
-- Shape of the change, per table:
--   SELECT — is_account_member(account_id) AND can_view_owner(...)
--   UPDATE/DELETE — dono ou admin+ apenas (grants são somente leitura,
--     por isso can_view_owner() NÃO é usado aqui — só a checagem
--     direta de dono/admin).
--   INSERT — inalterado (agent+); a aplicação já grava o dono.
--
-- whatsapp_config also changes here: writes were admin-only pre-034;
-- 034's UI needs each vendor to manage their own connection, so
-- INSERT/UPDATE/DELETE now allow agent+ scoped to their own row
-- (admin+ can still touch any row).
-- ============================================================

-- ------------------------------------------------------------
-- contacts
-- ------------------------------------------------------------
DROP POLICY IF EXISTS contacts_select ON contacts;
CREATE POLICY contacts_select ON contacts
  FOR SELECT USING (is_account_member(account_id) AND can_view_owner(account_id, owner_id));

DROP POLICY IF EXISTS contacts_update ON contacts;
CREATE POLICY contacts_update ON contacts
  FOR UPDATE USING (
    is_account_member(account_id, 'agent')
    AND (
      is_account_member(account_id, 'admin')
      OR owner_id = (SELECT p.id FROM profiles p WHERE p.user_id = auth.uid())
      OR owner_id IS NULL
    )
  );

DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_delete ON contacts
  FOR DELETE USING (
    is_account_member(account_id, 'agent')
    AND (
      is_account_member(account_id, 'admin')
      OR owner_id = (SELECT p.id FROM profiles p WHERE p.user_id = auth.uid())
      OR owner_id IS NULL
    )
  );
-- contacts_insert unchanged (agent+, account-scoped only).

-- ------------------------------------------------------------
-- deals (owner column: assigned_to)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS deals_select ON deals;
CREATE POLICY deals_select ON deals
  FOR SELECT USING (is_account_member(account_id) AND can_view_owner(account_id, assigned_to));

DROP POLICY IF EXISTS deals_update ON deals;
CREATE POLICY deals_update ON deals
  FOR UPDATE USING (
    is_account_member(account_id, 'agent')
    AND (
      is_account_member(account_id, 'admin')
      OR assigned_to = (SELECT p.id FROM profiles p WHERE p.user_id = auth.uid())
      OR assigned_to IS NULL
    )
  );

DROP POLICY IF EXISTS deals_delete ON deals;
CREATE POLICY deals_delete ON deals
  FOR DELETE USING (
    is_account_member(account_id, 'agent')
    AND (
      is_account_member(account_id, 'admin')
      OR assigned_to = (SELECT p.id FROM profiles p WHERE p.user_id = auth.uid())
      OR assigned_to IS NULL
    )
  );

-- ------------------------------------------------------------
-- conversations (owner column: assigned_agent_id)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations
  FOR SELECT USING (is_account_member(account_id) AND can_view_owner(account_id, assigned_agent_id));

DROP POLICY IF EXISTS conversations_update ON conversations;
CREATE POLICY conversations_update ON conversations
  FOR UPDATE USING (
    is_account_member(account_id, 'agent')
    AND (
      is_account_member(account_id, 'admin')
      OR assigned_agent_id = (SELECT p.id FROM profiles p WHERE p.user_id = auth.uid())
      OR assigned_agent_id IS NULL
    )
  );

DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_delete ON conversations
  FOR DELETE USING (
    is_account_member(account_id, 'agent')
    AND (
      is_account_member(account_id, 'admin')
      OR assigned_agent_id = (SELECT p.id FROM profiles p WHERE p.user_id = auth.uid())
      OR assigned_agent_id IS NULL
    )
  );

-- ------------------------------------------------------------
-- messages (child of conversations — same owner check via join)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND is_account_member(c.account_id)
        AND can_view_owner(c.account_id, c.assigned_agent_id)
    )
  );

DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_modify ON messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND is_account_member(c.account_id, 'agent')
        AND (
          is_account_member(c.account_id, 'admin')
          OR c.assigned_agent_id = (SELECT p.id FROM profiles p WHERE p.user_id = auth.uid())
          OR c.assigned_agent_id IS NULL
        )
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND is_account_member(c.account_id, 'agent')
        AND (
          is_account_member(c.account_id, 'admin')
          OR c.assigned_agent_id = (SELECT p.id FROM profiles p WHERE p.user_id = auth.uid())
          OR c.assigned_agent_id IS NULL
        )
    )
  );
-- Service-role webhook inserts (Meta deliveries) still bypass RLS,
-- same as pre-035.

-- ------------------------------------------------------------
-- contact_notes
-- ------------------------------------------------------------
DROP POLICY IF EXISTS contact_notes_select ON contact_notes;
CREATE POLICY contact_notes_select ON contact_notes
  FOR SELECT USING (
    is_account_member(account_id)
    AND can_view_owner(
      account_id,
      (SELECT c.owner_id FROM contacts c WHERE c.id = contact_notes.contact_id)
    )
  );

DROP POLICY IF EXISTS contact_notes_update ON contact_notes;
CREATE POLICY contact_notes_update ON contact_notes
  FOR UPDATE USING (
    is_account_member(account_id, 'agent')
    AND (
      is_account_member(account_id, 'admin')
      OR (SELECT c.owner_id FROM contacts c WHERE c.id = contact_notes.contact_id)
           = (SELECT p.id FROM profiles p WHERE p.user_id = auth.uid())
      OR (SELECT c.owner_id FROM contacts c WHERE c.id = contact_notes.contact_id) IS NULL
    )
  );

DROP POLICY IF EXISTS contact_notes_delete ON contact_notes;
CREATE POLICY contact_notes_delete ON contact_notes
  FOR DELETE USING (
    is_account_member(account_id, 'agent')
    AND (
      is_account_member(account_id, 'admin')
      OR (SELECT c.owner_id FROM contacts c WHERE c.id = contact_notes.contact_id)
           = (SELECT p.id FROM profiles p WHERE p.user_id = auth.uid())
      OR (SELECT c.owner_id FROM contacts c WHERE c.id = contact_notes.contact_id) IS NULL
    )
  );
-- contact_notes_insert unchanged (agent+, account-scoped only).

-- ------------------------------------------------------------
-- whatsapp_config — 034's settings UI needs each vendor to manage
-- their own connection. Was admin-only for every write; now agent+
-- may write their own row, admin+ may write any row in the account.
-- SELECT is unchanged (any account member sees every connection —
-- phone_number_id / status aren't secret; access_token stays
-- encrypted regardless of who can read the row).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS whatsapp_config_insert ON whatsapp_config;
CREATE POLICY whatsapp_config_insert ON whatsapp_config
  FOR INSERT WITH CHECK (
    is_account_member(account_id, 'agent')
    AND (user_id = auth.uid() OR is_account_member(account_id, 'admin'))
  );

DROP POLICY IF EXISTS whatsapp_config_update ON whatsapp_config;
CREATE POLICY whatsapp_config_update ON whatsapp_config
  FOR UPDATE USING (
    is_account_member(account_id, 'agent')
    AND (user_id = auth.uid() OR is_account_member(account_id, 'admin'))
  );

DROP POLICY IF EXISTS whatsapp_config_delete ON whatsapp_config;
CREATE POLICY whatsapp_config_delete ON whatsapp_config
  FOR DELETE USING (
    is_account_member(account_id, 'agent')
    AND (user_id = auth.uid() OR is_account_member(account_id, 'admin'))
  );
