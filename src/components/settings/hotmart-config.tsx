'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Loader2, ShoppingBag, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface EventOption {
  value: string;
  label: string;
  description: string;
}

// Curated subset the UI offers — must match SUPPORTED_EVENTS in
// /api/account/hotmart-config/route.ts. Hotmart has more purchase
// events (canceled, refunded, chargeback…); these three are what was
// actually asked for. The backend RPC doesn't care if more values
// show up here later — no migration needed to add one.
const EVENT_OPTIONS: EventOption[] = [
  {
    value: 'PURCHASE_OUT_OF_SHOPPING_CART',
    label: 'Carrinho abandonado',
    description: 'Pegou o checkout mas não finalizou — cria o lead como aberto.',
  },
  {
    value: 'PURCHASE_BILLET_PRINTED',
    label: 'Boleto gerado',
    description: 'Gerou boleto mas ainda não pagou — cria/atualiza o lead como aberto.',
  },
  {
    value: 'PURCHASE_APPROVED',
    label: 'Compra aprovada',
    description: 'Compra confirmada — move o lead pra coluna de "Fechado Ganho".',
  },
];

interface ConfigPayload {
  connected: boolean;
  enabledEvents: string[];
  updatedAt: string | null;
}

export function HotmartConfig() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [hottok, setHottok] = useState('');
  const [enabledEvents, setEnabledEvents] = useState<string[]>(
    EVENT_OPTIONS.map((e) => e.value),
  );

  const webhookUrl =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}/api/public/hotmart`;

  async function load() {
    setLoading(true);
    try {
      const response = await fetch('/api/account/hotmart-config', {
        cache: 'no-store',
      });
      const payload = (await response.json()) as ConfigPayload;
      if (!response.ok) throw new Error('Failed to load Hotmart config');
      setConnected(payload.connected);
      setEnabledEvents(payload.enabledEvents);
    } catch {
      toast.error('Failed to load Hotmart configuration');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function toggleEvent(value: string) {
    setEnabledEvents((current) =>
      current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value],
    );
  }

  async function save() {
    if (!connected && !hottok.trim()) {
      toast.error('Cole o Hottok da sua conta Hotmart');
      return;
    }
    if (enabledEvents.length === 0) {
      toast.error('Selecione pelo menos um evento');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/account/hotmart-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Omit hottok on a pure "change which events are enabled"
          // save when already connected and the field was left blank
          // — but the backend still requires SOME hottok on first
          // connect, and re-sending the same one is harmless (it's
          // what "reconnect after Hotmart rotates it" looks like).
          hottok: hottok.trim() || undefined,
          enabledEvents,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        toast.error(payload.error || 'Failed to save Hotmart config');
        return;
      }
      toast.success('Hotmart conectado');
      setHottok('');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      const response = await fetch('/api/account/hotmart-config', {
        method: 'DELETE',
      });
      if (!response.ok) {
        toast.error('Failed to disconnect Hotmart');
        return;
      }
      setConnected(false);
      toast.success('Hotmart desconectado');
    } finally {
      setDisconnecting(false);
    }
  }

  async function copyWebhookUrl() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success('URL copiada');
    } catch {
      toast.error('Não deu pra copiar automaticamente — copie manualmente');
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-5">
      {connected && (
        <Alert className="border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
          <CheckCircle2 className="size-4" />
          <AlertTitle>Hotmart conectado</AlertTitle>
          <AlertDescription>
            Compras e carrinhos abandonados nos eventos marcados abaixo já
            viram lead automaticamente no Kanban.
          </AlertDescription>
        </Alert>
      )}

      <Card className="border-slate-700 bg-slate-900 ring-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <ShoppingBag className="size-5" /> Integração com Hotmart
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label className="text-slate-300">Hottok</Label>
            <Input
              type="password"
              value={hottok}
              onChange={(e) => setHottok(e.target.value)}
              placeholder={
                connected
                  ? 'Cole novamente só se a Hotmart trocou seu token'
                  : 'Cole o Hottok da sua conta Hotmart'
              }
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
            <p className="text-xs text-slate-500">
              Encontrado em Ferramentas → Webhook → Autenticação, dentro do
              painel da Hotmart.
            </p>
          </div>

          <div className="space-y-3">
            <Label className="text-slate-300">Quais eventos viram lead</Label>
            {EVENT_OPTIONS.map((opt) => (
              <div
                key={opt.value}
                className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3"
              >
                <div>
                  <p className="text-sm font-medium text-white">{opt.label}</p>
                  <p className="text-xs text-slate-500">{opt.description}</p>
                </div>
                <Switch
                  checked={enabledEvents.includes(opt.value)}
                  onCheckedChange={() => toggleEvent(opt.value)}
                  aria-label={opt.label}
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300">URL do webhook</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={webhookUrl}
                className="border-slate-700 bg-slate-800 font-mono text-xs text-white"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                onClick={copyWebhookUrl}
                className="shrink-0 border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Cole essa URL no painel da Hotmart em Ferramentas → Webhook →
              Cadastrar Webhook. É a mesma URL pra qualquer conta — o Hottok
              é o que identifica a sua.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={save}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {connected ? 'Salvar alterações' : 'Conectar'}
            </Button>
            {connected && (
              <Button
                variant="outline"
                onClick={disconnect}
                disabled={disconnecting}
                className="border-red-500/40 text-red-300 hover:bg-red-500/10"
              >
                {disconnecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Desconectar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
