'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CalendarPlus, Check } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { dueBucket, formatDue } from '@/lib/tasks/status';
import { getTaskType } from '@/lib/tasks/task-types';
import { notifyTasksChanged } from '@/hooks/use-task-alerts';
import type { Task } from '@/types';
import { Button } from '@/components/ui/button';
import { TaskFormDialog } from './task-form-dialog';

/**
 * Open tasks of a deal (tasks created on it, or on its contact without
 * a specific deal) inside the deal sheet: tick them off or schedule a
 * new one without leaving the Kanban.
 */
export function DealTasksSection({
  contactId,
  contactLabel,
  dealId,
  assignedTo,
  canEdit,
  onChanged,
}: {
  contactId: string;
  contactLabel: string;
  dealId: string;
  assignedTo?: string | null;
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const supabase = createClient();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // Stable identity: TaskFormDialog resets its fields when `target`
  // changes, so a fresh object each render would wipe what's typed.
  const target = useMemo(
    () => ({ contactId, contactLabel, dealId, assignedTo }),
    [contactId, contactLabel, dealId, assignedTo]
  );

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('contact_id', contactId)
      .is('completed_at', null)
      .or(`deal_id.eq.${dealId},deal_id.is.null`)
      .order('due_at', { ascending: true, nullsFirst: false });
    if (error) console.error('[deal tasks] load failed:', error.message);
    setTasks((data ?? []) as Task[]);
    setLoading(false);
  }, [supabase, contactId, dealId]);

  // Async fetch on mount / target change — setState only runs after the
  // await, same load-on-mount pattern as the rest of the app.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    load();
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function complete(task: Task) {
    setTogglingId(task.id);
    const { data, error } = await supabase
      .from('tasks')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', task.id)
      .select('id');
    setTogglingId(null);
    if (error || !data?.length) {
      toast.error('Não foi possível concluir a tarefa');
      return;
    }
    toast.success('Tarefa concluída');
    notifyTasksChanged();
    load();
    onChanged?.();
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium tracking-wider text-slate-400 uppercase">
          Tarefas
        </p>
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setFormOpen(true)}
            className="h-7 text-primary hover:bg-primary/10"
          >
            <CalendarPlus className="size-3.5" />
            Nova tarefa
          </Button>
        )}
      </div>

      {loading ? (
        <div className="h-8 animate-pulse rounded bg-slate-800/60" />
      ) : tasks.length === 0 ? (
        <p className="text-xs text-orange-300/80">
          Nenhuma tarefa aberta. Agende o próximo passo desse lead.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((t) => {
            const type = getTaskType(t.task_type);
            const bucket = dueBucket(t);
            return (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  title="Concluir"
                  disabled={!canEdit || togglingId === t.id}
                  onClick={() => complete(t)}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-600 hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  <Check className="h-3 w-3 opacity-0 hover:opacity-100" />
                </button>
                <type.icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-slate-200">{t.title}</span>
                {t.due_at && (
                  <span
                    className={`shrink-0 text-xs ${
                      bucket === 'overdue'
                        ? 'text-red-400'
                        : bucket === 'today'
                          ? 'text-amber-400'
                          : 'text-slate-500'
                    }`}
                  >
                    {formatDue(t.due_at)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <TaskFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        target={target}
        onCreated={() => {
          load();
          onChanged?.();
        }}
      />
    </div>
  );
}
