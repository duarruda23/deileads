"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

import { useTranslations } from "@/hooks/use-translations";
import type { Locale } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

/**
 * Language picker — per-user UI locale, saved to `profiles.locale`
 * (migration 036). Click a card → saves immediately, same
 * click-to-persist pattern as the color-theme picker in Appearance,
 * except this one is account-scoped (follows the user across
 * devices) instead of device-scoped localStorage.
 *
 * Translation coverage is partial today — see the note at the top of
 * `src/lib/i18n/dictionaries.ts`. Switching languages here already
 * updates everything that's been wired up (sidebar, header, dashboard,
 * this settings tab); the rest of the app still renders in English
 * until more screens are translated.
 */
export function LanguagePicker() {
  const { t, locale, locales, setLocale } = useTranslations();
  const [saving, setSaving] = useState<Locale | null>(null);

  const onPick = async (next: Locale) => {
    if (next === locale) return;
    setSaving(next);
    try {
      await setLocale(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(msg);
    } finally {
      setSaving(null);
    }
  };

  const nameFor = (l: Locale) =>
    l === "pt-BR" ? t("settingsLanguage.portuguese") : t("settingsLanguage.english");

  return (
    <Card className="bg-slate-900/40 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white">{t("settingsLanguage.title")}</CardTitle>
        <CardDescription className="text-slate-400">
          {t("settingsLanguage.subtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {locales.map((l) => {
            const isActive = l === locale;
            const isSaving = saving === l;
            return (
              <button
                key={l}
                type="button"
                onClick={() => onPick(l)}
                disabled={isSaving}
                aria-pressed={isActive}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border bg-card p-4 text-left transition-colors disabled:opacity-60",
                  isActive
                    ? "border-primary/60 ring-2 ring-primary/40"
                    : "border-slate-800 hover:border-slate-700 hover:bg-slate-800/40",
                )}
              >
                <span className="text-sm font-medium text-white">
                  {nameFor(l)}
                </span>
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin text-slate-400" />
                ) : isActive ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                    <Check className="h-3 w-3" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
