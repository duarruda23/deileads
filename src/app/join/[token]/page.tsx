'use client';

// ============================================================
// /join/[token] — invitation redemption landing page.
//
// Four UI states driven by:
//   - the peek result (server-validated invite payload), and
//   - whether the visitor is currently authenticated.
//
//   ┌──────────────────────┬───────────────┬─────────────────────────┐
//   │ peek                 │ auth          │ render                   │
//   ├──────────────────────┼───────────────┼─────────────────────────┤
//   │ loading              │ —             │ spinner                  │
//   │ ok:false (any reason)│ —             │ friendly error + signup  │
//   │ ok:true              │ signed out    │ inline signup form       │
//   │ ok:true              │ signed in     │ "Accept" button → redeem │
//   └──────────────────────┴───────────────┴─────────────────────────┘
//
// The signed-out case fills in name/email/password ON THIS PAGE and
// posts to /api/invitations/[token]/redeem, which creates the
// account pre-confirmed and signs them in server-side — no
// confirmation email involved (this project's Supabase mailer isn't
// configured, so the old /signup-then-verify-then-return-here path
// silently stranded every invitee). See invite-signup.ts.
//
// We deliberately do NOT redeem automatically for an already-signed-
// in visitor — the invitee should confirm what account/role they're
// accepting first.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  MailX,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';

// `kind` distinguishes which invitation table this token belongs
// to. Absent/'account' = the original account_invitations flow
// (join an existing account with a role). 'new_account' /
// 'virgo_seller' come from platform_invitations (032) — Super Admin
// onboarding a Cliente Admin or a Virgo salesperson. All three
// redeem through the same POST below; only the copy differs.
interface PeekOk {
  ok: true;
  kind?: 'account' | 'new_account' | 'virgo_seller';
  account_name: string | null;
  role?: 'admin' | 'agent' | 'viewer';
  expires_at: string;
}
interface PeekFail {
  ok: false;
  reason: 'not_found' | 'used' | 'expired' | 'server_error';
}
type PeekResult = PeekOk | PeekFail;

const ROLE_LABEL: Record<'admin' | 'agent' | 'viewer', string> = {
  admin: 'Admin',
  agent: 'Agent',
  viewer: 'Viewer',
};

const FAIL_COPY: Record<PeekFail['reason'], { title: string; body: string }> = {
  not_found: {
    title: 'Invite not found',
    body: 'This link doesn’t match a valid invitation. Double-check the URL or ask the person who invited you to send a new one.',
  },
  used: {
    title: 'Invite already used',
    body: 'This invitation has already been accepted. If that wasn’t you, ask the account admin to send a fresh link.',
  },
  expired: {
    title: 'Invite expired',
    body: 'This invitation has expired. Ask the account admin to send a new one — they take a few seconds to generate.',
  },
  server_error: {
    title: 'Something went wrong',
    body: 'We couldn’t verify this invitation right now. Try refreshing the page in a moment.',
  },
};

