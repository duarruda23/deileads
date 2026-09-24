'use client';

// ============================================================
// WhatsAppEmbeddedSignup — "Conectar com a Meta" button.
//
// Launches Meta's Embedded Signup with the WhatsApp Business app
// onboarding feature (coexistence): the customer keeps using the
// WhatsApp Business app on their phone AND the number is connected to
// Deileads through the Cloud API. No Phone Number ID / token / PIN to
// copy by hand.
//
// Two async results have to be joined before calling the backend:
//   * FB.login's callback → `code` (exchangeable for a token, ~30s TTL)
//   * a `message` event from facebook.com (type WA_EMBEDDED_SIGNUP)
//     → phone_number_id, waba_id and which flow finished
// They can arrive in either order, so both land in refs and whichever
// arrives second triggers the POST.
//
// Needs NEXT_PUBLIC_META_APP_ID + NEXT_PUBLIC_META_ES_CONFIG_ID (the
// Facebook Login for Business configuration id). Without them the
// button renders disabled with an explanation instead.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const CONFIG_ID = process.env.NEXT_PUBLIC_META_ES_CONFIG_ID;
const GRAPH_VERSION = 'v21.0';
const SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';

interface FbLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}

interface FacebookSdk {
  init(opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(cb: (r: FbLoginResponse) => void, opts: Record<string, unknown>): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

type SessionEvent =
  | { event: 'FINISH' | 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'; phone_number_id: string; waba_id: string }
  | { event: 'CANCEL'; current_step?: string }
  | { event: 'ERROR'; error_message?: string };

let sdkPromise: Promise<FacebookSdk> | null = null;

function loadFacebookSdk(appId: string): Promise<FacebookSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.FB) {
      resolve(window.FB);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION });
      resolve(window.FB!);
    };
    const script = document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('Não foi possível carregar o SDK do Facebook (bloqueador de anúncios?).'));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

interface Props {
  /** auth.users.id of the vendor this number belongs to (admin+ may
   *  connect a teammate's number — the API enforces who can). */
  targetUserId?: string | null;
  onConnected?: () => void;
}

export function WhatsAppEmbeddedSignup({ targetUserId, onConnected }: Props) {
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<string | null>(null);
  const sessionRef = useRef<Extract<SessionEvent, { phone_number_id: string }> | null>(null);
  const submittedRef = useRef(false);

  const configured = Boolean(APP_ID && CONFIG_ID);

  const reset = useCallback(() => {
    codeRef.current = null;
    sessionRef.current = null;
    submittedRef.current = false;
    setBusy(false);
  }, []);

  const finish = useCallback(async () => {
    const code = codeRef.current;
    const session = sessionRef.current;
    if (!code || !session || submittedRef.current) return;
    submittedRef.current = true;
    try {
      const res = await fetch('/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          phone_number_id: session.phone_number_id,
          waba_id: session.waba_id,
          event: session.event,
          user_id: targetUserId ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Falha ao concluir a conexão com a Meta');
        return;
      }
      const name = data.phone_info?.verified_name;
      if (data.coexistence) {
        toast.success(
          `${name ? `${name} conectado` : 'WhatsApp conectado'} sem sair do app WhatsApp Business.` +
            (data.sync?.error
              ? ' A importação de contatos/histórico falhou — veja o status abaixo.'
              : ' Contatos e histórico estão sendo importados.'),
          { duration: 10000 },
        );
      } else {
        toast.success(
          'Número conectado. Falta registrar com o PIN de 6 dígitos — veja o status de registro abaixo.',
          { duration: 10000 },
        );
      }
      onConnected?.();
    } catch (err) {
      console.error('embedded-signup finish failed:', err);
      toast.error('Falha ao concluir a conexão com a Meta');
    } finally {
      reset();
    }
  }, [onConnected, reset, targetUserId]);

  useEffect(() => {
    if (!configured) return;
    function onMessage(event: MessageEvent) {
      if (!event.origin.endsWith('facebook.com')) return;
      let payload: { type?: string; data?: SessionEvent } | null = null;
      try {
        payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return; // SDK chatter that isn't JSON
      }
      if (payload?.type !== 'WA_EMBEDDED_SIGNUP' || !payload.data) return;
      const data = payload.data;
      if (data.event === 'CANCEL') {
        toast.message('Conexão cancelada antes de terminar.');
        reset();
        return;
      }
      if (data.event === 'ERROR') {
        toast.error(data.error_message || 'A Meta retornou um erro no fluxo de conexão.');
        reset();
        return;
      }
      if (data.event === 'FINISH' || data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
        sessionRef.current = data;
        void finish();
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [configured, finish, reset]);

  async function handleClick() {
    if (!APP_ID || !CONFIG_ID) return;
    reset();
    setBusy(true);
    let FB: FacebookSdk;
    try {
      FB = await loadFacebookSdk(APP_ID);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao carregar o SDK do Facebook');
      setBusy(false);
      return;
    }
    FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          // Closed the popup, or the flow ended without authorizing.
          // A CANCEL message event usually arrives too; either way the
          // button must not stay stuck on the spinner.
          if (!sessionRef.current) setBusy(false);
          return;
        }
        codeRef.current = code;
        void finish();
      },
      {
        config_id: CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
        },
      },
    );
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-3">
      <div>
        <p className="text-white font-medium">Conectar o WhatsApp Business do celular</p>
        <p className="text-sm text-slate-400">
          Mantém o número funcionando no app WhatsApp Business e liga ele ao Deileads
          (coexistência). No pop-up da Meta, escolha conectar o app existente e leia o
          QR code no celular. Não precisa copiar ID, token nem PIN.
        </p>
      </div>
      <Button
        onClick={handleClick}
        disabled={!configured || busy}
        className="bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
        {busy ? 'Aguardando a Meta...' : 'Conectar com a Meta'}
      </Button>
      {!configured && (
        <p className="text-xs text-amber-300/80">
          Indisponível: faltam NEXT_PUBLIC_META_APP_ID e NEXT_PUBLIC_META_ES_CONFIG_ID no
          ambiente. Enquanto isso, use a configuração manual abaixo.
        </p>
      )}
    </div>
  );
}
