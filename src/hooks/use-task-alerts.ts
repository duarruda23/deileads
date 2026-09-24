'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';

/** Fired after any task create/complete/delete so counters refresh now. */
export const TASKS_CHANGED_EVENT = 'deileads:tasks-changed';

export function notifyTasksChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
  }
}

/**
 * The current user's open tasks that need attention: overdue ones and
 * ones due later today. Drives the sidebar badge on "Tasks". Refreshes
 * every minute (a task turns overdue with no event), on window focus,
 * and on TASKS_CHANGED_EVENT.
 */
export function useTaskAlerts(): { overdue: number; today: number } {
  const { profile } = useAuth();
  const profileId = profile?.id;
  const [counts, setCounts] = useState({ overdue: 0, today: 0 });

  useEffect(() => {
    if (!profileId) return;
    const supabase = createClient();
    let cancelled = false;

    async function load() {
      const now = new Date();
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      const base = () =>
        supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('assigned_to', profileId!)
          .is('completed_at', null);
      const [overdue, today] = await Promise.all([
        base().lt('due_at', now.toISOString()),
        base()
          .gte('due_at', now.toISOString())
          .lte('due_at', endOfDay.toISOString()),
      ]);
      if (cancelled) return;
      setCounts({ overdue: overdue.count ?? 0, today: today.count ?? 0 });
    }

    load();
    const interval = setInterval(load, 60_000);
    window.addEventListener('focus', load);
    window.addEventListener(TASKS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', load);
      window.removeEventListener(TASKS_CHANGED_EVENT, load);
    };
  }, [profileId]);

  return counts;
}
