-- ============================================================
-- 038_deal_source_import.sql — 'import' deal source
--
-- Bulk CSV import (extending src/components/contacts/import-modal.tsx
-- to optionally create a deal per imported contact) needs its own
-- deal_source_enum value so imported deals are distinguishable from
-- manually-created ones in the Tracking section (deal-form.tsx) and
-- anywhere else source is surfaced. Same one-line pattern used to add
-- 'hotmart' in 033.
-- ============================================================

ALTER TYPE deal_source_enum ADD VALUE IF NOT EXISTS 'import';
