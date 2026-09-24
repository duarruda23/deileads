'use client';

import { CalendarX2 } from 'lucide-react';
import { formatDue, type TaskMarker } from '@/lib/tasks/status';
import { getTaskType } from '@/lib/tasks/task-types';

export interface MarkerTask {
  id: string;
  title: string;
  task_type?: string;
  due_at?: string | null;
  completed_at?: string | null;
}

const STYLES: Record<TaskMarker['state'], string> = {
  overdue: 'bg-red-500/15 text-red-300',
  today: 'bg-amber-500/15 text-amber-300',
  upcoming: 'bg-slate-700/60 text-slate-300',
  undated: 'bg-slate-700/60 text-slate-400',
  none: 'border border-dashed border-orange-500/40 text-orange-300/80',
};

/**
 * Kanban card task marker (Kommo-style): the lead's most urgent open
 * task, colored by due state, or "Sem tarefa" when the lead has no
 * next step scheduled.
 */
export function TaskMarkerChip({ marker }: { marker: TaskMarker<MarkerTask> }) {
  if (marker.state === 'none') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${STYLES.none}`}
      >
        <CalendarX2 className="h-3 w-3" />
        Sem tarefa
      </span>
    );
  }

  const task = marker.task!;
  const type = getTaskType(task.task_type);
  const label = task.due_at ? formatDue(task.due_at) : 'Sem data';
  const extra = marker.openCount > 1 ? ` +${marker.openCount - 1}` : '';

  return (
    <span
      title={`${task.title}${marker.openCount > 1 ? ` (${marker.openCount} tarefas abertas)` : ''}`}
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[10px] font-medium ${STYLES[marker.state]}`}
    >
      <type.icon className="h-3 w-3 shrink-0" />
      <span className="truncate">
        {label}
        {extra}
      </span>
    </span>
  );
}
