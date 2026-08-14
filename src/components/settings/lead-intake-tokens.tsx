'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface IntakeTokenRow {
  id: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
}

interface CreatedToken {
  token: string;
  endpoint: string;
}

const MAX_LABEL_LEN = 80;

function fmtDate(value: string | null): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LeadIntakeTokens() {
  const [tokens, setTokens] = useState<IntakeTokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedToken | null>(null);

  const loadTokens = useCallback(async () => {
    try {
      const response = await fetch('/api/account/lead-intake-tokens', {
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to load intake tokens');
        return;
      }
      const payload = (await response.json()) as { tokens: IntakeTokenRow[] };
      setTokens(payload.tokens);
    } catch (err) {
      console.error('[LeadIntakeTokens] load error:', err);
      toast.error('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  async function createToken() {
    const trimmed = label.trim();
    if (trimmed.length > MAX_LABEL_LEN) {
      toast.error(`Label must be ${MAX_LABEL_LEN} characters or fewer`);
      return;
    }

    setCreating(true);
    try {
      const response = await fetch('/api/account/lead-intake-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: trimmed || undefined }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to create intake token');
        return;
      }

      const payload = (await response.json()) as CreatedToken & {
        intakeToken: IntakeTokenRow;
      };
      setTokens((current) => [payload.intakeToken, ...current]);
      setCreated({ token: payload.token, endpoint: payload.endpoint });
      setLabel('');
    } catch (err) {
      console.error('[LeadIntakeTokens] create error:', err);
      toast.error('Could not reach the server');
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(id: string) {
    setRevokingId(id);
    try {
      const response = await fetch(`/api/account/lead-intake-tokens/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to revoke intake token');
        return;
      }
      setTokens((current) => current.filter((token) => token.id !== id));
      toast.success('Intake token revoked');
    } catch (err) {
      console.error('[LeadIntakeTokens] revoke error:', err);
      toast.error('Could not reach the server');
    } finally {
      setRevokingId(null);
    }
  }

  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch {
      toast.error('Clipboard blocked — copy the value manually');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Site lead intake</h2>
        <p className="text-sm text-slate-400">
          Generate revocable credentials for landing pages and website forms.
          Each valid submission creates a card in the default pipeline.
        </p>
      </div>

      <Card className="border-slate-700 bg-slate-900 ring-0">
        <CardContent className="space-y-4 p-4">
          <div className="space-y-2">
            <Label htmlFor="intake-token-label" className="text-slate-300">
              Integration label
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="intake-token-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={MAX_LABEL_LEN}
                placeholder="e.g. Main landing page"
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
              <Button
                onClick={createToken}
                disabled={creating}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
              >
                {creating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Generate token
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Use a separate token per site so a compromised integration can be
              revoked without breaking the others.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-slate-300">Active tokens</h3>
        {tokens.length === 0 ? (
          <Card className="border-slate-700 bg-slate-900 ring-0">
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <KeyRound className="size-7 text-slate-600" />
              <p className="text-sm text-slate-400">No active tokens yet.</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-slate-700 bg-slate-900 ring-0">
            <CardContent className="p-0">
              <ul className="divide-y divide-slate-800">
                {tokens.map((token) => (
                  <li
                    key={token.id}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">
                        {token.label || 'Untitled integration'}
                      </p>
                      <p className="text-xs text-slate-500">
                        Created {fmtDate(token.created_at)} · Last used{' '}
                        {fmtDate(token.last_used_at)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revokingId === token.id}
                      onClick={() => revokeToken(token.id)}
                      className="border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
                    >
                      {revokingId === token.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog
        open={created !== null}
        onOpenChange={(open) => !open && setCreated(null)}
      >
        <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">
              Intake token created
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Copy this token now. Only its SHA-256 hash is stored, so the
              plaintext cannot be shown again.
            </DialogDescription>
          </DialogHeader>
          {created && (
            <div className="space-y-4 py-2">
              <CredentialRow
                label="Endpoint"
                value={`${window.location.origin}${created.endpoint}`}
                onCopy={() =>
                  copy(
                    `${window.location.origin}${created.endpoint}`,
                    'Endpoint copied'
                  )
                }
              />
              <CredentialRow
                label="Token"
                value={created.token}
                onCopy={() => copy(created.token, 'Token copied')}
                primary
              />
              <div className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
                Send JSON with <code>token</code>, <code>phone</code>, and
                optional <code>name</code>, <code>email</code>, <code>utm</code>
                , and the honeypot field <code>company</code>.
              </div>
            </div>
          )}
          <DialogFooter className="border-slate-700 bg-slate-900">
            <Button
              onClick={() => setCreated(null)}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CredentialRow({
  label,
  value,
  onCopy,
  primary = false,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  primary?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-slate-300">{label}</Label>
      <div className="flex gap-2">
        <Input
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className="border-slate-700 bg-slate-800 font-mono text-xs text-white"
        />
        <Button
          variant={primary ? 'default' : 'outline'}
          onClick={onCopy}
          className={
            primary
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'border-slate-700 text-slate-300 hover:bg-slate-800'
          }
        >
          <Copy className="size-4" />
          {primary ? 'Copy' : null}
        </Button>
      </div>
    </div>
  );
}
