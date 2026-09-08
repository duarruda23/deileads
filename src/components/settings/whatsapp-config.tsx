'use client';

// ============================================================
// WhatsAppConfig — Settings → WhatsApp Config
//
// 034: whatsapp_config moved from one-row-per-account to one-row-
// per-vendor. Non-admins only ever manage their own connection, so
// they see the form directly (whatsapp-config-form.tsx), unchanged
// from the pre-034 UX. Admins get a roster — one row per account
// member, mirroring members-tab.tsx's list pattern — showing who's
// connected, which number is primary (used by Broadcasts/Templates),
// and a way to drill into any teammate's connection.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Phone, Star, XCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { WhatsAppConfigForm } from './whatsapp-config-form';

interface MemberRow {
  user_id: string;
  full_name: string;
  email: string | null;
}

interface ConnectionRow {
  user_id: string;
  status: 'connected' | 'disconnected';
  is_primary: boolean;
  phone_number_id: string;
}

function getInitials(name?: string | null) {
  if (!name) return '?';
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

export function WhatsAppConfig() {
  const supabase = createClient();
  const { user, accountId } = useAuth();
  const canManageAll = useCan('manage-members'); // admin+

  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [selected, setSelected] = useState<{ userId: string; label?: string } | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);

  const fetchRoster = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const [membersRes, connectionsRes] = await Promise.all([
        fetch('/api/account/members').then((r) => (r.ok ? r.json() : { members: [] })),
        supabase
          .from('whatsapp_config')
          .select('user_id, status, is_primary, phone_number_id')
          .eq('account_id', accountId),
      ]);
      setMembers((membersRes.members ?? []) as MemberRow[]);
      setConnections((connectionsRes.data ?? []) as ConnectionRow[]);
    } catch (err) {
      console.error('Failed to load WhatsApp connections roster:', err);
      toast.error('Falha ao carregar as conexões');
    } finally {
      setLoading(false);
    }
  }, [accountId, supabase]);

  useEffect(() => {
    if (canManageAll) fetchRoster();
  }, [canManageAll, fetchRoster]);

  async function handleSetPrimary(userId: string) {
    setPromoting(userId);
    try {
      const res = await fetch('/api/whatsapp/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, is_primary: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Falha ao definir a conexão principal');
        return;
      }
      toast.success('Conexão principal atualizada. Disparos e Modelos vão usar esse número.');
      await fetchRoster();
    } catch {
      toast.error('Falha ao definir a conexão principal');
    } finally {
      setPromoting(null);
    }
  }

  // Non-admin: just their own connection, no roster chrome. Matches
  // the pre-034 single-form UX exactly.
  if (!canManageAll) {
    return <WhatsAppConfigForm />;
  }

  if (selected) {
    return (
      <WhatsAppConfigForm
        targetUserId={selected.userId}
        targetLabel={selected.userId === user?.id ? undefined : selected.label}
        onBack={() => setSelected(null)}
        onChanged={fetchRoster}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const connectionByUser = new Map(connections.map((c) => [c.user_id, c]));

  return (
    <div className="mt-4 space-y-4">
      <div>
        <h3 className="text-white font-medium">Conexões de WhatsApp</h3>
        <p className="text-sm text-slate-400">
          Cada integrante do time conecta o próprio número de WhatsApp. O
          número marcado como{' '}
          <Star className="inline size-3 -mt-0.5 text-amber-400" /> Principal
          é o usado nos Disparos e nos Modelos de mensagem, independente de
          quem é dono de um lead específico.
        </p>
      </div>

      <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
        <CardContent className="p-0 divide-y divide-slate-800">
          {members.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">Ainda não tem ninguém no time.</p>
          ) : (
            members.map((m) => {
              const conn = connectionByUser.get(m.user_id);
              const isSelf = m.user_id === user?.id;
              return (
                <div
                  key={m.user_id}
                  className="flex items-center justify-between gap-3 p-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="size-9 bg-slate-800 border border-slate-700">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                        {getInitials(m.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {m.full_name || m.email || 'Sem nome'}
                        {isSelf && <span className="text-slate-500 font-normal"> (você)</span>}
                      </p>
                      <p className="text-xs text-slate-500 truncate flex items-center gap-1">
                        {conn ? (
                          <>
                            <Phone className="size-3" />
                            {conn.phone_number_id}
                          </>
                        ) : (
                          'Não conectado'
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {conn?.is_primary && (
                      <Badge className="bg-amber-500/10 text-amber-300 border-amber-500/30 gap-1">
                        <Star className="size-3" />
                        Principal
                      </Badge>
                    )}
                    {conn ? (
                      conn.status === 'connected' ? (
                        <Badge className="bg-primary/10 text-primary border-primary/30 gap-1">
                          <CheckCircle2 className="size-3" />
                          Conectado
                        </Badge>
                      ) : (
                        <Badge className="bg-red-500/10 text-red-300 border-red-500/30 gap-1">
                          <XCircle className="size-3" />
                          Desconectado
                        </Badge>
                      )
                    ) : null}
                    {conn && !conn.is_primary && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={promoting === m.user_id}
                        onClick={() => handleSetPrimary(m.user_id)}
                        className="border-slate-700 text-slate-300 hover:bg-slate-800"
                      >
                        {promoting === m.user_id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          'Tornar principal'
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() =>
                        setSelected({ userId: m.user_id, label: m.full_name || m.email || 'este integrante' })
                      }
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                      {conn ? 'Gerenciar' : 'Conectar'}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
