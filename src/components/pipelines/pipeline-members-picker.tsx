'use client';

import { Label } from '@/components/ui/label';

export interface MemberOption {
  id: string;
  full_name: string | null;
  email: string | null;
}

/**
 * Checkbox list of the account's people, used when creating or
 * editing a pipeline to say who it belongs to. Nobody checked = a
 * general pipeline for the whole team.
 */
export function PipelineMembersPicker({
  people,
  value,
  onChange,
}: {
  people: MemberOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <div className="grid gap-2">
      <Label className="text-slate-300">Responsáveis</Label>
      <p className="text-xs text-slate-400">
        Quem assumir um lead poderá mandá-lo pra este funil. Sem ninguém
        marcado, é um funil geral da equipe.
      </p>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/50 p-2">
        {people.length === 0 && (
          <p className="px-1 text-xs text-slate-500">Nenhum membro na conta.</p>
        )}
        {people.map((p) => (
          <label
            key={p.id}
            className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-slate-200 hover:bg-slate-800"
          >
            <input
              type="checkbox"
              checked={value.includes(p.id)}
              onChange={() => toggle(p.id)}
              className="accent-primary"
            />
            {p.full_name || p.email}
          </label>
        ))}
      </div>
    </div>
  );
}
