/**
 * Task due-state rules shared by the Kanban marker, the /tasks page
 * groups and the sidebar counter, so all three agree on what
 * "atrasada" and "hoje" mean. Pure functions of (tasks, now) — "today"
 * is the viewer's local calendar day.
 */

export type DueBucket = 'overdue' | 'today' | 'upcoming' | 'none';

export interface DueTask {
  due_at?: string | null;
  completed_at?: string | null;
}

function endOfLocalDay(now: Date): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** Where an open task falls relative to `now`. Completed tasks are 'none'. */
export function dueBucket(task: DueTask, now: Date = new Date()): DueBucket {
  if (task.completed_at || !task.due_at) return 'none';
  const due = new Date(task.due_at).getTime();
  if (Number.isNaN(due)) return 'none';
  if (due < now.getTime()) return 'overdue';
  if (due <= endOfLocalDay(now)) return 'today';
  return 'upcoming';
}

/**
 * The Kanban card marker: the lead's most urgent open task.
 * - 'overdue' / 'today' / 'upcoming' — by that task's due date
 * - 'undated'  — only open tasks without a due date
 * - 'none'     — no open task at all (the lead has no next step)
 */
export type MarkerState = 'overdue' | 'today' | 'upcoming' | 'undated' | 'none';

export interface TaskMarker<T extends DueTask = DueTask> {
  state: MarkerState;
  /** The task the marker describes (absent for 'none'). */
  task?: T;
  /** How many open tasks the lead has. */
  openCount: number;
}

const RANK: Record<DueBucket, number> = {
  overdue: 0,
  today: 1,
  upcoming: 2,
  none: 3,
};

export function taskMarker<T extends DueTask>(
  tasks: T[],
  now: Date = new Date()
): TaskMarker<T> {
  const open = tasks.filter((t) => !t.completed_at);
  if (open.length === 0) return { state: 'none', openCount: 0 };

  let best: T | undefined;
  let bestBucket: DueBucket = 'none';
  for (const t of open) {
    const b = dueBucket(t, now);
    if (
      !best ||
      RANK[b] < RANK[bestBucket] ||
      // Same bucket: the earliest due date wins.
      (b === bestBucket &&
        b !== 'none' &&
        new Date(t.due_at!).getTime() < new Date(best.due_at!).getTime())
    ) {
      best = t;
      bestBucket = b;
    }
  }
  return {
    state: bestBucket === 'none' ? 'undated' : bestBucket,
    task: best,
    openCount: open.length,
  };
}

/**
 * Short PT-BR label for a due date: "Atrasada · 23/09", "Hoje 14:00",
 * "Amanhã", "25/09 09:30". A time is shown only when it isn't the
 * all-day default (23:59) the form uses for date-only tasks.
 */
export function formatDue(dueAt: string, now: Date = new Date()): string {
  const due = new Date(dueAt);
  const hasTime = !(due.getHours() === 23 && due.getMinutes() === 59);
  const time = hasTime
    ? due.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '';
  const date = due.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
  const bucket = dueBucket({ due_at: dueAt }, now);
  if (bucket === 'overdue') return `Atrasada · ${date}${time ? ` ${time}` : ''}`;
  if (bucket === 'today') return time ? `Hoje ${time}` : 'Hoje';

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (due.toDateString() === tomorrow.toDateString()) {
    return time ? `Amanhã ${time}` : 'Amanhã';
  }
  return time ? `${date} ${time}` : date;
}

/**
 * Build the stored due_at from the form's local date ("YYYY-MM-DD")
 * and optional time ("HH:MM"). Date-only means end of that local day,
 * NOT UTC midnight — `new Date("2026-09-25")` is 25/09 00:00 UTC, i.e.
 * 24/09 21:00 in Brazil, which made date-only tasks show a day early
 * and turn overdue the evening before.
 */
export function localDueAt(date: string, time?: string): string | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return null;
  let hh = 23;
  let mm = 59;
  if (time) {
    const [h, mi] = time.split(':').map(Number);
    if (Number.isFinite(h) && Number.isFinite(mi)) {
      hh = h;
      mm = mi;
    }
  }
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();
}
