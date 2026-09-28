'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Dashboard error boundary. Without it any client-side exception fell
 * through to Next's bare "This page couldn't load" screen (in English,
 * no sidebar) and users thought their save had been lost. The sidebar
 * layout stays mounted; "Tentar de novo" re-renders the segment.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[dashboard] render error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <AlertTriangle className="h-10 w-10 text-amber-400" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-white">
          Algo deu errado ao exibir esta tela
        </h2>
        <p className="max-w-md text-sm text-slate-400">
          O que você já salvou continua salvo. Se o tradutor automático do
          navegador estiver ligado nesta página, desative e tente de novo.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Tentar de novo
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
        >
          Recarregar página
        </button>
      </div>
      {error.digest && (
        <p className="text-[11px] text-slate-600">código: {error.digest}</p>
      )}
    </div>
  );
}
