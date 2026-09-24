import Link from 'next/link';
import type { ReactNode } from 'react';

// ============================================================
// Public legal pages (privacy policy, terms, data deletion).
//
// Linked from the Meta App Dashboard (App Review checks them) and
// meant to be readable without an account. Each page carries the
// Portuguese text first and an English version below (#en), since
// Meta's reviewers read English.
// ============================================================

export const LEGAL = {
  company: 'VIRGO MARKETING E VENDAS LTDA',
  cnpj: '37.684.000/0001-68',
  address:
    'Avenida Adjar da Silva Case, 800, Coworking Hub Plural, Sala 77, Indianópolis, Caruaru-PE, CEP 55024-740, Brasil',
  email: 'contato@deileads.com.br',
  updatedPt: '24 de setembro de 2026',
  updatedEn: 'September 24, 2026',
} as const;

const NAV = [
  { href: '/privacidade', label: 'Privacidade' },
  { href: '/termos', label: 'Termos de uso' },
  { href: '/exclusao-de-dados', label: 'Exclusão de dados' },
];

export function LegalPage({
  title,
  titleEn,
  children,
  english,
}: {
  title: string;
  titleEn: string;
  children: ReactNode;
  english: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white text-slate-800">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Link href="/login" className="text-lg font-semibold text-slate-900">
            Deileads
          </Link>
          <nav className="flex flex-wrap gap-4 text-sm text-slate-600">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-slate-900">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">
          Última atualização: {LEGAL.updatedPt} ·{' '}
          <a href="#en" className="underline">
            English version
          </a>
        </p>
        <div className="legal-body mt-8 space-y-4 leading-relaxed">{children}</div>

        <hr className="my-12 border-slate-200" />

        <section id="en" lang="en">
          <h2 className="text-2xl font-semibold text-slate-900">{titleEn}</h2>
          <p className="mt-2 text-sm text-slate-500">Last updated: {LEGAL.updatedEn}</p>
          <div className="legal-body mt-6 space-y-4 leading-relaxed">{english}</div>
        </section>
      </main>

      <footer className="border-t border-slate-200">
        <div className="mx-auto max-w-3xl px-4 py-6 text-xs text-slate-500">
          Deileads é um produto da {LEGAL.company}, CNPJ {LEGAL.cnpj}. {LEGAL.address}. Contato:{' '}
          <a href={`mailto:${LEGAL.email}`} className="underline">
            {LEGAL.email}
          </a>
        </div>
      </footer>
    </div>
  );
}

/** Section heading used inside legal pages. */
export function H({ children }: { children: ReactNode }) {
  return <h3 className="pt-4 text-lg font-semibold text-slate-900">{children}</h3>;
}

/** Bulleted list used inside legal pages. */
export function UL({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1 pl-6">{children}</ul>;
}

export function Mail() {
  return (
    <a href={`mailto:${LEGAL.email}`} className="underline">
      {LEGAL.email}
    </a>
  );
}
