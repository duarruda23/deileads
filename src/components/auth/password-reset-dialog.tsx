'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, KeyRound, Link2, Loader2, Mail } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * "Redefinir senha" for someone else — a gestor for a vendor
 * (Settings → Members) or the Super Admin for a gestor (Admin →
 * Accounts). `endpoint` is the POST route that does the work; both
 * share the { mode: 'link' | 'email' } contract.
 */
export function PasswordResetDialog({
  open,
  onOpenChange,
  endpoint,
  targetName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpoint: string;
  targetName: string;
}) {
  const [busy, setBusy] = useState<'link' | 'email' | null>(null);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    if (open) setLink(null);
  }, [open]);

  async function run(mode: 'link' | 'email') {
    setBusy(mode);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Não foi possível redefinir a senha');
        return;
      }
      if (mode === 'link' && payload.link) {
        setLink(payload.link);
      } else {
        toast.success('E-mail de redefinição enviado');
        onOpenChange(false);
      }
    } catch {
      toast.error('Não foi possível falar com o servidor');
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copiado');
    } catch {
      toast.error('Não foi possível copiar — selecione o link e copie');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <KeyRound className="text-primary size-4" />
            Redefinir senha
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {targetName} vai escolher uma senha nova ao abrir o link. O link
            vale por 1 hora e só pode ser usado uma vez.
          </DialogDescription>
        </DialogHeader>

        {link ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-300">
              Mande este link pra {targetName} (pelo WhatsApp, por exemplo):
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="border-slate-700 bg-slate-800 text-xs text-white"
              />
              <Button
                onClick={copyLink}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Copy className="size-4" />
                Copiar
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              onClick={() => run('link')}
              disabled={busy !== null}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {busy === 'link' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              Gerar link
            </Button>
            <Button
              variant="outline"
              onClick={() => run('email')}
              disabled={busy !== null}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              {busy === 'email' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Mail className="size-4" />
              )}
              Enviar por e-mail
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
