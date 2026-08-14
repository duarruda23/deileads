'use client';

// ============================================================
// LeadVisibilityGrantsPanel — Settings → Members → "Share leads"
//
// 034/035: admin-only. Lets an admin give one vendor read-only
// visibility into another vendor's leads/deals/conversations,
// without changing either vendor's role. Structurally mirrors
// members-tab.tsx's roster list (Card + divide-y rows, destructive
// confirm Dialog) and invite-member-dialog.tsx's single-step form
// dialog — new UI, but no new visual language.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Eye, Loader2, Plus, Trash2, UsersRound } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Member {
  user_id: string;
  full_name: string;
}

interface Grant {
  id: string;
  created_at: string;
  viewer_user_id: string | null;
  viewer_name: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
}

export function LeadVisibilityGrantsPanel({ members }: { members: Member[] }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [viewerId, setViewerId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState<Grant | null>(null);
  const [revokePending, setRevokePending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/lead-visibility-grants', { cache: 'no-store' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to load grants');
        return;
      }
      const data = (await res.json()) as { grants: Grant[] };
      setGrants(data.grants);
    } catch (err) {
      console.error('[LeadVisibilityGrantsPanel] load error:', err);
      toast.error('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setViewerId('');
    setOwnerId('');
  }

  async function handleCreate() {
    if (!viewerId || !ownerId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/account/lead-visibility-grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewer_user_id: viewerId, owner_user_id: ownerId }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to create grant');
        return;
      }
      toast.success('Access granted');
      setAddOpen(false);
      resetForm();
      await load();
    } catch (err) {
      console.error('[LeadVisibilityGrantsPanel] create error:', err);
      toast.error('Could not reach the server');
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke() {
    if (!revoking) return;
    setRevokePending(true);
    try {
      const res = await fetch(`/api/account/lead-visibility-grants?id=${revoking.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to revoke access');
        return;
      }
      toast.success('Access revoked');
      setGrants((prev) => prev.filter((g) => g.id !== revoking.id));
      setRevoking(null);
    } catch (err) {
      console.error('[LeadVisibilityGrantsPanel] revoke error:', err);
      toast.error('Could not reach the server');
    } finally {
      setRevokePending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-3 mt-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Share leads between vendors</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            By default each vendor only sees their own leads. Grant a teammate read-only
            access to another vendor&apos;s leads, deals, and conversations.
          </p>
        </div>
        <Button
          onClick={() => setAddOpen(true)}
          disabled={members.length < 2}
          className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
        >
          <Plus className="size-4" />
          Add
        </Button>
      </div>

      {grants.length === 0 ? (
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <UsersRound className="size-6 text-slate-600" />
            <p className="mt-2 text-sm text-slate-400">No shared access yet.</p>
            <p className="mt-1 text-xs text-slate-500">
              Every vendor sees only their own leads until you add one here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-800">
              {grants.map((g) => (
                <li key={g.id} className="flex items-center gap-3 px-4 py-3">
                  <Eye className="size-4 text-slate-500 shrink-0" />
                  <p className="min-w-0 flex-1 text-sm text-slate-300">
                    <span className="font-medium text-white">
                      {g.viewer_name || 'Unknown'}
                    </span>{' '}
                    can view{' '}
                    <span className="font-medium text-white">
                      {g.owner_name || 'Unknown'}
                    </span>
                    &apos;s leads
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRevoking(g)}
                    className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-200 shrink-0"
                  >
                    <Trash2 className="size-3.5" />
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="bg-slate-900 border-slate-700 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Grant lead access</DialogTitle>
            <DialogDescription className="text-slate-400">
              The teammate you pick first will be able to view (not edit) the second
              teammate&apos;s leads.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm text-slate-300">Give access to</label>
              <Select value={viewerId} onValueChange={(v) => v && setViewerId(v)}>
                <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                  <SelectValue placeholder="Select a teammate" />
                </SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-900 text-slate-200">
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id} disabled={m.user_id === ownerId}>
                      {m.full_name || 'Unnamed'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-slate-300">Leads belonging to</label>
              <Select value={ownerId} onValueChange={(v) => v && setOwnerId(v)}>
                <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                  <SelectValue placeholder="Select a teammate" />
                </SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-900 text-slate-200">
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id} disabled={m.user_id === viewerId}>
                      {m.full_name || 'Unnamed'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setAddOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!viewerId || !ownerId || saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : 'Grant access'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
      >
        <DialogContent className="bg-slate-900 border-slate-700 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Revoke access</DialogTitle>
            <DialogDescription className="text-slate-400">
              <span className="font-medium text-slate-300">{revoking?.viewer_name}</span>{' '}
              will no longer be able to see{' '}
              <span className="font-medium text-slate-300">{revoking?.owner_name}</span>
              &apos;s leads.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setRevoking(null)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRevoke}
              disabled={revokePending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {revokePending ? <Loader2 className="size-4 animate-spin" /> : 'Revoke access'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
