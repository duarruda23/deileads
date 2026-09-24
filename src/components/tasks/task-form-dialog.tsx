'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Search } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { localDueAt } from '@/lib/tasks/status';
import { notifyTasksChanged } from '@/hooks/use-task-alerts';
import {
  DEFAULT_TASK_TYPE,
  TASK_TYPES,
  type TaskType,
} from '@/lib/tasks/task-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface TaskFormTarget {
  /** Fixed lead. When absent the dialog shows a contact search. */
  contactId?: string;
  contactLabel?: string;
  dealId?: string | null;
  /** Default responsável; falls back to the current user. */
  assignedTo?: string | null;
  /** Shown above the form, e.g. "Card movido para Qualificado". */
  hint?: string;
}

function todayLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * The one "Nova tarefa" form, used from the Kanban card, the deal
 * sheet, the contact detail and /tasks. Title is optional — an empty
 * title becomes the type label ("Ligar", "Follow-up"...), so a vendor
 * can schedule the next step in two clicks.
 */
export function TaskFormDialog({
  open,
  onOpenChange,
  target,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: TaskFormTarget | null;
  onCreated?: () => void;
}) {
  const supabase = createClient();
  const { accountId, profile } = useAuth();

  const [taskType, setTaskType] = useState<TaskType>(DEFAULT_TASK_TYPE);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [people, setPeople] = useState<{ id: string; full_name: string | null }[]>([]);
  const [saving, setSaving] = useState(false);

  // Contact search (only when the target doesn't fix the lead).
  const [contactId, setContactId] = useState('');
  const [contactLabel, setContactLabel] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<
    { id: string; name: string | null; phone: string | null }[]
  >([]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setTaskType(DEFAULT_TASK_TYPE);
    setTitle('');
    setDate(todayLocal());
    setTime('');
    setAssignedTo(target?.assignedTo ?? profile?.id ?? '');
    setContactId(target?.contactId ?? '');
    setContactLabel(target?.contactLabel ?? '');
    setSearch('');
    setResults([]);
  }, [open, target, profile?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('account_id', accountId)
        .order('full_name');
      if (!cancelled) setPeople(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, supabase]);

  useEffect(() => {
    if (!open || target?.contactId) return;
    const q = search.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const escaped = q.replace(/[%_,()]/g, ' ');
      const { data } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%`)
        .order('name')
        .limit(8);
      if (!cancelled) setResults(data ?? []);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, search, target?.contactId, supabase]);

  async function handleSave() {
    if (!accountId) {
      toast.error('Seu perfil não está ligado a uma conta');
      return;
    }
    if (!contactId) {
      toast.error('Escolha o lead da tarefa');
      return;
    }
    setSaving(true);
    const typeLabel = TASK_TYPES.find((t) => t.value === taskType)?.label ?? '';
    const { error } = await supabase.from('tasks').insert({
      account_id: accountId,
      contact_id: contactId,
      deal_id: target?.dealId ?? null,
      title: title.trim() || typeLabel,
      task_type: taskType,
      due_at: localDueAt(date, time || undefined),
      assigned_to: assignedTo || null,
      created_by: profile?.id ?? null,
    });
    setSaving(false);
    if (error) {
      console.error('[tasks] insert failed:', error.message);
      toast.error('Não foi possível criar a tarefa');
      return;
    }
    toast.success('Tarefa agendada');
    notifyTasksChanged();
    onOpenChange(false);
    onCreated?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-700 bg-slate-900 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova tarefa</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          {target?.hint && (
            <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
              {target.hint}
            </p>
          )}

          <div className="grid gap-2">
            <Label className="text-slate-300">Lead</Label>
            {target?.contactId ? (
              <p className="truncate text-sm text-white">{contactLabel || 'Lead'}</p>
            ) : contactId ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm">
                <span className="truncate">{contactLabel}</span>
                <button
                  type="button"
                  onClick={() => {
                    setContactId('');
                    setContactLabel('');
                  }}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  trocar
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-slate-500" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome ou telefone"
                  className="border-slate-700 bg-slate-800 pl-8 text-white"
                />
                {search.trim().length >= 2 && results.length > 0 && (
                  <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800">
                    {results.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setContactId(c.id);
                            setContactLabel(c.name || c.phone || 'Lead');
                          }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-slate-700"
                        >
                          {c.name || c.phone}
                          {c.name && c.phone && (
                            <span className="ml-2 text-xs text-slate-500">{c.phone}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label className="text-slate-300">Tipo</Label>
            <div className="flex flex-wrap gap-1.5">
              {TASK_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTaskType(t.value)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    taskType === t.value
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-slate-300">Descrição (opcional)</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={TASK_TYPES.find((t) => t.value === taskType)?.label}
              className="border-slate-700 bg-slate-800 text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label className="text-slate-300">Data</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="border-slate-700 bg-slate-800 text-white"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-slate-300">Hora (opcional)</Label>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="border-slate-700 bg-slate-800 text-white"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-slate-300">Responsável</Label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:border-primary"
            >
              <option value="">Ninguém</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || 'Sem nome'}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter className="border-slate-700 bg-slate-900/50">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !contactId}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Agendar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
