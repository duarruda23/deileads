-- ============================================================
-- 036_profile_locale.sql — per-user UI language preference
--
-- Adds `profiles.locale` so each person can pick English or
-- Brazilian Portuguese independently of their teammates. Stored on
-- the profile (not localStorage, unlike the color theme) so the
-- choice follows the user across devices.
--
-- Scope note: this migration only adds the column. Translation
-- coverage (which screens actually read it) ships incrementally in
-- the application code — see src/lib/i18n/.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en'
    CHECK (locale IN ('en', 'pt-BR'));
