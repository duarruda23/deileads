"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { dispatchDealStageEvent } from "@/lib/automations/dispatch-client";
import type { Pipeline, PipelineStage, Deal, Tag as TagRecord } from "@/types";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealForm } from "@/components/pipelines/deal-form";
import { PipelineAnalytics } from "@/components/pipelines/pipeline-analytics";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  GitBranch,
  Plus,
  ChevronDown,
  Settings,
  Users,
  Search,
  Filter,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { GatedButton } from "@/components/ui/gated-button";

const SOURCE_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  site_form: "Site Form",
  meta_leadgen: "Meta Lead Ads",
  hotmart: "Hotmart",
  manual: "Manual",
  import: "Imported",
};

// Pipeline creation is admin-class (settings-tier write under
// the new RLS); deal creation is operational and only requires
// agent+. The two CTAs gate on different `useCan` capabilities,
// not on different copy.

// Mirrors the seed used for a new account's default pipeline
// (admin_create_account RPC, migration 030) so every pipeline in the
// product — the one seeded at account creation and any created later
// from this dialog — shares the same stage names and stage_type.
// Previously this array was the wacrm template's English default and
// never set stage_type at all (silently defaulting to 'open'), which
// meant a pipeline created here could never mark a deal as won.
const SPEC_DEFAULT_STAGES = [
  { name: "Novo Lead", color: "#3b82f6", stage_type: "open", position: 0 }, // blue
  { name: "Em Contato", color: "#eab308", stage_type: "open", position: 1 }, // yellow
  { name: "Qualificado", color: "#f97316", stage_type: "open", position: 2 }, // orange
  { name: "Fechado Ganho", color: "#22c55e", stage_type: "won", position: 3 }, // green
  { name: "Fechado Perdido", color: "#ef4444", stage_type: "lost", position: 4 }, // red
];

