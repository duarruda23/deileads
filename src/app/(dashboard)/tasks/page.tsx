"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { notifyTasksChanged } from "@/hooks/use-task-alerts";
import type { Task } from "@/types";
import { GatedButton } from "@/components/ui/gated-button";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { dueBucket, formatDue, type DueBucket } from "@/lib/tasks/status";
import { TASK_TYPES, getTaskType } from "@/lib/tasks/task-types";
import { CheckSquare, Plus, Trash2, AlertCircle, Check } from "lucide-react";
import { toast } from "sonner";

type Scope = "mine" | "all";

// Order and copy of the day-planning groups. Completed tasks (when
// shown) get their own trailing group.
const GROUPS: { key: DueBucket; label: string; tone: string }[] = [
  { key: "overdue", label: "Atrasadas", tone: "text-red-400" },
  { key: "today", label: "Hoje", tone: "text-amber-400" },
  { key: "upcoming", label: "Próximas", tone: "text-slate-300" },
  { key: "none", label: "Sem data", tone: "text-slate-400" },
];

export default function TasksPage() {
  useDocumentTitle("Tarefas");
  const supabase = createClient();
  const { profile } = useAuth();
  const profileId = profile?.id;
  const canCreate = useCan("send-messages");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<Scope>("mine");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("tasks")
      .select("*, contact:contacts(*), assignee:profiles!tasks_assigned_to_fkey(*)")
      .order("due_at", { ascending: true, nullsFirst: false });

    if (scope === "mine" && profileId) {
      query = query.eq("assigned_to", profileId);
    }
    if (!showCompleted) {
      query = query.is("completed_at", null);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Failed to load tasks:", error.message);
      setTasks([]);
    } else {
      setTasks((data ?? []) as Task[]);
    }
    setLoading(false);
  }, [supabase, scope, showCompleted, profileId]);

  // Refetch when scope/filters change; the loading flag flips before
  // the await by design (skeleton while the new list loads).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function toggleComplete(task: Task) {
    setTogglingId(task.id);
    const { data, error } = await supabase
      .from("tasks")
      .update({ completed_at: task.completed_at ? null : new Date().toISOString() })
      .eq("id", task.id)
      .select("id");
    setTogglingId(null);
    if (error || !data?.length) {
      toast.error("Não foi possível atualizar a tarefa");
      return;
    }
    notifyTasksChanged();
    fetchTasks();
  }

  async function handleDelete(taskId: string) {
    const { data, error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", taskId)
      .select("id");
    if (error || !data?.length) {
      toast.error("Não foi possível apagar a tarefa");
      return;
    }
    toast.success("Tarefa apagada");
    notifyTasksChanged();
    fetchTasks();
  }

  const grouped = useMemo(() => {
    const now = new Date();
    const visible = typeFilter
      ? tasks.filter((t) => (t.task_type ?? "follow_up") === typeFilter)
      : tasks;
    const open: Record<DueBucket, Task[]> = {
      overdue: [],
      today: [],
      upcoming: [],
      none: [],
    };
    const done: Task[] = [];
    for (const t of visible) {
      if (t.completed_at) done.push(t);
      else open[dueBucket(t, now)].push(t);
    }
    return { open, done, total: visible.length };
  }, [tasks, typeFilter]);

  function renderTask(task: Task) {
    const type = getTaskType(task.task_type);
    const bucket = dueBucket(task);
    return (
      <div
        key={task.id}
        className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 p-3"
      >
        <button
          onClick={() => toggleComplete(task)}
          disabled={togglingId === task.id}
          title={task.completed_at ? "Reabrir" : "Concluir"}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
            task.completed_at
              ? "border-primary bg-primary text-primary-foreground"
              : "border-slate-600 hover:border-primary"
          }`}
        >
          {task.completed_at && <Check className="h-3.5 w-3.5" />}
        </button>

        <span
          title={type.label}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-800 text-slate-300"
        >
          <type.icon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-sm ${
              task.completed_at ? "text-slate-500 line-through" : "text-white"
            }`}
          >
            {task.title}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            {task.contact && (
              <Link href="/contacts" className="hover:text-primary">
                {task.contact.name || task.contact.phone}
              </Link>
            )}
            {scope === "all" && task.assignee?.full_name && (
              <span>· {task.assignee.full_name}</span>
            )}
          </div>
        </div>

        {task.due_at && !task.completed_at && (
          <span
            className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
              bucket === "overdue"
                ? "bg-red-500/10 text-red-400"
                : bucket === "today"
                  ? "bg-amber-500/10 text-amber-400"
                  : "bg-slate-800 text-slate-400"
            }`}
          >
            {bucket === "overdue" && <AlertCircle className="h-3 w-3" />}
            {formatDue(task.due_at)}
          </span>
        )}

        <button
          onClick={() => handleDelete(task.id)}
          title="Apagar"
          className="shrink-0 text-slate-500 hover:text-red-400"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 p-1">
            <button
              onClick={() => setScope("mine")}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                scope === "mine" ? "bg-primary text-primary-foreground" : "text-slate-400 hover:text-white"
              }`}
            >
              Minhas
            </button>
            <button
              onClick={() => setScope("all")}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                scope === "all" ? "bg-primary text-primary-foreground" : "text-slate-400 hover:text-white"
              }`}
            >
              Todas
            </button>
            <button
              onClick={() => setShowCompleted((v) => !v)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                showCompleted ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {showCompleted ? "Esconder concluídas" : "Mostrar concluídas"}
            </button>
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
          >
            <option value="">Tipo: todos</option>
            {TASK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <GatedButton canAct={canCreate} gateReason="create tasks" onClick={() => setFormOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Nova tarefa
        </GatedButton>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-800/50" />
          ))}
        </div>
      ) : grouped.total === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-700 py-16 text-slate-500">
          <CheckSquare className="h-8 w-8" />
          <p className="text-sm">Nenhuma tarefa por aqui.</p>
          <p className="text-xs">
            Agende tarefas pelo card do funil, pelo contato ou em &quot;Nova tarefa&quot;.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {GROUPS.map((g) =>
            grouped.open[g.key].length === 0 ? null : (
              <section key={g.key} className="space-y-2">
                <h2 className={`text-xs font-semibold tracking-wider uppercase ${g.tone}`}>
                  {g.label} · {grouped.open[g.key].length}
                </h2>
                {grouped.open[g.key].map(renderTask)}
              </section>
            )
          )}
          {grouped.done.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                Concluídas · {grouped.done.length}
              </h2>
              {grouped.done.map(renderTask)}
            </section>
          )}
        </div>
      )}

      <TaskFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        target={null}
        onCreated={fetchTasks}
      />
    </div>
  );
}
