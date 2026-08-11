-- ============================================================
-- 000_extensions_search_path.sql
--
-- Newer Supabase projects install extensions (uuid-ossp, pgcrypto,
-- etc.) into a dedicated `extensions` schema instead of `public`,
-- for security isolation. 001_initial_schema.sql calls
-- uuid_generate_v4() unqualified, which only resolves if
-- `extensions` is on the search_path.
--
-- This file runs first (000 sorts before 001) and:
--   1. Ensures uuid-ossp exists (idempotent — no-ops if Supabase
--      already provisioned it in `extensions`).
--   2. Puts `extensions` on the database's default search_path
--      (persists for all future connections/sessions).
--   3. Sets it for the current session too, so the rest of this
--      same `db push` batch resolves unqualified calls immediately
--      without waiting for a new connection.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- Force uuid-ossp to live in `public` so every unqualified
-- uuid_generate_v4() call in the migrations below just resolves,
-- regardless of connection pooling / search_path propagation
-- quirks. Safe on a fresh project: drop-then-recreate has nothing
-- depending on it yet.
DROP EXTENSION IF EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

ALTER DATABASE postgres SET search_path TO "$user", public, extensions;
SET search_path TO "$user", public, extensions;
