'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Zap,
  AlertTriangle,
  RotateCcw,
  ArrowLeft,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';

const MASKED_TOKEN = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason = 'token_corrupted' | 'meta_api_error' | null;

interface WhatsAppConfigFormProps {
  /** auth.users.id of the vendor this connection belongs to. Defaults
   *  to the signed-in user — pass a teammate's id (admin+ only, the
   *  API enforces this server-side) to manage their connection. */
  targetUserId?: string;
  /** Display name shown in the header when managing someone else's
   *  connection (omitted when managing your own). */
  targetLabel?: string;
  /** Shown when this form is opened from the multi-vendor list
   *  (whatsapp-config.tsx) — lets the admin go back to the roster. */
  onBack?: () => void;
  /** Called after a successful save/reset so the parent list can
   *  refresh its rows. No-op when rendered standalone (agent's own
   *  connection, no list wrapping it). */
  onChanged?: () => void;
}

/**
 * 034: one vendor's WhatsApp connection. Extracted from the original
 * single-account-wide form (whatsapp-config.tsx) so the same UI can
 * be reused both standalone (an agent managing their own number) and
 * per-row inside the admin's multi-vendor list.
 */
export function WhatsAppConfigForm({
  targetUserId,
  targetLabel,
  onBack,
  onChanged,
}: WhatsAppConfigFormProps) {
  const supabase = createClient();
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();
  const effectiveUserId = targetUserId ?? user?.id ?? null;
  const isSelf = !targetUserId || targetUserId === user?.id;
  const userIdQuery = isSelf ? '' : `?userId=${encodeURIComponent(effectiveUserId ?? '')}`;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<WhatsAppConfigType | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [resetReason, setResetReason] = useState<ResetReason>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [pin, setPin] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);

  // True once /register has succeeded on Meta's side (timestamp set
  // in the row). When false, the saved config is metadata-only and
  // Meta will silently drop every inbound event — that's the
  // multi-number bug that prompted this work.
  const isRegistered = Boolean(config?.registered_at);
  const lastRegistrationError = config?.last_registration_error ?? null;

  const [verifyingRegistration, setVerifyingRegistration] = useState(false);
  type RegistrationProbe = {
    live: boolean;
    checks: Record<string, boolean | null>;
    errors?: string[];
    last_registration_error?: string | null;
    registered_at?: string | null;
    subscribed_apps_at?: string | null;
  };
  const [registrationProbe, setRegistrationProbe] =
    useState<RegistrationProbe | null>(null);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '';

  const fetchConfig = useCallback(async (acctId: string, forUserId: string) => {
    setLoading(true);
    try {
      // 034: whatsapp_config is one-row-per-vendor — scope by both
      // account_id and this specific vendor's user_id.
      const { data, error } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', acctId)
        .eq('user_id', forUserId)
        .maybeSingle();

      if (error) {
        console.error('Failed to load config row:', error);
      }

      if (data) {
        setConfig(data);
        setPhoneNumberId(data.phone_number_id || '');
        setWabaId(data.waba_id || '');
        setAccessToken(MASKED_TOKEN);
        setVerifyToken('');
        setPin('');
        setTokenEdited(false);
      } else {
        setConfig(null);
        setPhoneNumberId('');
        setWabaId('');
        setAccessToken('');
        setVerifyToken('');
        setPin('');
        setTokenEdited(false);
      }
      // Clear any stale probe result when reloading the row.
      setRegistrationProbe(null);

      // Then verify health via the API (decrypts token + pings Meta)
      if (data) {
        try {
          const res = await fetch(`/api/whatsapp/config${userIdQuery}`, { method: 'GET' });
          const payload = await res.json();

          if (payload.connected) {
            setConnectionStatus('connected');
            setResetReason(null);
            setStatusMessage('');
          } else {
            setConnectionStatus('disconnected');
            setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
            setStatusMessage(payload.message || '');
          }
        } catch (err) {
          console.error('Health check failed:', err);
          setConnectionStatus('disconnected');
        }
      } else {
        setConnectionStatus('disconnected');
        setResetReason(null);
        setStatusMessage('');
      }
    } catch (err) {
      console.error('fetchConfig error:', err);
      toast.error('Failed to load WhatsApp configuration');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, userIdQuery]);

  useEffect(() => {
    // Need both the auth session (`!authLoading`) AND the profile
    // (`!profileLoading`, which carries `accountId`). Without the
    // second guard, the effect would fire with `accountId === null`
    // for the first render window and bail without ever retrying
    // once the profile arrives.
    if (authLoading || profileLoading) return;
    if (!user || !accountId || !effectiveUserId) {
      setLoading(false);
      return;
    }
    fetchConfig(accountId, effectiveUserId);
  }, [authLoading, profileLoading, user, accountId, effectiveUserId, fetchConfig]);

  async function handleSave() {
    if (!phoneNumberId.trim()) {
      toast.error('O Phone Number ID é obrigatório');
      return;
    }
    if (!config && (!accessToken.trim() || !tokenEdited)) {
      toast.error('O Access Token é obrigatório na primeira configuração');
      return;
    }

    try {
      setSaving(true);

      // Always POST through the API — it verifies with Meta and encrypts
      // the access_token server-side with ENCRYPTION_KEY. Skipping this
      // and writing direct to Supabase stores the token in plaintext,
      // which then fails decryption on every subsequent health check.
      const payload: Record<string, unknown> = {
        phone_number_id: phoneNumberId.trim(),
        waba_id: wabaId.trim() || null,
        verify_token: verifyToken.trim() || null,
        // Optional — only sent when the user filled it in. The server
        // requires it on first save or when changing numbers; for a
        // simple token rotation, leaving it blank skips re-register.
        pin: pin.trim() || null,
        // 034: only meaningful for an admin managing a teammate's row
        // — the API defaults to the caller's own id otherwise.
        user_id: effectiveUserId,
      };

      if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
        payload.access_token = accessToken.trim();
      } else if (config) {
        // Existing config — reuse stored encrypted token by decrypting on the
        // server. But our POST handler requires an access_token to verify
        // with Meta. If the user didn't change the token, we need to signal
        // that. Simplest: require token re-entry if they're updating.
        toast.error('Preencha o Access Token de novo pra salvar as alterações');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Falha ao salvar a configuração');
        setSaving(false);
        return;
      }

      // The route now returns a structured outcome:
      //   * registered=true   → number is live, events will flow
      //   * registered=false  → credentials saved but /register
      //                         failed; UI shows the specific error
      //                         and a retry path. registration_error
      //                         is human-readable from Meta.
      if (data.registered === false && data.registration_error) {
        toast.error(
          `Salvo, mas a Meta não conseguiu registrar o número: ${data.registration_error}`,
          { duration: 12000 },
        );
      } else if (data.registration_skipped) {
        // Credentials saved + verified, but /register was skipped
        // because no PIN was supplied (e.g. a Meta test number).
        // Don't claim the number is "Live" — point at the
        // Registration status banner instead.
        toast.success(
          'Credenciais salvas e verificadas. O registro de mensagens recebidas foi pulado (sem PIN) — veja o status de registro abaixo.',
          { duration: 10000 },
        );
        setPin('');
      } else {
        toast.success(
          data.phone_info?.verified_name
            ? `Ativo — ${data.phone_info.verified_name} já pode receber eventos.`
            : 'WhatsApp conectado. Os eventos começam a chegar em até um minuto.',
        );
        // Clear the PIN so subsequent saves don't accidentally
        // re-register (which would void the active subscription if
        // the PIN became stale).
        setPin('');
      }

      if (accountId && effectiveUserId) await fetchConfig(accountId, effectiveUserId);
      onChanged?.();
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Falha ao salvar a configuração');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    try {
      setTesting(true);
      const res = await fetch(`/api/whatsapp/config${userIdQuery}`, { method: 'GET' });
      const payload = await res.json();

      if (payload.connected) {
        setConnectionStatus('connected');
        setResetReason(null);
        setStatusMessage('');
        toast.success(
          payload.phone_info?.verified_name
            ? `Conectado a ${payload.phone_info.verified_name}`
            : 'Conexão com a API funcionando'
        );
      } else {
        setConnectionStatus('disconnected');
        setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
        setStatusMessage(payload.message || '');
        toast.error(payload.message || 'Falha na conexão com a API');
      }
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error('Teste de conexão falhou. Confira a rede e tente de novo.');
    } finally {
      setTesting(false);
    }
  }

  async function handleVerifyRegistration() {
    setVerifyingRegistration(true);
    setRegistrationProbe(null);
    try {
      const res = await fetch(`/api/whatsapp/config/verify-registration${userIdQuery}`, {
        method: 'GET',
      });
      const data = (await res.json()) as RegistrationProbe;
      setRegistrationProbe(data);
      if (data.live) {
        toast.success('Número totalmente conectado — a Meta está entregando eventos.');
      } else {
        toast.error(
          'Número não está totalmente registrado. Veja abaixo qual etapa falhou.',
          { duration: 8000 },
        );
      }
      if (accountId && effectiveUserId) await fetchConfig(accountId, effectiveUserId);
    } catch (err) {
      console.error('verify-registration failed:', err);
      toast.error('Não foi possível checar o registro agora.');
    } finally {
      setVerifyingRegistration(false);
    }
  }

  async function handleReset() {
    if (!confirm('Isso vai apagar a configuração atual do WhatsApp pra você poder preencher de novo. Continuar?')) {
      return;
    }

    try {
      setResetting(true);
      const res = await fetch(`/api/whatsapp/config${userIdQuery}`, { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Falha ao redefinir a configuração');
        return;
      }

      toast.success('Configuração apagada. Agora é só preencher as credenciais de novo.');
      setConfig(null);
      setPhoneNumberId('');
      setWabaId('');
      setAccessToken('');
      setVerifyToken('');
      setTokenEdited(false);
      setConnectionStatus('disconnected');
      setResetReason(null);
      setStatusMessage('');
      onChanged?.();
    } catch (err) {
      console.error('Reset error:', err);
      toast.error('Falha ao redefinir a configuração');
    } finally {
      setResetting(false);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('URL do webhook copiada');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const showResetBanner = resetReason === 'token_corrupted';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px] mt-4">
      {/* Main config form */}
      <div className="space-y-6">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            Voltar pra todas as conexões
          </button>
        )}
        {targetLabel && (
          <p className="text-sm text-slate-400">
            Gerenciando a conexão de <span className="text-white font-medium">{targetLabel}</span>.
          </p>
        )}

        {/* Corrupted-token reset banner */}
        {showResetBanner && (
          <Alert className="bg-amber-950/40 border-amber-600/40">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <AlertTitle className="text-amber-200 mb-1">
                  O token salvo não pôde ser decifrado
                </AlertTitle>
                <AlertDescription className="text-amber-100/80 text-sm">
                  {statusMessage}
                </AlertDescription>
                <Button
                  onClick={handleReset}
                  disabled={resetting}
                  size="sm"
                  className="mt-3 bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {resetting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Redefinindo...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="size-4" />
                      Redefinir configuração
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Alert>
        )}

        {/* Connection Status */}
        <Alert className="bg-slate-900 border-slate-700">
          <div className="flex items-center gap-2">
            {connectionStatus === 'connected' ? (
              <CheckCircle2 className="size-4 text-primary" />
            ) : (
              <XCircle className="size-4 text-red-500" />
            )}
            <AlertTitle className="text-white mb-0">
              {connectionStatus === 'connected' ? 'Credenciais válidas' : 'Não conectado'}
            </AlertTitle>
          </div>
          <AlertDescription className="text-slate-400">
            {connectionStatus === 'connected'
              ? 'Seu access token autentica com a Meta. Veja o status de registro abaixo pra saber se os webhooks estão realmente funcionando.'
              : statusMessage ||
                'Preencha suas credenciais da API da Meta abaixo pra conectar sua conta do WhatsApp Business.'}
          </AlertDescription>
        </Alert>

        {/* Registration Status — the "is it actually live?" check.
            Credentials being valid is necessary but not sufficient;
            without a successful /register call the number won't
            receive inbound events. Surface this dimension separately
            so users don't trust a misleading green banner. */}
        {config && (
          <Alert
            className={
              isRegistered
                ? 'bg-emerald-950/30 border-emerald-700/50'
                : 'bg-amber-950/30 border-amber-700/50'
            }
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                {isRegistered ? (
                  <CheckCircle2 className="size-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="size-4 text-amber-400" />
                )}
                <AlertTitle
                  className={
                    'mb-0 ' + (isRegistered ? 'text-emerald-200' : 'text-amber-200')
                  }
                >
                  {isRegistered
                    ? 'Registrado — a Meta vai entregar eventos pro Deileads'
                    : 'Não registrado — a Meta não vai entregar eventos'}
                </AlertTitle>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleVerifyRegistration}
                disabled={verifyingRegistration}
                className="border-slate-700 bg-transparent text-slate-200 hover:bg-slate-800 h-7"
              >
                {verifyingRegistration ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Zap className="size-3.5" />
                )}
                Verificar com a Meta
              </Button>
            </div>
            <AlertDescription className="text-slate-400 mt-2 text-xs leading-relaxed">
              {isRegistered ? (
                <>
                  Assinado desde{' '}
                  {config.registered_at
                    ? new Date(config.registered_at).toLocaleString()
                    : 'data desconhecida'}
                  . Clique em <strong>Verificar com a Meta</strong> se os
                  eventos pararem de chegar.
                </>
              ) : lastRegistrationError ? (
                <>
                  A última tentativa falhou com:{' '}
                  <span className="text-red-300">
                    &quot;{lastRegistrationError}&quot;
                  </span>
                  . Preencha (ou corrija) o PIN de verificação em duas
                  etapas abaixo e clique em Salvar Configuração pra
                  tentar de novo.
                </>
              ) : (
                <>
                  Esse número foi salvo antes de existir o
                  acompanhamento de registro, ou o registro foi pulado.
                  Preencha o PIN de verificação em duas etapas abaixo e
                  clique em Salvar Configuração pra assiná-lo.
                </>
              )}
            </AlertDescription>

            {registrationProbe && (
              <div className="mt-3 rounded border border-slate-700 bg-slate-900/60 px-3 py-2 space-y-1.5 text-[11px]">
                <p className="font-medium text-slate-200">
                  Diagnóstico — última checagem: {' '}
                  <span className={registrationProbe.live ? 'text-emerald-400' : 'text-amber-400'}>
                    {registrationProbe.live ? 'ativo' : 'não ativo'}
                  </span>
                </p>
                <ul className="space-y-0.5 text-slate-400">
                  {Object.entries(registrationProbe.checks).map(([k, v]) => (
                    <li key={k} className="flex items-center gap-1.5">
                      {v === true ? (
                        <CheckCircle2 className="size-3 text-emerald-400 shrink-0" />
                      ) : v === false ? (
                        <XCircle className="size-3 text-red-400 shrink-0" />
                      ) : (
                        <span className="size-3 rounded-full border border-slate-600 shrink-0" />
                      )}
                      <code className="text-slate-300">{k}</code>
                    </li>
                  ))}
                </ul>
                {(registrationProbe.errors ?? []).length > 0 && (
                  <ul className="pt-1 space-y-0.5 text-red-300">
                    {registrationProbe.errors?.map((e, i) => (
                      <li key={i}>• {e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Alert>
        )}

        {/* API Credentials */}
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardHeader>
            <CardTitle className="text-white">Credenciais da API</CardTitle>
            <CardDescription className="text-slate-400">
              Preencha as credenciais da API do WhatsApp Business da Meta.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Phone Number ID</Label>
              <Input
                placeholder="ex: 100234567890123"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                autoComplete="off"
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">WhatsApp Business Account ID</Label>
              <Input
                placeholder="ex: 100234567890456"
                value={wabaId}
                onChange={(e) => setWabaId(e.target.value)}
                autoComplete="off"
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Access Token permanente</Label>
              <div className="relative">
                <Input
                  type={showToken ? 'text' : 'password'}
                  placeholder="Cole aqui seu access token"
                  value={accessToken}
                  onChange={(e) => {
                    setAccessToken(e.target.value);
                    setTokenEdited(true);
                  }}
                  onFocus={() => {
                    if (accessToken === MASKED_TOKEN) {
                      setAccessToken('');
                      setTokenEdited(true);
                    }
                  }}
                  // `off` alone is unreliable for password-type
                  // fields in Chrome — it still offered to fill the
                  // account's own login password here. `new-password`
                  // is the value Chrome actually honors to mean
                  // "this isn't a login field."
                  autoComplete="new-password"
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                >
                  {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {config && !tokenEdited && (
                <p className="text-xs text-slate-500">
                  O token fica oculto por segurança. Preencha-o de novo pra atualizar a configuração.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Webhook Verify Token</Label>
              <Input
                placeholder="Crie um verify token personalizado"
                value={verifyToken}
                onChange={(e) => setVerifyToken(e.target.value)}
                autoComplete="off"
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
              <p className="text-xs text-slate-500">
                Uma palavra-chave que você mesmo cria. Precisa ser exatamente igual ao token que você colocar nas configurações de webhook lá na Meta.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">
                PIN de verificação em duas etapas
                <span className="ml-1 text-slate-500">(opcional)</span>
              </Label>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="PIN de 6 dígitos do Gerenciador de WhatsApp da Meta"
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                autoComplete="off"
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 tracking-widest"
              />
              <p className="text-xs text-slate-500 leading-relaxed">
                Necessário só pra ativar mensagens{' '}
                <strong className="text-slate-300">recebidas</strong> num
                número de <strong className="text-slate-300">produção</strong>. Configure em{' '}
                <strong className="text-slate-300">
                  Meta Business Manager → Contas do WhatsApp → Números de
                  telefone → Verificação em duas etapas
                </strong>
                , depois cole aqui pra o Deileads conseguir assinar o
                número — senão a Meta manda os eventos recebidos pro
                último app que reivindicou aquele número (é o que
                acontece com o segundo número dentro de uma mesma
                WABA).{' '}
                <strong className="text-slate-300">Números de teste da Meta</strong> não
                têm PIN e já vêm pré-registrados — deixe em branco pra
                eles. Deixar em branco também preserva um registro já
                existente, sem mexer nele.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Webhook URL */}
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardHeader>
            <CardTitle className="text-white">Configuração do Webhook</CardTitle>
            <CardDescription className="text-slate-400">
              Use essa URL como callback de webhook no painel do seu app na Meta.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label className="text-slate-300">URL de callback do webhook</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={webhookUrl}
                  className="bg-slate-800 border-slate-700 text-slate-300 font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopyWebhookUrl}
                  className="shrink-0 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Salvando...
              </>
            ) : (
              'Salvar Configuração'
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testing || !config}
            className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
          >
            {testing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Testando...
              </>
            ) : (
              <>
                <Zap className="size-4" />
                Testar Conexão com a API
              </>
            )}
          </Button>
          {config && (
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={resetting}
              className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
            >
              {resetting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Redefinindo...
                </>
              ) : (
                <>
                  <RotateCcw className="size-4" />
                  Redefinir Configuração
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Setup Instructions Sidebar */}
      <div>
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardHeader>
            <CardTitle className="text-white text-base">Instruções de configuração</CardTitle>
            <CardDescription className="text-slate-400">
              Siga esses passos pra conectar sua API do WhatsApp Business.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion>
              <AccordionItem className="border-slate-700">
                <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                    Crie um app na Meta
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-slate-400">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Acesse <span className="text-primary">developers.facebook.com</span></li>
                    <li>Clique em &quot;Meus Apps&quot; e depois em &quot;Criar App&quot;</li>
                    <li>Selecione &quot;Empresa&quot; como tipo de app</li>
                    <li>Preencha os dados do app e crie</li>
                  </ol>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="border-slate-700">
                <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                    Adicione o produto WhatsApp
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-slate-400">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>No painel do seu app, clique em &quot;Adicionar Produto&quot;</li>
                    <li>Encontre &quot;WhatsApp&quot; e clique em &quot;Configurar&quot;</li>
                    <li>Siga o assistente pra vincular sua empresa</li>
                  </ol>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="border-slate-700">
                <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                    Pegue as credenciais da API
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-slate-400">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Vá em WhatsApp &gt; Configuração da API</li>
                    <li>Copie o seu <strong className="text-slate-200">Phone Number ID</strong></li>
                    <li>Copie o seu <strong className="text-slate-200">WhatsApp Business Account ID</strong></li>
                    <li>Gere um <strong className="text-slate-200">Access Token permanente</strong> em Configurações da Empresa &gt; Usuários do Sistema</li>
                  </ol>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="border-slate-700">
                <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">4</span>
                    Configure os webhooks
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-slate-400">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Vá em WhatsApp &gt; Configuração</li>
                    <li>Clique em &quot;Editar&quot; na seção de Webhook</li>
                    <li>Cole a <strong className="text-slate-200">URL de callback do webhook</strong> de cima</li>
                    <li>Preencha o mesmo <strong className="text-slate-200">Verify Token</strong> que você definiu aqui</li>
                    <li>Assine o campo de webhook &quot;messages&quot;</li>
                  </ol>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div className="mt-4 pt-4 border-t border-slate-700">
              <a
                href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
              >
                <ExternalLink className="size-3.5" />
                Documentação da API do WhatsApp da Meta
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
