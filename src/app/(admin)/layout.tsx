import type { Metadata } from "next";
import { AdminShell } from "./admin-shell";

// Mirrors (dashboard)/layout.tsx — server component so it can export
// noindex metadata; the actual Super-Admin check happens client-side
// in AdminShell (middleware only guarantees "authenticated", not
// "authenticated AND platform_role = super_admin").
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminShell>{children}</AdminShell>;
}
