'use client';

import { useCallback, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { loadMyPipelines } from '@/lib/pipelines/members';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { GitBranch } from 'lucide-react';

/** `pipelineId: null` means "claim, but leave the deal where it is". */
export type ClaimPipelineChoice =
  | { cancelled: true }
  | { cancelled: false; pipelineId: string | null };

const KEEP = '__keep__';

/**
 * "Assumir" asks which of the claimer's own pipelines the lead should
 * go to. Without this a claimed lead stayed in whatever pipeline it
 * was in (usually the general one), so it never showed up in the
 * vendor's own pipeline even though it was already theirs.
 *
 * Returns a promise-based `pickPipeline` plus the dialog to render.
 * Someone who isn't responsible for any pipeline gets no dialog at
 * all — the claim just goes ahead as before.
 */
export function useClaimPipelinePicker() {
  const supabase = createClient();
  const { profile } = useAuth();
  const profileId = profile?.id;

  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);
  const [currentPipelineId, setCurrentPipelineId] = useState<string | null>(
    null
  );
  const [selected, setSelected] = useState<string>(KEEP);
  const resolver = useRef<((choice: ClaimPipelineChoice) => void) | null>(
    null
  );

  const settle = useCallback((choice: ClaimPipelineChoice) => {
    resolver.current?.(choice);
    resolver.current = null;
    setOpen(false);
  }, []);

  const pickPipeline = useCallback(
    async (current: string | null = null): Promise<ClaimPipelineChoice> => {
      if (!profileId) return { cancelled: false, pipelineId: null };
      const mine = await loadMyPipelines(supabase, profileId);
      if (mine.length === 0) return { cancelled: false, pipelineId: null };

      setOptions(mine);
      setCurrentPipelineId(current);
      // Default to the first of the claimer's pipelines the deal isn't
      // already in — that's the move they almost always want.
      setSelected(mine.find((p) => p.id !== current)?.id ?? KEEP);
      setOpen(true);
      return new Promise<ClaimPipelineChoice>((resolve) => {
        resolver.current = resolve;
      });
    },
    [supabase, profileId]
  );

  const alreadyInMine =
    !!currentPipelineId && options.some((p) => p.id === currentPipelineId);

  const dialog = (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) settle({ cancelled: true });
      }}
    >
      <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white">
            Para qual funil vai esse lead?
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {options.map((p) => (
            <label
              key={p.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 has-[:checked]:border-primary"
            >
              <input
                type="radio"
                name="claim-pipeline"
                value={p.id}
                checked={selected === p.id}
                onChange={() => setSelected(p.id)}
                className="accent-primary"
              />
              <GitBranch className="text-primary h-3.5 w-3.5" />
              <span className="flex-1">{p.name}</span>
              {p.id === currentPipelineId && (
                <span className="text-xs text-slate-500">atual</span>
              )}
            </label>
          ))}
          {!alreadyInMine && (
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 has-[:checked]:border-primary">
              <input
                type="radio"
                name="claim-pipeline"
                value={KEEP}
                checked={selected === KEEP}
                onChange={() => setSelected(KEEP)}
                className="accent-primary"
              />
              <span className="flex-1">Manter no funil atual</span>
            </label>
          )}
        </div>
        <DialogFooter className="border-slate-700 bg-slate-900/50">
          <Button
            variant="outline"
            onClick={() => settle({ cancelled: true })}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            Cancelar
          </Button>
          <Button
            onClick={() =>
              settle({
                cancelled: false,
                pipelineId:
                  selected === KEEP || selected === currentPipelineId
                    ? null
                    : selected,
              })
            }
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Assumir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { pickPipeline, dialog };
}
