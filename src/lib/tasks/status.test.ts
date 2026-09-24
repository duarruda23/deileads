import { describe, expect, it } from 'vitest';
import { dueBucket, formatDue, localDueAt, taskMarker } from './status';

// A fixed local "now": 24/09/2026 15:00 in the machine's timezone.
const NOW = new Date(2026, 8, 24, 15, 0, 0);
const at = (d: number, h = 12, m = 0) =>
  new Date(2026, 8, d, h, m, 0).toISOString();

describe('dueBucket', () => {
  it('classifies open tasks by due date', () => {
    expect(dueBucket({ due_at: at(23) }, NOW)).toBe('overdue');
    expect(dueBucket({ due_at: at(24, 14) }, NOW)).toBe('overdue');
    expect(dueBucket({ due_at: at(24, 18) }, NOW)).toBe('today');
    expect(dueBucket({ due_at: at(25, 9) }, NOW)).toBe('upcoming');
    expect(dueBucket({ due_at: null }, NOW)).toBe('none');
  });

  it('treats completed tasks as none', () => {
    expect(
      dueBucket({ due_at: at(20), completed_at: at(21) }, NOW)
    ).toBe('none');
  });
});

describe('taskMarker', () => {
  it('is none when there is no open task', () => {
    expect(taskMarker([], NOW)).toEqual({ state: 'none', openCount: 0 });
    expect(
      taskMarker([{ due_at: at(20), completed_at: at(20) }], NOW).state
    ).toBe('none');
  });

  it('picks the most urgent task', () => {
    const tasks = [
      { id: 'a', due_at: at(26) },
      { id: 'b', due_at: at(24, 20) },
      { id: 'c', due_at: at(22) },
      { id: 'd', due_at: null },
    ];
    const m = taskMarker(tasks, NOW);
    expect(m.state).toBe('overdue');
    expect(m.task?.id).toBe('c');
    expect(m.openCount).toBe(4);
  });

  it('picks the earliest within the same bucket', () => {
    const m = taskMarker(
      [
        { id: 'late', due_at: at(28) },
        { id: 'soon', due_at: at(26) },
      ],
      NOW
    );
    expect(m.state).toBe('upcoming');
    expect(m.task?.id).toBe('soon');
  });

  it('is undated when open tasks have no due date', () => {
    expect(taskMarker([{ due_at: null }], NOW).state).toBe('undated');
  });
});

describe('localDueAt', () => {
  it('date-only means end of that local day, not UTC midnight', () => {
    const iso = localDueAt('2026-09-25')!;
    const d = new Date(iso);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(25);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });

  it('uses the given local time', () => {
    const d = new Date(localDueAt('2026-09-25', '09:30')!);
    expect(d.getDate()).toBe(25);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);
  });

  it('returns null without a date', () => {
    expect(localDueAt('')).toBeNull();
  });
});

describe('formatDue', () => {
  it('labels today, tomorrow and overdue', () => {
    expect(formatDue(at(24, 18), NOW)).toBe('Hoje 18:00');
    expect(formatDue(localDueAt('2026-09-24')!, NOW)).toBe('Hoje');
    expect(formatDue(at(25, 9), NOW)).toBe('Amanhã 09:00');
    expect(formatDue(localDueAt('2026-09-23')!, NOW)).toBe('Atrasada · 23/09');
    expect(formatDue(at(30, 10), NOW)).toBe('30/09 10:00');
  });
});
