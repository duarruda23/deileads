"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AccountRow {
  id: string;
  name: string;
  status: "active" | "suspended";
  created_at: string;
  owner: { full_name: string | null; email: string } | null;
}

interface PendingInvitation {
  id: string;
  account_name: string;
  label: string | null;
  created_at: string;
  expires_at: string;
}

// Shared by both "generate" (POST /api/admin/accounts) and "resend"
// (POST /api/admin/accounts/invitations/[id]) — either way the admin
// ends up with one fresh link to copy/share.
interface ResendResult {
  accountName: string;
  url: string;
}

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<
    PendingInvitation[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const [accountName, setAccountName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  // Set on resend so the same link-display panel used by "Nova
  // conta-cliente" can show it in a modal instead of inline — a
  // per-row action shouldn't reshuffle the whole page layout.
  const [resendResult, setResendResult] = useState<ResendResult | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  // Account pending deletion, confirmed via the dialog below — kept
  // separate from a plain boolean so the dialog can show which
  // account it's about to permanently destroy.
  const [deleteTarget, setDeleteTarget] = useState<AccountRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin/accounts");
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to load accounts");
      return;
    }
    const body = await res.json();
    setAccounts(body.accounts);
    setPendingInvitations(body.pendingInvitations ?? []);
  }, []);

  useEffect(() => {
    // setState inside `load` runs after the fetch's await settles, not
    // synchronously in the effect body — same non-cascading pattern
    // already used by (dashboard)/contacts/page.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setInviteUrl(null);

    const res = await fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountName }),
    });
    const body = await res.json();
    setCreating(false);

    if (!res.ok) {
      setCreateError(body.error ?? "Failed to create account");
      return;
    }

    // The account itself doesn't exist yet — it's only created once
    // someone redeems this link and sets their own password (see
    // /api/admin/accounts's comment header) — so `accounts` stays
    // untouched. But it DOES immediately show up as a pending
    // invitation, so still refresh to pick that up.
    setInviteUrl(body.url);
    load();
  };

  const copyInviteUrl = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.success("Link copiado");
    } catch {
      toast.error("Não deu pra copiar automaticamente — copie manualmente");
    }
  };

  const toggleStatus = async (account: AccountRow) => {
    const nextStatus = account.status === "active" ? "suspended" : "active";
    const res = await fetch(`/api/admin/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok) load();
  };

  const copyResendUrl = async () => {
    if (!resendResult) return;
    try {
      await navigator.clipboard.writeText(resendResult.url);
      toast.success("Link copiado");
    } catch {
      toast.error("Não deu pra copiar automaticamente — copie manualmente");
    }
  };

  const resendInvitation = async (invitation: PendingInvitation) => {
    setResendingId(invitation.id);
    try {
      const res = await fetch(
        `/api/admin/accounts/invitations/${invitation.id}`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to resend invitation");
        return;
      }
      setResendResult({ accountName: invitation.account_name, url: body.url });
      load();
    } finally {
      setResendingId(null);
    }
  };

  const cancelInvitation = async (invitation: PendingInvitation) => {
    setCancelingId(invitation.id);
    try {
      const res = await fetch(
        `/api/admin/accounts/invitations/${invitation.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to cancel invitation");
        return;
      }
      toast.success("Convite cancelado");
      load();
    } finally {
      setCancelingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/accounts/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to delete account");
        return;
      }
      toast.success(`Conta "${deleteTarget.name}" apagada`);
      setDeleteTarget(null);
      load();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle className="text-white">Nova conta-cliente</CardTitle>
          <CardDescription className="text-slate-400">
            Gera um link de convite. A conta só é criada quando alguém abre o
            link e define a própria senha — nenhum e-mail é enviado (esse
            projeto não tem envio de e-mail configurado). Compartilhe o link
            você mesmo, por WhatsApp ou o canal que preferir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {inviteUrl ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
                Conta &quot;{accountName}&quot; pronta pra ser reivindicada —
                envie este link pro Cliente Admin.
              </div>
              <Label className="text-slate-300">Link do convite</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={inviteUrl}
                  className="bg-slate-800 border-slate-700 text-white font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" onClick={copyInviteUrl} className="shrink-0">
                  <Copy className="size-4" />
                  Copiar
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-fit border-slate-700 text-slate-300 hover:bg-slate-800"
                onClick={() => {
                  setInviteUrl(null);
                  setAccountName("");
                }}
              >
                Criar outra conta
              </Button>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              {createError && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {createError}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="accountName" className="text-slate-300">
                  Nome da conta
                </Label>
                <Input
                  id="accountName"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="ex: Lojas Parceria"
                  required
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </div>
              <Button type="submit" disabled={creating} className="w-fit">
                {creating ? "Gerando..." : "Gerar link de convite"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle className="text-white">Convites pendentes</CardTitle>
          <CardDescription className="text-slate-400">
            Links gerados que ainda não foram abertos/reivindicados. Use
            &quot;Reenviar&quot; se o link se perdeu ou expirou — ele invalida
            o antigo e gera um novo na hora.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingInvitations === null ? (
            <p className="text-sm text-slate-400">Carregando...</p>
          ) : pendingInvitations.length === 0 ? (
            <p className="text-sm text-slate-400">
              Nenhum convite pendente.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800">
                  <TableHead className="text-slate-400">Conta</TableHead>
                  <TableHead className="text-slate-400">Gerado em</TableHead>
                  <TableHead className="text-slate-400">Expira em</TableHead>
                  <TableHead className="text-slate-400" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvitations.map((inv) => (
                  <TableRow key={inv.id} className="border-slate-800">
                    <TableCell className="text-white">
                      {inv.account_name}
                    </TableCell>
                    <TableCell className="text-slate-400">
                      {new Date(inv.created_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-slate-400">
                      {new Date(inv.expires_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resendingId === inv.id}
                          onClick={() => resendInvitation(inv)}
                        >
                          {resendingId === inv.id ? "Reenviando..." : "Reenviar"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={cancelingId === inv.id}
                          className="border-red-900/50 text-red-400 hover:bg-red-950 hover:text-red-300"
                          onClick={() => cancelInvitation(inv)}
                        >
                          {cancelingId === inv.id ? "Cancelando..." : "Cancelar"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Resend result — modal so a per-row action on the pending-
          invitations table doesn't reshuffle the whole page the way
          the inline "Nova conta-cliente" panel does. */}
      <Dialog
        open={resendResult !== null}
        onOpenChange={(open) => {
          if (!open) setResendResult(null);
        }}
      >
        <DialogContent className="bg-slate-900 border-slate-700 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Convite reenviado</DialogTitle>
            <DialogDescription className="text-slate-400">
              O link antigo foi invalidado. Envie este novo link pro Cliente
              Admin de &quot;{resendResult?.accountName}&quot;.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Label className="text-slate-300">Link do convite</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={resendResult?.url ?? ""}
                className="bg-slate-800 border-slate-700 text-white font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button type="button" onClick={copyResendUrl} className="shrink-0">
                <Copy className="size-4" />
                Copiar
              </Button>
            </div>
          </div>
          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button onClick={() => setResendResult(null)}>Concluído</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle className="text-white">Contas-cliente</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}
          {accounts === null ? (
            <p className="text-sm text-slate-400">Carregando...</p>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-slate-400">
              Nenhuma conta-cliente ainda.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800">
                  <TableHead className="text-slate-400">Conta</TableHead>
                  <TableHead className="text-slate-400">
                    Cliente Admin
                  </TableHead>
                  <TableHead className="text-slate-400">Status</TableHead>
                  <TableHead className="text-slate-400">Criada em</TableHead>
                  <TableHead className="text-slate-400" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.id} className="border-slate-800">
                    <TableCell className="text-white">{a.name}</TableCell>
                    <TableCell className="text-slate-300">
                      {a.owner?.full_name || a.owner?.email || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          a.status === "active" ? "default" : "destructive"
                        }
                      >
                        {a.status === "active" ? "Ativa" : "Suspensa"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-400">
                      {new Date(a.created_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleStatus(a)}
                        >
                          {a.status === "active" ? "Suspender" : "Reativar"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-red-900/50 text-red-400 hover:bg-red-950 hover:text-red-300"
                          onClick={() => setDeleteTarget(a)}
                        >
                          <Trash2 className="size-4" />
                          Apagar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation — this is permanent and cascades to every
          domain row for the account (contacts, deals, conversations,
          messages, everything), plus the owner's login itself. No
          undo, so it gets a blocking modal rather than a toast with
          an "undo" action. */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="bg-slate-900 border-slate-700 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">
              Apagar &quot;{deleteTarget?.name}&quot;?
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Isso apaga a conta inteira pra sempre: contatos, conversas,
              negócios do Kanban, disparos, automações — tudo. O login do
              Cliente Admin (
              <span className="text-slate-300">
                {deleteTarget?.owner?.email}
              </span>
              ) também é removido, liberando o e-mail pra um novo convite.
              Não tem como desfazer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {deleting ? "Apagando..." : "Apagar pra sempre"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
