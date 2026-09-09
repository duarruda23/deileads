'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  dedupeByPhone,
  isUniqueViolation,
  normalizeKey,
} from '@/lib/contacts/dedupe';
import { CURRENCIES } from '@/lib/currency';
import { dispatchDealStageEvent } from '@/lib/automations/dispatch-client';
import type { Pipeline, PipelineStage } from '@/types';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Upload, FileText, Loader2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

// One CSV column maps to exactly one of these, or 'skip'. 'phone' is
// the only required one — everything else (including whether deals
// or tags get created at all) is optional per-import, decided by
// which column the user maps and the batch options below.
type FieldKey = 'phone' | 'name' | 'email' | 'company' | 'tags' | 'value' | 'skip';

const FIELD_LABELS: Record<FieldKey, string> = {
  phone: 'Phone (required)',
  name: 'Name',
  email: 'Email',
  company: 'Company',
  tags: 'Tags',
  value: 'Deal Value',
  skip: "Don't import",
};

interface CsvData {
  headers: string[];
  rows: string[][];
}

interface ParsedRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  tags?: string;
  value?: string;
}

// Column-agnostic parse: no assumption about header names or order —
// that's resolved afterward by the user's own mapping (see FieldKey
// above), which is what makes this importer work with any export
// (Kommo, another CRM, a hand-built spreadsheet), not just files that
// already happen to use our exact column names.
function parseCSV(text: string): CsvData {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };

  function splitLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values.map((v) => v.replace(/^"|"$/g, '').trim());
  }

  const headers = splitLine(lines[0]);
  const rows = lines
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(splitLine);

  return { headers, rows };
}

function buildParsedRows(csv: CsvData, mapping: FieldKey[]): ParsedRow[] {
  const phoneCol = mapping.indexOf('phone');
  if (phoneCol === -1) return [];

  const colFor = (key: FieldKey) => mapping.indexOf(key);
  const nameCol = colFor('name');
  const emailCol = colFor('email');
  const companyCol = colFor('company');
  const tagsCol = colFor('tags');
  const valueCol = colFor('value');

  const rows: ParsedRow[] = [];
  for (const cells of csv.rows) {
    const phone = cells[phoneCol]?.trim();
    if (!phone) continue;
    rows.push({
      phone,
      name: nameCol >= 0 ? cells[nameCol]?.trim() || undefined : undefined,
      email: emailCol >= 0 ? cells[emailCol]?.trim() || undefined : undefined,
      company: companyCol >= 0 ? cells[companyCol]?.trim() || undefined : undefined,
      tags: tagsCol >= 0 ? cells[tagsCol]?.trim() || undefined : undefined,
      value: valueCol >= 0 ? cells[valueCol]?.trim() || undefined : undefined,
    });
  }
  return rows;
}