export default function PipelinesPage() {
  useDocumentTitle("Pipelines");
  const supabase = createClient();
  const canEditSettings = useCan("edit-settings");
  const canCreateDeals = useCan("send-messages");
  const { accountId } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [poolCount, setPoolCount] = useState(0);

  // Filters — applied client-side over the already-loaded deals for the
  // selected pipeline (no pagination here, so no extra round-trip per
  // filter change). Tags aren't included in the deals query itself, so
  // they're fetched separately and looked up by contact_id.
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [tagsByContact, setTagsByContact] = useState<Record<string, string[]>>({});
  const [filterSearch, setFilterSearch] = useState("");
  const [filterTagIds, setFilterTagIds] = useState<Set<string>>(new Set());
  const [filterAssignedTo, setFilterAssignedTo] = useState<string>("");
  const [filterSource, setFilterSource] = useState<string>("");

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .order("created_at");
    if (error) {
      console.error("Failed to load pipelines:", error.message);
      return [];
    }
    return data ?? [];
  }, [supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("position");
      return data ?? [];
    },
    [supabase],
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("deals")
        .select("*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*)")
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false });
      return (data ?? []) as Deal[];
    },
    [supabase],
  );

  const loadTags = useCallback(async () => {
    const { data } = await supabase.from("tags").select("*").order("name");
    return (data ?? []) as TagRecord[];
  }, [supabase]);

  const loadTagsByContact = useCallback(
    async (contactIds: string[]) => {
      if (contactIds.length === 0) return {};
      const { data } = await supabase
        .from("contact_tags")
        .select("contact_id, tag_id")
        .in("contact_id", contactIds);
      const map: Record<string, string[]> = {};
      for (const row of data ?? []) {
        (map[row.contact_id] ??= []).push(row.tag_id);
      }
      return map;
    },
    [supabase],
  );

  // Caça-leads: same unowned-contacts count shown on /contacts, surfaced
  // here too so a vendor sees the pool without having to know that page
  // exists — this is the visible "N leads available" counter described
  // when the feature was designed, which only ever landed on Contacts.
  const loadPoolCount = useCallback(async () => {
    const { count } = await supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .is("owner_id", null);
    setPoolCount(count ?? 0);
  }, [supabase]);

  // Initial load. Deliberately does NOT auto-create a pipeline when
  // the account has none — it used to, silently, on every page visit
  // to a zero-pipeline account. That raced with a user who opened
  // "Add Pipeline" and typed their own name in the same moment: both
  // inserts landed, leaving an unwanted extra "Sales Pipeline" next
  // to the one the user actually asked for. Real client accounts are
  // seeded a default pipeline once, at account creation
  // (admin_create_account RPC, 030) — this effect only ever sees zero
  // pipelines for a pre-multi-tenant personal/legacy account, which
  // is exactly the empty state below that lets the user create their
  // first pipeline deliberately, under a name they chose.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const list = await loadPipelines();

      if (cancelled) return;
      setPipelines(list);
      if (list.length > 0) {
        setSelectedPipelineId((prev) =>
          prev && list.some((p) => p.id === prev) ? prev : list[0].id,
        );
      } else {
        setSelectedPipelineId("");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines]);

  useEffect(() => {
    loadPoolCount();
  }, [loadPoolCount]);

  useEffect(() => {
    (async () => {
      setTags(await loadTags());
    })();
  }, [loadTags]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      setStages([]);
      setDeals([]);
      setTagsByContact({});
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
      ]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
      const contactIds = [...new Set(d.map((x) => x.contact_id).filter(Boolean))] as string[];
      const tbc = await loadTagsByContact(contactIds);
      if (!cancelled) setTagsByContact(tbc);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals, loadTagsByContact]);

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId("");
    else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    const d = await loadDeals(selectedPipelineId);
    setDeals(d);
    const contactIds = [...new Set(d.map((x) => x.contact_id).filter(Boolean))] as string[];
    setTagsByContact(await loadTagsByContact(contactIds));
  }, [loadDeals, loadTagsByContact, selectedPipelineId]);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      const moved = deals.find((d) => d.id === dealId);
      // Optimistic update — board already animated; just persist.
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stage_id: newStageId } : d)),
      );
      const { error } = await supabase
        .from("deals")
        .update({ stage_id: newStageId })
        .eq("id", dealId);
      if (error) {
        toast.error("Failed to move deal");
        refreshDeals();
        return;
      }
      if (moved) {
        void dispatchDealStageEvent({
          contactId: moved.contact_id,
          dealId,
          pipelineId: moved.pipeline_id,
          stageId: newStageId,
          event: "moved",
        });
      }
    },
    [supabase, refreshDeals, deals],
  );

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setCreating(false);
      return;
    }
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) {
      toast.error("Your profile is not linked to an account.");
      setCreating(false);
      return;
    }

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error("Failed to create pipeline");
      setCreating(false);
      return;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      stage_type: s.stage_type,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    setNewPipelineName("");
    setNewPipelineOpen(false);
    setSelectedPipelineId(pipeline.id);
    await refreshPipelines();
    setCreating(false);
    toast.success("Pipeline created");
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  // Distinct assignees among the currently loaded deals — pulled from
  // the deals themselves rather than a full member-list fetch, so an
  // account with no assignments yet just shows nothing to filter by.
  const assignedToOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of deals) {
      if (d.assigned_to && d.assignee) {
        seen.set(d.assigned_to, d.assignee.full_name || d.assignee.email || d.assigned_to);
      }
    }
    return [...seen.entries()];
  }, [deals]);

  const filteredDeals = useMemo(() => {
    const query = filterSearch.trim().toLowerCase();
    return deals.filter((d) => {
      if (filterSource && d.source !== filterSource) return false;
      if (filterAssignedTo && d.assigned_to !== filterAssignedTo) return false;
      if (filterTagIds.size > 0) {
        const dealTagIds = d.contact_id ? tagsByContact[d.contact_id] ?? [] : [];
        if (!dealTagIds.some((id) => filterTagIds.has(id))) return false;
      }
      if (query) {
        const haystack = `${d.title} ${d.contact?.name ?? ""} ${d.contact?.phone ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [deals, filterSource, filterAssignedTo, filterTagIds, filterSearch, tagsByContact]);

  const activeFilterCount =
    (filterSearch.trim() ? 1 : 0) +
    (filterAssignedTo ? 1 : 0) +
    (filterSource ? 1 : 0) +
    filterTagIds.size;

  function toggleFilterTag(tagId: string) {
    setFilterTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  function clearFilters() {
    setFilterSearch("");
    setFilterTagIds(new Set());
    setFilterAssignedTo("");
    setFilterSource("");
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-slate-800" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-slate-800" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-slate-800/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Pipeline selector dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 transition-colors data-[popup-open]:bg-slate-800"
            >
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="font-semibold">
                {selectedPipeline?.name ?? "Select Pipeline"}
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-64 border-slate-700 bg-slate-900 text-slate-200"
            >
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-slate-500">
                  No pipelines yet
                </DropdownMenuItem>
              )}
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={
                    p.id === selectedPipelineId
                      ? "text-primary"
                      : "text-slate-300"
                  }
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-slate-700" />
              {selectedPipeline && (
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  className="text-slate-300"
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  Manage Pipelines
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <a
            href="/contacts?pool=1"
            className="inline-flex items-center gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-300 hover:bg-amber-950/50 transition-colors"
          >
            <Users className="h-4 w-4" />
            <span className="font-semibold">{poolCount}</span>
            <span className="hidden sm:inline">leads disponíveis</span>
          </a>
        </div>

        <div className="flex items-center gap-2">
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Pipeline
          </GatedButton>
          <GatedButton
            canAct={canCreateDeals}
            gateReason="create deals"
            disabled={!selectedPipelineId || stages.length === 0}
            onClick={() => handleAddDeal()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Deal
          </GatedButton>
        </div>
      </div>

      {/* Board */}
      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 py-20">
          <GitBranch className="h-12 w-12 text-slate-600" />
          <h3 className="mt-4 text-lg font-medium text-white">
            No pipelines yet
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            Create a pipeline to start tracking deals
          </p>
          <GatedButton
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            Create Pipeline
          </GatedButton>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder="Search deals or contacts…"
                className="bg-slate-900 border-slate-700 pl-8 text-white placeholder:text-slate-500"
              />
            </div>

            {tags.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 transition-colors data-[popup-open]:bg-slate-800">
                  <Filter className="h-3.5 w-3.5" />
                  Tags
                  {filterTagIds.size > 0 && (
                    <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                      {filterTagIds.size}
                    </span>
                  )}
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-56 border-slate-700 bg-slate-900 text-slate-200"
                >
                  {tags.map((t) => (
                    <DropdownMenuCheckboxItem
                      key={t.id}
                      checked={filterTagIds.has(t.id)}
                      onCheckedChange={() => toggleFilterTag(t.id)}
                    >
                      <span
                        className="mr-1.5 h-2.5 w-2.5 shrink-0 rounded-full border border-slate-600"
                        style={{ backgroundColor: t.color }}
                        aria-hidden
                      />
                      {t.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {assignedToOptions.length > 0 && (
              <select
                value={filterAssignedTo}
                onChange={(e) => setFilterAssignedTo(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
              >
                <option value="">Assigned to: All</option>
                {assignedToOptions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            )}

            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            >
              <option value="">Source: All</option>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>

            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
                Clear filters ({activeFilterCount})
              </Button>
            )}
          </div>

          <PipelineAnalytics stages={stages} deals={filteredDeals} />
          <PipelineBoard
            stages={stages}
            deals={filteredDeals}
            onDealMoved={handleDealMoved}
            onAddDeal={handleAddDeal}
            onEditDeal={handleEditDeal}
          />
        </>
      )}

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-sm bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white">New Pipeline</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-slate-300">Pipeline Name</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder="e.g., Enterprise Sales"
              className="mt-2 bg-slate-800 border-slate-700 text-white"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-slate-400">
              As etapas padrão (Novo Lead → Fechado Ganho/Perdido) serão criadas automaticamente.
            </p>
          </div>
          <DialogFooter className="bg-slate-900/50 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? "Creating..." : "Create Pipeline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />
    </div>
  );
}
