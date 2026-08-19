"use client";

import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  dictionaries,
  LOCALES,
  type DictKey,
  type Locale,
} from "@/lib/i18n/dictionaries";

/**
 * useTranslations — reads the current user's saved `locale` (from
 * `profiles.locale`, via useAuth) and exposes a `t()` lookup plus a
 * `setLocale()` mutator.
 *
 * Deliberately NOT a React Context: `useAuth()` already holds the
 * single source of truth for `profile`, so this hook is a thin
 * derivation over it. Every consumer re-renders when `profile`
 * changes (same as any other profile field), no extra provider to
 * wire into the tree.
 *
 * `{placeholder}` interpolation is supported in dictionary strings —
 * pass a `vars` object and matching `{key}` tokens get replaced.
 */
export function useTranslations() {
  const { profile, user, refreshProfile } = useAuth();
  const locale: Locale = profile?.locale ?? "en";
  const dict = dictionaries[locale];

  const t = useCallback(
    (key: DictKey, vars?: Record<string, string | number>) => {
      let str: string = dict[key] ?? dictionaries.en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replaceAll(`{${k}}`, String(v));
        }
      }
      return str;
    },
    [dict],
  );

  const setLocale = useCallback(
    async (next: Locale) => {
      if (!user) return;
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({ locale: next })
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);
      await refreshProfile();
    },
    [user, refreshProfile],
  );

  return { t, locale, locales: LOCALES, setLocale };
}
