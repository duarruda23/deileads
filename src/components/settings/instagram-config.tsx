'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Camera,
  Loader2,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface HealthPayload {
  connected: boolean;
  reason?: string;
  message?: string;
  config?: { page_id?: string; ig_business_account_id?: string };
  account?: { username?: string; name?: string };
}

export function InstagramConfig() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState('');
  const [pageId, setPageId] = useState('');
  const [instagramAccountId, setInstagramAccountId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [showSecrets, setShowSecrets] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const webhookUrl =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}/api/instagram/webhook`;

  async function load() {
    setLoading(true);
    try {
      const response = await fetch('/api/instagram/config', {
        cache: 'no-store',
      });
      const payload = (await response.json()) as HealthPayload;
      if (!response.ok)
        throw new Error(payload.message || 'Falha ao carregar configuração');
      setConnected(payload.connected);
      setPageId(payload.config?.page_id || '');
      setInstagramAccountId(payload.config?.ig_business_account_id || '');
      setUsername(payload.account?.username || payload.account?.name || '');
      setErrorMessage(payload.connected ? '' : payload.message || '');
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Falha ao carregar a configuração do Instagram'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (
      !instagramAccountId.trim() ||
      !accessToken.trim() ||
      !verifyToken.trim()
    ) {
      toast.error(
        'Preencha o ID da conta do Instagram, o Access Token e o Verify Token'
      );
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/instagram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_id: pageId.trim(),
          ig_business_account_id: instagramAccountId.trim(),
          access_token: accessToken.trim(),
          verify_token: verifyToken.trim(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        toast.error(payload.error || 'Falha ao salvar a configuração do Instagram');
        return;
      }
      if (payload.subscription_error) {
        setErrorMessage(payload.subscription_error);
        toast.warning('Credenciais salvas, mas a assinatura do webhook falhou');
      } else {
        toast.success('Instagram conectado e assinado');
      }
      setAccessToken('');
      setVerifyToken('');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    const response = await fetch('/api/instagram/config', { method: 'DELETE' });
    if (!response.ok) {
      toast.error('Falha ao desconectar o Instagram');
      return;
    }
    setConnected(false);
    setUsername('');
    setPageId('');
    setInstagramAccountId('');
    toast.success('Instagram desconectado');
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
          <AlertTitle>Instagram conectado</AlertTitle>
          <AlertDescription>
            {username ? `@${username}` : instagramAccountId} já está pronta pra
            receber DMs — mensagens diretas do Instagram viram lead/conversa
            automaticamente aqui no Deileads.
          </AlertDescription>
        </Alert>
      )}
      {errorMessage && (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
          <AlertTitle>Conexão precisa de atenção</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <Card className="border-slate-700 bg-slate-900 ring-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Camera className="size-5" /> Integração com Instagram (Direct)
          </CardTitle>
          {!connected && (
            <p className="text-sm text-slate-400">
              Conecta a conta profissional do Instagram pra que as mensagens
              diretas (DMs) recebidas apareçam e possam ser respondidas direto
              por aqui. Precisa de uma conta Instagram profissional
              (Empresarial ou Criador de conteúdo) e de um app criado em{' '}
              <span className="text-slate-300">developers.facebook.com</span>.
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="ID da conta profissional do Instagram"
            value={instagramAccountId}
            onChange={setInstagramAccountId}
            placeholder="1784…"
            hint="No painel do seu app em developers.facebook.com → Instagram → API Setup with Instagram Login, copie o 'Instagram user ID' da conta conectada."
          />
          <Field
            label="ID da Página do Facebook (opcional pra Instagram Login)"
            value={pageId}
            onChange={setPageId}
            placeholder="Só necessário em integrações via Página vinculada"
            hint="Preencha apenas se sua conta do Instagram estiver conectada a uma Página do Facebook (fluxo mais antigo). Pra Instagram Login direto, pode deixar em branco."
          />
          <Field
            label="Access Token"
            value={accessToken}
            onChange={setAccessToken}
            secret={!showSecrets}
            placeholder={
              connected
                ? 'Preencha de novo pra atualizar a configuração'
                : 'Token de acesso gerado no painel da Meta'
            }
            hint="Gerado em developers.facebook.com → seu app → Configurações do app → Configurações Básicas, ou via Explorador da API Graph com as permissões do Instagram Messaging concedidas."
          />
          <Field
            label="Webhook Verify Token"
            value={verifyToken}
            onChange={setVerifyToken}
            secret={!showSecrets}
            placeholder="Um valor privado que você mesmo inventa"
            hint="Você cria essa palavra-chave (qualquer texto). Cole exatamente o mesmo valor no campo 'Verify Token' quando cadastrar o webhook abaixo lá no painel da Meta."
          />
          <button
            type="button"
            onClick={() => setShowSecrets((value) => !value)}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-white"
          >
            {showSecrets ? (
              <EyeOff className="size-3" />
            ) : (
              <Eye className="size-3" />
            )}
            {showSecrets ? 'Ocultar valores' : 'Mostrar valores'}
          </button>
          <div className="space-y-2">
            <Label className="text-slate-300">URL de callback do webhook</Label>
            <Input
              readOnly
              value={webhookUrl}
              className="border-slate-700 bg-slate-800 font-mono text-xs text-white"
              onFocus={(event) => event.currentTarget.select()}
            />
            <p className="text-xs text-slate-500">
              Cole essa URL no painel da Meta em Instagram → Configuração →
              Webhooks, junto com o mesmo Verify Token de cima, e assine o
              campo &quot;messages&quot;.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={save}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving && <Loader2 className="size-4 animate-spin" />} Salvar e
              assinar
            </Button>
            {connected && (
              <Button
                variant="outline"
                onClick={disconnect}
                className="border-red-500/40 text-red-300 hover:bg-red-500/10"
              >
                <Trash2 className="size-4" /> Desconectar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secret = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  secret?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-slate-300">{label}</Label>
      <Input
        type={secret ? 'password' : 'text'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
      />
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