export default function JoinPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [peek, setPeek] = useState<PeekResult | null>(null);
  // Local auth probe — the AuthProvider lives inside the (dashboard)
  // route group, so it doesn't reach this page. We hit Supabase
  // directly the same way `/login` and `/signup` do.
  const [authedUserId, setAuthedUserId] = useState<string | null | undefined>(
    undefined, // undefined = unknown / still loading; null = signed out
  );
  const [accepting, setAccepting] = useState(false);
  // Inline signup fields — collected on THIS page instead of
  // detouring to /signup, which depends on Supabase's confirmation
  // email (not configured for this project, so that path never
  // completes). See /api/invitations/[token]/redeem.
  const [fullName, setFullName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [signupError, setSignupError] = useState<string | null>(null);
  // `redeem_invitation` returns 409 when the caller's current account
  // has domain data, or they're already a member of a shared account.
  // A transient toast wasn't enough — the user has no actionable next
  // step. Surface a blocking modal that walks them through it.
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Extracted so the "Try again" button on the server_error card
  // can re-run the same logic without remounting the component.
  const loadPeekAndAuth = useCallback(async () => {
    if (!token) return;
    setPeek(null);
    setAuthedUserId(undefined);
    try {
      const [peekRes, authRes] = await Promise.all([
        fetch(`/api/invitations/${encodeURIComponent(token)}/peek`, {
          cache: 'no-store',
        }),
        createClient().auth.getUser(),
      ]);
      const peekBody = (await peekRes.json()) as PeekResult;
      setPeek(peekBody);
      setAuthedUserId(authRes.data.user?.id ?? null);
    } catch (err) {
      console.error('[join] peek error:', err);
      setPeek({ ok: false, reason: 'server_error' });
      setAuthedUserId(null);
    }
  }, [token]);

  // Fetch peek + auth state on mount. The peek endpoint is
  // rate-limited per-IP (30/min) so double-mounting in React 19
  // strict mode dev is harmless. We also use the `cancelled` flag
  // to drop setState calls if the component unmounts mid-fetch.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const [peekRes, authRes] = await Promise.all([
          fetch(`/api/invitations/${encodeURIComponent(token)}/peek`, {
            cache: 'no-store',
          }),
          createClient().auth.getUser(),
        ]);
        const peekBody = (await peekRes.json()) as PeekResult;
        if (cancelled) return;
        setPeek(peekBody);
        setAuthedUserId(authRes.data.user?.id ?? null);
      } catch (err) {
        console.error('[join] peek error:', err);
        if (cancelled) return;
        setPeek({ ok: false, reason: 'server_error' });
        setAuthedUserId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleAccept = useCallback(async (signupBody?: {
    fullName: string;
    email: string;
    password: string;
  }) => {
    if (!token) return;
    setAccepting(true);
    try {
      const res = await fetch(
        `/api/invitations/${encodeURIComponent(token)}/redeem`,
        {
          method: 'POST',
          ...(signupBody
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(signupBody),
              }
            : {}),
        },
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        // 409 from the authenticated path = caller already has data
        // / is in another shared account — the modal gives them a
        // clear next-action (sign out → different email) instead of
        // a 3-second toast. 409 from the inline-signup path just
        // means that email is already registered; there's no
        // session to sign out of, so a toast pointing at "sign in
        // instead" is the right weight.
        if (res.status === 409 && !signupBody) {
          setConflictMessage(
            payload.error ||
              'You are already in another account. Sign in with a different email to join this one.',
          );
        } else {
          toast.error(payload.error || 'Failed to accept invitation');
        }
        setAccepting(false);
        return;
      }
      toast.success('Welcome to the team');
      // Full reload (not router.push) so AuthProvider re-fetches
      // the profile with the new account_id and account_role.
      window.location.href = '/dashboard';
    } catch (err) {
      console.error('[join] redeem error:', err);
      toast.error('Could not reach the server');
      setAccepting(false);
    }
  }, [token]);

  const handleSignupSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setSignupError(null);
      if (signupPassword !== signupConfirmPassword) {
        setSignupError('Passwords do not match');
        return;
      }
      if (signupPassword.length < 6) {
        setSignupError('Password must be at least 6 characters');
        return;
      }
      void handleAccept({
        fullName: fullName.trim(),
        email: signupEmail.trim(),
        password: signupPassword,
      });
    },
    [fullName, signupEmail, signupPassword, signupConfirmPassword, handleAccept],
  );

  const handleSignOutAndRetry = useCallback(async () => {
    setSigningOut(true);
    try {
      await createClient().auth.signOut();
      // Hard reload so the new auth state propagates everywhere
      // (middleware, AuthProvider). Preserves the invite token in
      // the URL so the rebuilt page renders the signed-out CTA path.
      window.location.reload();
    } catch (err) {
      console.error('[join] sign-out error:', err);
      toast.error('Could not sign out. Try refreshing the page.');
      setSigningOut(false);
    }
  }, []);

  // ----- Loading state (peek pending OR auth not yet resolved) -----
  if (peek === null || authedUserId === undefined) {
    return (
      <Card className="w-full max-w-md border-slate-800 bg-slate-900">
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm text-slate-400">Verifying invitation…</p>
        </CardContent>
      </Card>
    );
  }

  // ----- Peek failed -----
  if (!peek.ok) {
    const copy = FAIL_COPY[peek.reason];
    return (
      <Card className="w-full max-w-md border-slate-800 bg-slate-900">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10">
            <MailX className="h-6 w-6 text-red-400" />
          </div>
          <CardTitle className="text-xl text-white">{copy.title}</CardTitle>
          <CardDescription className="text-slate-400">
            {copy.body}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {/* For server_error the failure is transient — the network
              flapped or the peek endpoint hiccupped. Try-again is
              the right primary action; the "create account" /
              "sign in" links stay as secondary options. Other
              failure reasons (not_found / used / expired) are
              terminal for this token, so no retry — just the
              signup/sign-in escape hatches. */}
          {peek.reason === 'server_error' ? (
            <>
              <Button
                onClick={loadPeekAndAuth}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Try again
              </Button>
              <Link href="/signup">
                <Button
                  variant="outline"
                  className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  Create a new account instead
                </Button>
              </Link>
            </>
          ) : (
            <>
              <Link href="/signup">
                <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                  Create a new account instead
                </Button>
              </Link>
              <Link href="/login">
                <Button
                  variant="outline"
                  className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  Sign in
                </Button>
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  // ----- Peek OK -----
  const expiresLabel = new Date(peek.expires_at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const inviteHeader = (
    <CardHeader className="items-center text-center">
      <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <UsersRound className="h-6 w-6 text-primary" />
      </div>
      {peek.kind === 'new_account' ? (
        <>
          <CardTitle className="text-xl text-white">
            You&apos;re invited to create{' '}
            <span className="text-primary">{peek.account_name}</span>
          </CardTitle>
          <CardDescription className="text-slate-400">
            You&apos;ll be the{' '}
            <span className="inline-flex items-center gap-1 text-white">
              <ShieldCheck className="size-3.5 text-primary" />
              Admin
            </span>{' '}
            of this new account. Link valid until {expiresLabel}.
          </CardDescription>
        </>
      ) : peek.kind === 'virgo_seller' ? (
        <>
          <CardTitle className="text-xl text-white">
            You&apos;re invited to join the{' '}
            <span className="text-primary">Virgo</span> team
          </CardTitle>
          <CardDescription className="text-slate-400">
            You&apos;ll join Virgo&apos;s internal sales pipeline as{' '}
            <span className="inline-flex items-center gap-1 text-white">
              <ShieldCheck className="size-3.5 text-primary" />
              Agent
            </span>
            . Link valid until {expiresLabel}.
          </CardDescription>
        </>
      ) : (
        <>
          <CardTitle className="text-xl text-white">
            You&apos;re invited to{' '}
            <span className="text-primary">{peek.account_name}</span>
          </CardTitle>
          <CardDescription className="text-slate-400">
            You&apos;ll join as{' '}
            <span className="inline-flex items-center gap-1 text-white">
              <ShieldCheck className="size-3.5 text-primary" />
              {peek.role ? ROLE_LABEL[peek.role] : 'member'}
            </span>
            . Link valid until {expiresLabel}.
          </CardDescription>
        </>
      )}
    </CardHeader>
  );

  // ----- Authed: show Accept button -----
  if (authedUserId) {
    return (
      <>
        <Card className="w-full max-w-md border-slate-800 bg-slate-900">
          {inviteHeader}
          <CardContent className="flex flex-col gap-3">
            <Button
              onClick={() => handleAccept()}
              disabled={accepting}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {accepting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Accepting…
                </>
              ) : (
                <>
                  <CheckCircle className="size-4" />
                  Accept invitation
                </>
              )}
            </Button>
            <p className="text-center text-xs text-slate-500">
              Accepting moves your login into{' '}
              <span className="text-slate-400">
                {peek.account_name ?? 'Virgo (Interno)'}
              </span>
              . Your empty personal account from signup will be cleaned up.
            </p>
          </CardContent>
        </Card>

        {/* Conflict modal — opens when the redeem endpoint returns 409
            (caller already in a shared account or has domain data).
            Blocks the flow until the user picks a recovery action so
            they aren't stuck retrying an inevitable failure. */}
        <Dialog
          open={conflictMessage !== null}
          onOpenChange={(open) => {
            if (!open) setConflictMessage(null);
          }}
        >
          <DialogContent className="bg-slate-900 border-slate-700 sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-white">
                <AlertTriangle className="size-4 text-amber-400" />
                Can&apos;t join {peek.account_name ?? 'Virgo (Interno)'} with
                this account
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                {conflictMessage}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2 text-xs text-slate-500">
              <p>
                To join{' '}
                <span className="text-slate-300">
                  {peek.account_name ?? 'Virgo (Interno)'}
                </span>
                , sign out and sign up again with a different email address.
                The invite link stays valid as long as it hasn&apos;t
                expired.
              </p>
            </div>
            <DialogFooter className="bg-slate-900 border-slate-700">
              <Button
                variant="outline"
                onClick={() => setConflictMessage(null)}
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Stay signed in
              </Button>
              <Button
                onClick={handleSignOutAndRetry}
                disabled={signingOut}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {signingOut ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Signing out…
                  </>
                ) : (
                  'Sign out & use a different email'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // ----- Not authed: inline signup, right on this page -----
  //
  // Deliberately NOT a Link to /signup: that page's signUp() call
  // depends on Supabase emailing a confirmation link, which this
  // project's mailer never delivers (see invite-signup.ts). Instead
  // this form posts straight to /api/invitations/[token]/redeem,
  // which creates the account pre-confirmed and signs the user in
  // server-side in one round trip — no email involved.
  return (
    <Card className="w-full max-w-md border-slate-800 bg-slate-900">
      {inviteHeader}
      <CardContent>
        <form onSubmit={handleSignupSubmit} className="flex flex-col gap-4">
          {signupError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {signupError}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="fullName" className="text-slate-300">
              Full name
            </Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="signupEmail" className="text-slate-300">
              Email
            </Label>
            <Input
              id="signupEmail"
              type="email"
              value={signupEmail}
              onChange={(e) => setSignupEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="signupPassword" className="text-slate-300">
              Password
            </Label>
            <Input
              id="signupPassword"
              type="password"
              value={signupPassword}
              onChange={(e) => setSignupPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="signupConfirmPassword" className="text-slate-300">
              Confirm password
            </Label>
            <Input
              id="signupConfirmPassword"
              type="password"
              value={signupConfirmPassword}
              onChange={(e) => setSignupConfirmPassword(e.target.value)}
              required
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
            />
          </div>
          <Button
            type="submit"
            disabled={accepting}
            className="mt-2 w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {accepting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Creating account…
              </>
            ) : (
              'Create account & join'
            )}
          </Button>
        </form>
        <Link
          href={`/login?invite=${encodeURIComponent(token!)}`}
          className="mt-4 flex items-center justify-center text-sm text-slate-400 hover:text-slate-300"
        >
          I already have an account — sign in instead
        </Link>
      </CardContent>
    </Card>
  );
}
