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
        throw new Error(payload.message || 'Failed to load configuration');
      setConnected(payload.connected);
      setPageId(payload.config?.page_id || '');
      setInstagramAccountId(payload.config?.ig_business_account_id || '');
      setUsername(payload.account?.username || payload.account?.name || '');
      setErrorMessage(payload.connected ? '' : payload.message || '');
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Failed to load Instagram configuration'
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
        'Instagram Account ID, Access Token, and Verify Token are required'
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
        toast.error(payload.error || 'Failed to save Instagram configuration');
        return;
      }
      if (payload.subscription_error) {
        setErrorMessage(payload.subscription_error);
        toast.warning('Credentials saved, but webhook subscription failed');
      } else {
        toast.success('Instagram connected and subscribed');
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
      toast.error('Failed to disconnect Instagram');
      return;
    }
    setConnected(false);
    setUsername('');
    setPageId('');
    setInstagramAccountId('');
    toast.success('Instagram disconnected');
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
          <AlertTitle>Instagram connected</AlertTitle>
          <AlertDescription>
            {username ? `@${username}` : instagramAccountId} is ready to receive
            DMs.
          </AlertDescription>
        </Alert>
      )}
      {errorMessage && (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
          <AlertTitle>Connection needs attention</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <Card className="border-slate-700 bg-slate-900 ring-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Camera className="size-5" /> Instagram Messaging API
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Instagram Professional Account ID"
            value={instagramAccountId}
            onChange={setInstagramAccountId}
            placeholder="1784…"
          />
          <Field
            label="Facebook Page ID (optional for Instagram Login)"
            value={pageId}
            onChange={setPageId}
            placeholder="Page-backed integrations only"
          />
          <Field
            label="Access Token"
            value={accessToken}
            onChange={setAccessToken}
            secret={!showSecrets}
            placeholder={
              connected
                ? 'Re-enter to update configuration'
                : 'Meta access token'
            }
          />
          <Field
            label="Webhook Verify Token"
            value={verifyToken}
            onChange={setVerifyToken}
            secret={!showSecrets}
            placeholder="A private value you choose"
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
            {showSecrets ? 'Hide secrets' : 'Show secrets'}
          </button>
          <div className="space-y-2">
            <Label className="text-slate-300">Webhook callback URL</Label>
            <Input
              readOnly
              value={webhookUrl}
              className="border-slate-700 bg-slate-800 font-mono text-xs text-white"
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={save}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving && <Loader2 className="size-4 animate-spin" />} Save and
              subscribe
            </Button>
            {connected && (
              <Button
                variant="outline"
                onClick={disconnect}
                className="border-red-500/40 text-red-300 hover:bg-red-500/10"
              >
                <Trash2 className="size-4" /> Disconnect
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  secret?: boolean;
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
    </div>
  );
}
