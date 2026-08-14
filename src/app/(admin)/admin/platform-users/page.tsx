"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface SellerRow {
  user_id: string;
  full_name: string | null;
  email: string;
  account_role: string;
  created_at: string;
}

export default function AdminPlatformUsersPage() {
  const [sellers, setSellers] = useState<SellerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin/platform-users");
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to load sellers");
      return;
    }
    const body = await res.json();
    setSellers(body.sellers);
  }, []);

  useEffect(() => {
    // See (dashboard)/contacts/page.tsx — setState inside `load` runs
    // after the fetch's await, not synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setInviteError(null);
    setInviteUrl(null);

    const res = await fetch("/api/admin/platform-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json();
    setInviting(false);

    if (!res.ok) {
      setInviteError(body.error ?? "Failed to invite seller");
      return;
    }

    // The seller only shows up in the table below once they actually
    // redeem the link and set their own password — nothing to reload yet.
    setInviteUrl(body.url);
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle className="text-white">
            Novo vendedor da Virgo
          </CardTitle>
          <CardDescription className="text-slate-400">
            Gera um link de convite pra conta interna da Virgo (
            <code>virgo-interno</code>) — quem abrir o link define a própria
            senha, sem depender de e-mail. Depois usa o mesmo Kanban/inbox de
            qualquer conta-cliente, só que pro funil de prospecção da
            própria Virgo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {inviteUrl ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
                Link pronto — envie pro futuro vendedor.
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
                onClick={() => setInviteUrl(null)}
              >
                Gerar outro link
              </Button>
            </div>
          ) : (
            <form onSubmit={handleInvite} className="flex flex-col gap-4">
              {inviteError && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {inviteError}
                </div>
              )}
              <Button type="submit" disabled={inviting} className="w-fit">
                {inviting ? "Gerando..." : "Gerar link de convite"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle className="text-white">Vendedores Virgo</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}
          {sellers === null ? (
            <p className="text-sm text-slate-400">Carregando...</p>
          ) : sellers.length === 0 ? (
            <p className="text-sm text-slate-400">
              Nenhum vendedor ainda — a conta interna é criada
              automaticamente no primeiro convite.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800">
                  <TableHead className="text-slate-400">Nome</TableHead>
                  <TableHead className="text-slate-400">E-mail</TableHead>
                  <TableHead className="text-slate-400">Papel</TableHead>
                  <TableHead className="text-slate-400">Desde</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sellers.map((s) => (
                  <TableRow key={s.user_id} className="border-slate-800">
                    <TableCell className="text-white">
                      {s.full_name || "—"}
                    </TableCell>
                    <TableCell className="text-slate-300">
                      {s.email}
                    </TableCell>
                    <TableCell className="text-slate-300">
                      {s.account_role}
                    </TableCell>
                    <TableCell className="text-slate-400">
                      {new Date(s.created_at).toLocaleDateString("pt-BR")}
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