export function ImportModal({ open, onOpenChange, onImported }: ImportModalProps) {
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<CsvData | null>(null);
  const [mapping, setMapping] = useState<FieldKey[]>([]);

  const [createDeals, setCreateDeals] = useState(false);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [stageId, setStageId] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [loadingPipeline, setLoadingPipeline] = useState(false);

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    failed: number;
  } | null>(null);

  function reset() {
    setFile(null);
    setCsvData(null);
    setMapping([]);
    setCreateDeals(false);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(open: boolean) {
    if (!open) reset();
    onOpenChange(open);
  }

  // Best-effort auto-map by header name so a CSV that already uses
  // our field names (or Portuguese equivalents) doesn't force the
  // user to map every column by hand.
  function guessField(header: string): FieldKey {
    const h = header.toLowerCase();
    if (/phone|telefone|celular|whatsapp/.test(h)) return 'phone';
    if (/^name$|nome/.test(h)) return 'name';
    if (/email|e-mail/.test(h)) return 'email';
    if (/company|empresa/.test(h)) return 'company';
    if (/tag/.test(h)) return 'tags';
    if (/value|valor|price|preço|preco|sale/.test(h)) return 'value';
    return 'skip';
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setResult(null);

    const text = await selected.text();
    const parsed = parseCSV(text);

    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      toast.error('No rows found in this file.');
      setCsvData(null);
      setMapping([]);
      return;
    }

    setCsvData(parsed);
    setMapping(parsed.headers.map(guessField));
  }

  // Load every pipeline the account has once "also create a deal" is
  // turned on, defaulting the selection to the account's default
  // pipeline (same one submit_site_lead/submit_hotmart_lead — 027/033
  // — use), but letting the user pick a different one (e.g. a
  // vendor's personal pipeline) instead of always landing in the
  // default. Previously this only ever loaded the default pipeline
  // with no way to import straight into someone's own funnel.
  useEffect(() => {
    if (!createDeals || !accountId || pipelines.length > 0) return;
    let cancelled = false;
    setLoadingPipeline(true);
    (async () => {
      const { data: pipelineRows } = await supabase
        .from('pipelines')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at');
      if (cancelled) return;
      if (!pipelineRows || pipelineRows.length === 0) {
        toast.error('This account has no pipelines configured yet.');
        setCreateDeals(false);
        setLoadingPipeline(false);
        return;
      }
      setPipelines(pipelineRows as Pipeline[]);
      const defaultPipeline =
        (pipelineRows as (Pipeline & { is_default?: boolean })[]).find((p) => p.is_default) ??
        pipelineRows[0];
      setPipelineId(defaultPipeline.id);
      setLoadingPipeline(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [createDeals, accountId, pipelines.length, supabase]);

  // Reload stages whenever the selected pipeline changes.
  useEffect(() => {
    if (!pipelineId) return;
    let cancelled = false;
    (async () => {
      const { data: stageRows } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', pipelineId)
        .order('position');
      if (cancelled) return;
      setStages((stageRows ?? []) as PipelineStage[]);
      setStageId((stageRows ?? [])[0]?.id ?? '');
    })();
    return () => {
      cancelled = true;
    };
  }, [pipelineId, supabase]);

  const parsedRows = useMemo(
    () => (csvData ? buildParsedRows(csvData, mapping) : []),
    [csvData, mapping],
  );
  const hasPhoneMapped = mapping.includes('phone');
  const hasTagsMapped = mapping.includes('tags');

  async function resolveTagIds(names: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>(); // lowercase name -> tag id
    if (names.length === 0 || !accountId) return map;

    const { data: existing } = await supabase
      .from('tags')
      .select('id, name')
      .eq('account_id', accountId);
    for (const t of (existing ?? []) as { id: string; name: string }[]) {
      map.set(t.name.toLowerCase(), t.id);
    }

    const missing = names.filter((n) => !map.has(n.toLowerCase()));
    if (missing.length > 0) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user.id;
      const { data: created, error } = await supabase
        .from('tags')
        .insert(missing.map((name) => ({ account_id: accountId, user_id: userId, name })))
        .select('id, name');
      // Blocked by RLS (importer isn't admin+) or a race with another
      // creator — either way, rows referencing these names just won't
      // get tagged; the rest of the import still proceeds.
      if (!error) {
        for (const t of (created ?? []) as { id: string; name: string }[]) {
          map.set(t.name.toLowerCase(), t.id);
        }
      }
    }

    return map;
  }

  async function handleImport() {
    if (parsedRows.length === 0) return;
    setImporting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');
      if (!accountId) throw new Error('Your profile is not linked to an account.');
      if (createDeals && !stageId) throw new Error('Pick a stage for the imported deals.');

      let imported = 0;
      let skipped = 0;
      let failed = 0;

      // Resolve every tag name referenced anywhere in the file once,
      // up front, instead of find-or-creating per row (avoids racing
      // duplicate-tag inserts within the same import run).
      const allTagNames = hasTagsMapped
        ? Array.from(
            new Set(
              parsedRows
                .flatMap((r) => r.tags?.split(/[,;]/) ?? [])
                .map((t) => t.trim())
                .filter(Boolean),
            ),
          )
        : [];
      const tagIdByName = await resolveTagIds(allTagNames);

      const { unique, duplicates: inFileDupes } = dedupeByPhone(parsedRows);
      skipped += inFileDupes;

      const { data: existingRows } = await supabase
        .from('contacts')
        .select('phone_normalized')
        .eq('account_id', accountId);
      const existingPhones = new Set(
        (existingRows ?? [])
          .map((r) => (r as { phone_normalized: string | null }).phone_normalized)
          .filter((p): p is string => !!p),
      );

      const toInsert = unique.filter((row) => {
        if (existingPhones.has(normalizeKey(row.phone))) {
          skipped++;
          return false;
        }
        return true;
      });

      // One row at a time from here — each row can fan out into a
      // contact + a deal + tag assignments, which doesn't fit the
      // flat chunked-insert used by the contacts-only path below.
      for (const row of toInsert) {
        const { data: contact, error: contactErr } = await supabase
          .from('contacts')
          .insert({
            user_id: user.id,
            account_id: accountId,
            phone: row.phone,
            name: row.name || null,
            email: row.email || null,
            company: row.company || null,
          })
          .select('id')
          .single();

        if (contactErr || !contact) {
          if (isUniqueViolation(contactErr)) skipped++;
          else failed++;
          continue;
        }
        imported++;

        if (createDeals && pipelineId) {
          const { data: dealRow } = await supabase
            .from('deals')
            .insert({
              user_id: user.id,
              account_id: accountId,
              pipeline_id: pipelineId,
              stage_id: stageId,
              contact_id: contact.id,
              title: row.name || row.phone,
              value: parseFloat(row.value ?? '') || 0,
              currency,
              source: 'import',
            })
            .select('id')
            .single();
          if (dealRow) {
            void dispatchDealStageEvent({
              contactId: contact.id,
              dealId: dealRow.id,
              pipelineId,
              stageId,
              event: 'created',
            });
          }
        }

        const rowTagIds = (row.tags ?? '')
          .split(/[,;]/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
          .map((t) => tagIdByName.get(t))
          .filter((id): id is string => !!id);
        if (rowTagIds.length > 0) {
          await supabase
            .from('contact_tags')
            .insert(rowTagIds.map((tag_id) => ({ contact_id: contact.id, tag_id })));
        }
      }

      setResult({ imported, skipped, failed });
      if (imported > 0) {
        toast.success(`${imported} contact${imported !== 1 ? 's' : ''} imported`);
        onImported();
      }
      if (skipped > 0) {
        toast.info(`${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped`);
      }
      if (failed > 0) {
        toast.error(`${failed} contact${failed !== 1 ? 's' : ''} failed to import`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Import failed';
      toast.error(message);
    } finally {
      setImporting(false);
    }
  }

  const preview = parsedRows.slice(0, 5);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Import Contacts</DialogTitle>
          <DialogDescription className="text-slate-400">
            Upload any CSV export (Kommo or another CRM works fine) — you&apos;ll map its
            columns to fields below. A phone column is required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload area */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-700 p-6 cursor-pointer hover:border-primary/50 transition-colors"
          >
            {file ? (
              <>
                <FileText className="size-8 text-primary" />
                <p className="text-sm text-slate-300">{file.name}</p>
                <p className="text-xs text-slate-500">
                  {csvData?.rows.length ?? 0} row{csvData?.rows.length !== 1 ? 's' : ''} detected
                </p>
              </>
            ) : (
              <>
                <Upload className="size-8 text-slate-500" />
                <p className="text-sm text-slate-400">Click to upload CSV file</p>
                <p className="text-xs text-slate-500">Any column headers — you&apos;ll map them next</p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Column mapping */}
          {csvData && !result && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Map columns
              </p>
              <div className="rounded-lg border border-slate-700 divide-y divide-slate-700/50">
                {csvData.headers.map((header, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="truncate text-sm text-slate-300" title={header}>
                      {header || `Column ${i + 1}`}
                    </span>
                    <select
                      value={mapping[i] ?? 'skip'}
                      onChange={(e) => {
                        const next = [...mapping];
                        next[i] = e.target.value as FieldKey;
                        setMapping(next);
                      }}
                      className="h-8 shrink-0 rounded-md border border-slate-700 bg-slate-800 px-2 text-xs text-white outline-none focus:border-primary"
                    >
                      {(Object.keys(FIELD_LABELS) as FieldKey[]).map((key) => (
                        <option key={key} value={key}>
                          {FIELD_LABELS[key]}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {!hasPhoneMapped && (
                <p className="text-xs text-amber-400">Map one column to Phone to continue.</p>
              )}
            </div>
          )}

          {/* Deal creation options */}
          {csvData && hasPhoneMapped && !result && (
            <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={createDeals}
                  onChange={(e) => setCreateDeals(e.target.checked)}
                  className="size-4 rounded border-slate-600 bg-slate-800 accent-primary"
                />
                Also create a deal for each imported contact
              </label>

              {createDeals && (
                <div className="grid grid-cols-2 gap-3 pl-6">
                  <div className="grid gap-1.5">
                    <Label className="text-xs text-slate-400">Pipeline</Label>
                    {loadingPipeline ? (
                      <p className="text-xs text-slate-500">Loading pipelines...</p>
                    ) : (
                      <select
                        value={pipelineId ?? ''}
                        onChange={(e) => setPipelineId(e.target.value)}
                        className="h-8 rounded-md border border-slate-700 bg-slate-800 px-2 text-xs text-white outline-none focus:border-primary"
                      >
                        {pipelines.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs text-slate-400">Stage</Label>
                    {loadingPipeline ? (
                      <p className="text-xs text-slate-500">Loading...</p>
                    ) : (
                      <select
                        value={stageId}
                        onChange={(e) => setStageId(e.target.value)}
                        className="h-8 rounded-md border border-slate-700 bg-slate-800 px-2 text-xs text-white outline-none focus:border-primary"
                      >
                        {stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs text-slate-400">Currency</Label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="h-8 rounded-md border border-slate-700 bg-slate-800 px-2 text-xs text-white outline-none focus:border-primary"
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="col-span-2 text-xs text-slate-500">
                    Every imported deal lands in this one pipeline and stage. Importing leads that
                    belong in different pipelines or stages? Filter your export and run the
                    import again per pipeline/stage.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Preview table */}
          {preview.length > 0 && !result && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Preview (first {preview.length} of {parsedRows.length} rows)
              </p>
              <div className="overflow-x-auto rounded-lg border border-slate-700">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800">
                      <th className="px-3 py-1.5 text-left text-slate-400 font-medium">Phone</th>
                      <th className="px-3 py-1.5 text-left text-slate-400 font-medium">Name</th>
                      <th className="px-3 py-1.5 text-left text-slate-400 font-medium">Email</th>
                      {hasTagsMapped && (
                        <th className="px-3 py-1.5 text-left text-slate-400 font-medium">Tags</th>
                      )}
                      {createDeals && (
                        <th className="px-3 py-1.5 text-left text-slate-400 font-medium">Value</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t border-slate-700/50">
                        <td className="px-3 py-1.5 text-slate-300">{row.phone}</td>
                        <td className="px-3 py-1.5 text-slate-300">{row.name || '-'}</td>
                        <td className="px-3 py-1.5 text-slate-300">{row.email || '-'}</td>
                        {hasTagsMapped && (
                          <td className="px-3 py-1.5 text-slate-300">{row.tags || '-'}</td>
                        )}
                        {createDeals && (
                          <td className="px-3 py-1.5 text-slate-300">{row.value || '0'}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="rounded-lg border border-slate-700 p-4 space-y-2">
              <p className="text-sm font-medium text-white">Import Complete</p>
              <div className="flex flex-wrap items-center gap-4">
                {result.imported > 0 && (
                  <div className="flex items-center gap-1.5 text-primary text-sm">
                    <CheckCircle className="size-4" />
                    {result.imported} imported
                  </div>
                )}
                {result.skipped > 0 && (
                  <div className="flex items-center gap-1.5 text-amber-400 text-sm">
                    <AlertTriangle className="size-4" />
                    {result.skipped} duplicate{result.skipped !== 1 ? 's' : ''} skipped
                  </div>
                )}
                {result.failed > 0 && (
                  <div className="flex items-center gap-1.5 text-red-400 text-sm">
                    <XCircle className="size-4" />
                    {result.failed} failed
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="bg-slate-900 border-slate-700">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button
              type="button"
              disabled={!hasPhoneMapped || parsedRows.length === 0 || importing}
              onClick={handleImport}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              Import {parsedRows.length > 0 ? `${parsedRows.length} Contacts` : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
