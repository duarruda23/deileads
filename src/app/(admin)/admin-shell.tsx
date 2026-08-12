"use client";

// Auth-gated admin shell. Deliberately NOT reusing hooks/use-auth.tsx's
// AuthProvider — that hook's fetchProfile does an `!inner` join that
// assumes an account-scoped profile and has no notion of
// `platform_role` at all. Extending it to serve both the account app
// and the platform admin area would couple two things that should
// stay independent (see arquitetura-tecnica.md's rationale for
// keeping src/lib/auth/platform.ts separate from account.ts — this is
// the client-side mirror of that same decision). A small self-
// contained check here is simpler than threading a "scope" concept
// through the shared hook.
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

type Status = "checking" | "denied" | "ok";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let mounted = true;
    const supabase = createClient();

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("platform_role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!mounted) return;
      if (data?.platform_role === "super_admin") {
        setStatus("ok");
      } else {
        // Authenticated, but not a Super Admin — send them to the app
        // they actually have access to, not back to /login (they ARE
        // logged in, just not into this area).
        router.push("/dashboard");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  if (status === "checking" || status === "denied") {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-slate-400">Checking access...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold text-white">
            CRM Virgo — Admin
          </span>
          <nav className="flex gap-4 text-sm">
            <Link
              href="/admin/accounts"
              className={
                pathname?.startsWith("/admin/accounts")
                  ? "text-primary"
                  : "text-slate-400 hover:text-white"
              }
            >
              Contas-cliente
            </Link>
            <Link
              href="/admin/platform-users"
              className={
                pathname?.startsWith("/admin/platform-users")
                  ? "text-primary"
                  : "text-slate-400 hover:text-white"
              }
            >
              Vendedores Virgo
            </Link>
          </nav>
        </div>
        <Button
          variant="ghost"
          className="text-slate-400 hover:text-white"
          onClick={async () => {
            const supabase = createClient();
            await supabase.auth.signOut();
            window.location.href = "/login";
          }}
        >
          Sair
        </Button>
      </header>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
