"use client";

import { useCallback, useEffect, useState } from "react";
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

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [accountName, setAccountName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

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
    setCreateSuccess(null);

    const res = await fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountName, ownerEmail }),
    });
    const body = await res.json();
    setCreating(false);

    if (!res.ok) {
      setCreateError(body.error ?? "Failed to create account");
      return;
    }

    setCreateSuccess(
      `Conta "${accountName}" criada — convite enviado pra ${ownerEmail}.`,
    );
    setAccountName("");
    setOwnerEmail("");
    load();
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

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle className="text-white">Nova conta-cliente</CardTitle>
          <CardDescription className="text-slate-400">
            Cria a conta e envia um convite por e-mail pro Cliente Admin
            definir a própria senha.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            {createError && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {createError}
              </div>
            )}
            {createSuccess && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
                {createSuccess}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
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
              <div className="flex flex-col gap-2">
                <Label htmlFor="ownerEmail" className="text-slate-300">
                  E-mail do Cliente Admin
                </Label>
                <Input
                  id="ownerEmail"
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="dono@cliente.com"
                  required
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </div>
            </div>
            <Button type="submit" disabled={creating} className="w-fit">
              {creating ? "Criando..." : "Criar conta e convidar"}
            </Button>
          </form>
        </CardContent>
      </Card>

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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleStatus(a)}
                      >
                        {a.status === "active" ? "Suspender" : "Reativar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
