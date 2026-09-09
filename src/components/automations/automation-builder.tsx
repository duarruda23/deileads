"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeft,
  ChevronDown,
  Plus,
  Trash2,
  GripVertical,
  MessageSquare,
  FileText,
  Tag,
  TagIcon,
  UserCheck,
  PencilLine,
  Briefcase,
  Hourglass,
  GitBranch,
  Webhook,
  CircleSlash,
  Zap,
  Loader2,
  ArrowDown,
  ArrowUp,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type {
  AccountMember,
  AutomationStepType,
  AutomationTriggerType,
  CustomField,
  DealStageTriggerConfig,
  KeywordMatchTriggerConfig,
  MessageTemplate,
  Pipeline,
  PipelineStage,
  Tag as TagRecord,
} from "@/types"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

// ------------------------------------------------------------
// Types (builder-local — mirror the flattened rows we POST)
// ------------------------------------------------------------

export interface BuilderStep {
  /** Client id; the API assigns real UUIDs server-side. */
  cid: string
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  branches?: { yes: BuilderStep[]; no: BuilderStep[] }
}

export interface BuilderInitial {
  id?: string
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: Record<string, unknown>
  is_active: boolean
  steps: BuilderStep[]
}

// ------------------------------------------------------------
// Step metadata — one source of truth for icon + label + border color
// ------------------------------------------------------------

interface StepMeta {
  label: string
  icon: typeof Zap
  /** Left-border accent color per spec. */
  border: string
}

const STEP_META: Record<AutomationStepType, StepMeta> = {
  send_message: { label: "Send Message", icon: MessageSquare, border: "border-l-primary" },
  send_template: { label: "Send Template", icon: FileText, border: "border-l-primary" },
  add_tag: { label: "Add Tag", icon: Tag, border: "border-l-primary" },
  remove_tag: { label: "Remove Tag", icon: TagIcon, border: "border-l-primary" },
  assign_conversation: { label: "Assign Conversation", icon: UserCheck, border: "border-l-primary" },
  update_contact_field: { label: "Update Contact Field", icon: PencilLine, border: "border-l-primary" },
  create_deal: { label: "Create Deal", icon: Briefcase, border: "border-l-primary" },
  wait: { label: "Wait", icon: Hourglass, border: "border-l-slate-500" },
  condition: { label: "Condition (If/Else)", icon: GitBranch, border: "border-l-amber-500" },
  send_webhook: { label: "Send Webhook", icon: Webhook, border: "border-l-primary" },
  close_conversation: { label: "Close Conversation", icon: CircleSlash, border: "border-l-primary" },
}

const ADDABLE_STEPS: AutomationStepType[] = [
  "send_message",
  "send_template",
  "add_tag",
  "remove_tag",
  "assign_conversation",
  "update_contact_field",
  "create_deal",
  "wait",
  "condition",
  "send_webhook",
  "close_conversation",
]

const TRIGGER_OPTIONS: { value: AutomationTriggerType; label: string; hint: string }[] = [
  { value: "new_message_received", label: "New Message Received", hint: "Any incoming message" },
  {
    value: "first_inbound_message",
    label: "First Message from Contact",
    hint: "First time this contact ever messages you (works for manually-added contacts too)",
  },
  { value: "keyword_match", label: "Keyword Match", hint: "Message contains specific keyword(s)" },
  { value: "new_contact_created", label: "New Contact Created", hint: "When a contact is auto-created from an incoming message" },
  { value: "conversation_assigned", label: "Conversation Assigned", hint: "When assigned to an agent" },
  { value: "tag_added", label: "Tag Added", hint: "When a tag is added to a contact" },
  { value: "time_based", label: "Time-Based", hint: "On a recurring schedule" },
  {
    value: "deal_stage_changed",
    label: "Deal Stage Changed",
    hint: "When a deal is created in, moved into, or either, a pipeline stage",
  },
]

function cid(): string {
  return (
    "c_" +
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

function blankConfig(type: AutomationStepType): Record<string, unknown> {
  switch (type) {
    case "send_message":
      return { text: "" }
    case "send_template":
      return { template_name: "", language: "en_US" }
    case "add_tag":
    case "remove_tag":
      return { tag_id: "" }
    case "assign_conversation":
      return { mode: "round_robin" }
    case "update_contact_field":
      return { field: "name", value: "" }
    case "create_deal":
      return { pipeline_id: "", stage_id: "", title: "", value: 0 }
    case "wait":
      return { amount: 1, unit: "hours" }
    case "condition":
      return { subject: "tag_presence", operand: "", value: "" }
    case "send_webhook":
      return { url: "", headers: {}, body_template: "" }
    case "close_conversation":
      return {}
    default:
      return {}
  }
}

// ------------------------------------------------------------
// Account resources (tags, members, approved templates)
//
// Loaded once at the builder root and shared via context so the
// tag / agent / template pickers below can offer existing resources
// by name instead of asking the user to paste raw UUIDs. Every picker
// falls back to a raw input when its list is empty (fresh account or
// an older deployment), so an automation is always authorable.
// ------------------------------------------------------------

interface AutomationResources {
  tags: TagRecord[]
  members: AccountMember[]
  templates: MessageTemplate[]
  customFields: CustomField[]
  pipelines: Pipeline[]
  stages: PipelineStage[]
}

const ResourcesContext = createContext<AutomationResources>({
  tags: [],
  members: [],
  templates: [],
  customFields: [],
  pipelines: [],
  stages: [],
})

function useResources(): AutomationResources {
  return useContext(ResourcesContext)
}

function ResourcesProvider({ children }: { children: ReactNode }) {
  const [tags, setTags] = useState<TagRecord[]>([])
  const [members, setMembers] = useState<AccountMember[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [customFields, setCustomFields] = useState<CustomField[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [stages, setStages] = useState<PipelineStage[]>([])

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    // Tags, templates, custom fields, pipelines and stages come straight
    // from the DB — RLS scopes them to the caller's account. Only
    // APPROVED templates can actually be sent (anything else 400s at
    // send time), matching the broadcast picker.
    void (async () => {
      const [tagsRes, templatesRes, customFieldsRes, pipelinesRes, stagesRes] =
        await Promise.all([
          supabase.from("tags").select("*").order("name"),
          supabase
            .from("message_templates")
            .select("*")
            .eq("status", "APPROVED")
            .order("name"),
          supabase.from("custom_fields").select("*").order("field_name"),
          supabase.from("pipelines").select("*").order("name"),
          supabase.from("pipeline_stages").select("*").order("position"),
        ])
      if (cancelled) return
      setTags((tagsRes.data as TagRecord[] | null) ?? [])
      setTemplates((templatesRes.data as MessageTemplate[] | null) ?? [])
      setCustomFields((customFieldsRes.data as CustomField[] | null) ?? [])
      setPipelines((pipelinesRes.data as Pipeline[] | null) ?? [])
      setStages((stagesRes.data as PipelineStage[] | null) ?? [])
    })()

    // Members go through the API so we inherit its email-visibility
    // rules (agents/viewers don't see emails). Unreachable on older
    // deployments → pickers fall back to a raw agent-id input.
    void (async () => {
      try {
        const res = await fetch("/api/account/members", { cache: "no-store" })
        if (!res.ok) return
        const json = (await res.json()) as { members?: AccountMember[] }
        if (!cancelled) setMembers(json.members ?? [])
      } catch {
        // Members endpoint absent — caller falls back to raw input.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ResourcesContext.Provider
      value={{ tags, members, templates, customFields, pipelines, stages }}
    >
      {children}
    </ResourcesContext.Provider>
  )
}

/** Pipeline dropdown, storing the pipeline's id. Falls back to a raw id
 *  input when no pipelines exist yet. */
function PipelineSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const { pipelines } = useResources()
  if (pipelines.length === 0) {
    return (
      <Input
        placeholder="Pipeline id"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-slate-800 text-white"
      />
    )
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASS}>
      <option value="">Select a pipeline…</option>
      {pipelines.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  )
}

/** Stage dropdown scoped to a chosen pipeline, storing the stage's id.
 *  Falls back to a raw id input when the pipeline has no stages loaded
 *  (nothing selected yet, or an older deployment without stage data). */
function StageSelect({
  pipelineId,
  value,
  onChange,
}: {
  pipelineId: string
  value: string
  onChange: (v: string) => void
}) {
  const { stages } = useResources()
  const scoped = stages.filter((s) => s.pipeline_id === pipelineId)
  if (!pipelineId || scoped.length === 0) {
    return (
      <Input
        placeholder="Stage id"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-slate-800 text-white"
      />
    )
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASS}>
      <option value="">Select a stage…</option>
      {scoped.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  )
}

const SELECT_CLASS =
  "w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white focus:border-primary focus:outline-none"

/** Tag dropdown by name + color, storing the tag's id. Falls back to a
 *  raw id input when no tags exist yet. */
function TagSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const { tags } = useResources()
  if (tags.length === 0) {
    return (
      <Input
        placeholder="Tag id"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-slate-800 text-white"
      />
    )
  }
  const selected = tags.find((t) => t.id === value)
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-3 w-3 shrink-0 rounded-full border border-slate-600"
        style={{ backgroundColor: selected?.color ?? "transparent" }}
        aria-hidden
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
      >
        <option value="">Select a tag…</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
        {/* Preserve a saved tag that's since been deleted so editing an
            existing automation doesn't silently drop it. */}
        {value && !selected && (
          <option value={value}>{value} (unknown tag)</option>
        )}
      </select>
    </div>
  )
}

/** Contact-field dropdown for "Update Contact Field": built-in columns plus
 *  any account custom fields (stored as `custom:<id>`). A saved custom field
 *  that's since been deleted is preserved as a labelled option so editing an
 *  existing automation doesn't silently drop it. */
function ContactFieldSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const { customFields } = useResources()
  const customValue = value.startsWith("custom:") ? value : ""
  const knownCustom =
    customValue && customFields.some((f) => `custom:${f.id}` === customValue)
  return (
    <select
      value={value || "name"}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      <option value="name">Name</option>
      <option value="email">Email</option>
      <option value="company">Company</option>
      {customFields.length > 0 && (
        <optgroup label="Custom fields">
          {customFields.map((f) => (
            <option key={f.id} value={`custom:${f.id}`}>
              {f.field_name}
            </option>
          ))}
        </optgroup>
      )}
      {customValue && !knownCustom && (
        <option value={customValue}>{customValue} (unknown field)</option>
      )}
    </select>
  )
}

/** Agent dropdown by name, storing the member's user_id. Falls back to
 *  a raw id input when the member list is unavailable. */
function AgentSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const { members } = useResources()
  if (members.length === 0) {
    return (
      <Input
        placeholder="Agent id"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-slate-800 text-white"
      />
    )
  }
  const selected = members.find((m) => m.user_id === value)
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      <option value="">Select an agent…</option>
      {members.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.full_name || m.email || m.user_id}
        </option>
      ))}
      {value && !selected && (
        <option value={value}>{value} (unknown agent)</option>
      )}
    </select>
  )
}

/** Highest `{{n}}` index referenced in a template's body, so the builder
 *  knows exactly how many variable inputs to render for it. */
function templateVariableCount(bodyText: string | undefined): number {
  if (!bodyText) return 0
  let max = 0
  for (const m of bodyText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    max = Math.max(max, Number(m[1]))
  }
  return max
}

/** Template dropdown showing approved templates by name + language,
 *  storing template_name, language, and per-{{n}} variable mapping.
 *  Falls back to manual name + language inputs (no variable editor —
 *  there's no body_text to count placeholders from) when no approved
 *  templates are synced yet. */
function SendTemplateFields({
  templateName,
  language,
  variables,
  onChange,
}: {
  templateName: string
  language: string
  variables: Record<string, string>
  onChange: (patch: {
    template_name: string
    language: string
    variables?: Record<string, string>
  }) => void
}) {
  const { templates } = useResources()

  if (templates.length === 0) {
    return (
      <>
        <FieldBlock label="Template name">
          <Input
            value={templateName}
            onChange={(e) =>
              onChange({ template_name: e.target.value, language })
            }
            className="bg-slate-800 text-white"
          />
        </FieldBlock>
        <FieldBlock label="Language">
          <Input
            value={language}
            onChange={(e) =>
              onChange({ template_name: templateName, language: e.target.value })
            }
            className="bg-slate-800 text-white"
          />
        </FieldBlock>
      </>
    )
  }

  // Encode name + language in the option value so two templates that
  // share a name across languages stay distinct.
  const toValue = (name: string, lang: string) => `${name}::${lang}`
  const current = templateName ? toValue(templateName, language) : ""
  const selected = templates.find(
    (t) => toValue(t.name, t.language ?? "en_US") === current,
  )
  const varCount = templateVariableCount(selected?.body_text)

  return (
    <>
      <FieldBlock label="Template">
        <select
          value={current}
          onChange={(e) => {
            const [name, lang] = e.target.value.split("::")
            onChange({ template_name: name ?? "", language: lang ?? "" })
          }}
          className={SELECT_CLASS}
        >
          <option value="">Select a template…</option>
          {templates.map((t) => {
            const lang = t.language ?? "en_US"
            return (
              <option key={t.id} value={toValue(t.name, lang)}>
                {t.name} ({lang})
              </option>
            )
          })}
          {current && !selected && (
            <option value={current}>
              {templateName} ({language || "unknown"}) — not in approved list
            </option>
          )}
        </select>
      </FieldBlock>
      {varCount > 0 && (
        <FieldBlock label="Variables">
          <div className="space-y-2">
            {Array.from({ length: varCount }, (_, i) => String(i + 1)).map((idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-xs text-slate-500">{`{{${idx}}}`}</span>
                <Input
                  value={variables[idx] ?? ""}
                  onChange={(e) =>
                    onChange({
                      template_name: templateName,
                      language,
                      variables: { ...variables, [idx]: e.target.value },
                    })
                  }
                  placeholder="{{ contact.name }}"
                  className="bg-slate-800 text-white"
                />
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Supports {"{{ contact.name }}"}, {"{{ contact.email }}"},{" "}
            {"{{ contact.company }}"}, {"{{ vars.* }}"}, or plain text.
          </p>
        </FieldBlock>
      )}
    </>
  )
}

// ------------------------------------------------------------
// Main builder component
// ------------------------------------------------------------

export function AutomationBuilder({ initial }: { initial: BuilderInitial }) {
  const router = useRouter()
  const isEditing = !!initial.id
  const [state, setState] = useState<BuilderInitial>(initial)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function patchTop<K extends keyof BuilderInitial>(key: K, value: BuilderInitial[K]) {
    setState((s) => ({ ...s, [key]: value }))
  }

  // --- Step tree mutations (immutable) ---

  function updateStep(path: StepPath, updater: (s: BuilderStep) => BuilderStep) {
    setState((s) => ({ ...s, steps: mapAtPath(s.steps, path, updater) }))
  }

  function addStepAt(parent: ParentScope, index: number, type: AutomationStepType) {
    const node: BuilderStep = {
      cid: cid(),
      step_type: type,
      step_config: blankConfig(type),
      branches: type === "condition" ? { yes: [], no: [] } : undefined,
    }
    setState((s) => ({ ...s, steps: insertAt(s.steps, parent, index, node) }))
    setExpandedId(node.cid)
  }

  function deleteStepAt(path: StepPath) {
    setState((s) => ({ ...s, steps: removeAt(s.steps, path) }))
  }

  function moveStepAt(path: StepPath, direction: -1 | 1) {
    setState((s) => ({ ...s, steps: moveAt(s.steps, path, direction) }))
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        name: state.name || "Untitled automation",
        description: state.description || null,
        trigger_type: state.trigger_type,
        trigger_config: state.trigger_config,
        is_active: state.is_active,
        steps: toApiSteps(state.steps),
      }

      const res = isEditing
        ? await fetch(`/api/automations/${initial.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/automations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // If the server blocked activation with validation issues,
        // surface the first concrete problem so the user can fix it
        // without opening DevTools for the full array.
        const firstIssue: { path?: string; message?: string } | undefined =
          body?.issues?.[0]
        if (firstIssue?.message) {
          toast.error(firstIssue.message, {
            description: firstIssue.path ? `at ${firstIssue.path}` : undefined,
          })
        } else {
          toast.error(body?.error ?? "Save failed")
        }
        return
      }
      toast.success(isEditing ? "Automation saved" : "Automation created")
      if (!isEditing && body?.automation?.id) {
        router.replace(`/automations/${body.automation.id}/edit`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-950">
      {/* Top bar. At sub-sm widths the "Active" label is hidden and the
          switch moves to the right of the save button, so the name input
          gets maximum width. */}
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900/80 px-3 py-3 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={() => router.push("/automations")}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          aria-label="Back to automations"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          value={state.name}
          onChange={(e) => patchTop("name", e.target.value)}
          placeholder="Untitled automation"
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-white placeholder:text-slate-500 focus:bg-slate-800 focus:outline-none sm:text-base"
        />
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="hidden sm:inline">Active</span>
          <Switch
            checked={state.is_active}
            onCheckedChange={(v) => patchTop("is_active", !!v)}
            aria-label="Active"
          />
        </div>
        <Button
          onClick={save}
          disabled={saving}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEditing ? "Save" : "Save Draft"}
        </Button>
      </header>

      {/* Canvas */}
      <div className="relative flex-1 overflow-y-auto">
        <div className="absolute inset-0 bg-[radial-gradient(circle,#1e293b_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none" />
        <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-0 px-4 py-10">
          <ResourcesProvider>
            <TriggerCard
              type={state.trigger_type}
              config={state.trigger_config}
              onTypeChange={(t) => patchTop("trigger_type", t)}
              onConfigChange={(c) => patchTop("trigger_config", c)}
              automationId={initial.id}
            />
            <StepList
              steps={state.steps}
              parentPath={[]}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              updateStep={updateStep}
              addStepAt={addStepAt}
              deleteStepAt={deleteStepAt}
              moveStepAt={moveStepAt}
            />
          </ResourcesProvider>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Trigger card
// ------------------------------------------------------------

function TriggerCard({
  type,
  config,
  onTypeChange,
  onConfigChange,
  automationId,
}: {
  type: AutomationTriggerType
  config: Record<string, unknown>
  onTypeChange: (t: AutomationTriggerType) => void
  onConfigChange: (c: Record<string, unknown>) => void
  automationId?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    // Card width: full on mobile, fixed 320px on sm+. The canvas wrapper
    // (max-w-2xl + px-4) keeps this tidy on tablet/desktop.
    <div className="z-10 w-full max-w-[320px] sm:w-80">
      <div className="rounded-lg border border-slate-800 border-l-4 border-l-blue-500 bg-slate-900 shadow-lg">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-400">
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wide text-blue-300">Trigger</div>
            <div className="truncate text-sm font-medium text-white">
              {TRIGGER_OPTIONS.find((o) => o.value === type)?.label ?? type}
            </div>
          </div>
          <ChevronDown
            className={cn("h-4 w-4 text-slate-400 transition-transform", open && "rotate-180")}
          />
        </button>
        {open && (
          <div className="space-y-3 border-t border-slate-800 px-4 py-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Trigger type
              </label>
              <select
                value={type}
                onChange={(e) => onTypeChange(e.target.value as AutomationTriggerType)}
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white focus:border-primary focus:outline-none"
              >
                {TRIGGER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                {TRIGGER_OPTIONS.find((o) => o.value === type)?.hint}
              </p>
            </div>
            {type === "keyword_match" && (
              <KeywordMatchConfig
                config={config as unknown as KeywordMatchTriggerConfig}
                onChange={onConfigChange}
              />
            )}
            {type === "tag_added" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Tag
                </label>
                <TagSelect
                  value={(config.tag_id as string) ?? ""}
                  onChange={(v) => onConfigChange({ ...config, tag_id: v })}
                />
              </div>
            )}
            {type === "time_based" && (
              <Input
                placeholder="Cron expression or HH:mm"
                value={(config.schedule as string) ?? ""}
                onChange={(e) =>
                  onConfigChange({ ...config, schedule: e.target.value })
                }
                className="bg-slate-800 text-white"
              />
            )}
            {type === "deal_stage_changed" && (
              <DealStageTriggerConfigEditor
                config={config as unknown as DealStageTriggerConfig}
                onChange={onConfigChange}
                automationId={automationId}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function DealStageTriggerConfigEditor({
  config,
  onChange,
  automationId,
}: {
  config: DealStageTriggerConfig
  onChange: (c: Record<string, unknown>) => void
  automationId?: string
}) {
  const [backfilling, setBackfilling] = useState(false)
  const pipelineId = config?.pipeline_id ?? ""
  const stageId = config?.stage_id ?? ""
  const mode = config?.mode ?? "both"

  async function handleBackfill() {
    if (!automationId) return
    setBackfilling(true)
    try {
      const res = await fetch(`/api/automations/${automationId}/backfill`, {
        method: "POST",
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(body?.error ?? "Failed to apply to existing deals")
        return
      }
      toast.success(`Ran automation for ${body.processed} existing deal(s)`)
    } finally {
      setBackfilling(false)
    }
  }

  return (
    <>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Pipeline</label>
        <PipelineSelect
          value={pipelineId}
          onChange={(v) => onChange({ ...config, pipeline_id: v, stage_id: "" })}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Stage</label>
        <StageSelect
          pipelineId={pipelineId}
          value={stageId}
          onChange={(v) => onChange({ ...config, stage_id: v })}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">When</label>
        <select
          value={mode}
          onChange={(e) => onChange({ ...config, mode: e.target.value })}
          className={SELECT_CLASS}
        >
          <option value="created">Deal is created in this stage</option>
          <option value="moved">Deal is moved into this stage</option>
          <option value="both">Deal is created or moved into this stage</option>
        </select>
      </div>
      <div className="border-t border-slate-800 pt-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleBackfill}
          disabled={!automationId || !pipelineId || !stageId || backfilling}
          className="w-full"
        >
          {backfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Apply to deals already in this stage
        </Button>
        <p className="mt-1 text-[11px] text-slate-500">
          {automationId
            ? "Runs this automation once, right now, for every deal already sitting in that stage."
            : "Save this automation first to enable this."}
        </p>
      </div>
    </>
  )
}

function KeywordMatchConfig({
  config,
  onChange,
}: {
  config: KeywordMatchTriggerConfig
  onChange: (c: Record<string, unknown>) => void
}) {
  const keywords = config?.keywords ?? []
  // Keep a local draft string so the comma and trailing space aren't
  // stripped on every keystroke (which made multi-word, comma-separated
  // entry like "SEO, search engine optimization" impossible to type).
  // We only parse into the keywords array on blur, then re-display the
  // cleaned, rejoined form. Seeded once on mount; this component remounts
  // when the trigger type changes, so the seed stays in sync.
  const [draft, setDraft] = useState(keywords.join(", "))

  function commit() {
    const parsed = draft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    setDraft(parsed.join(", "))
    onChange({ ...config, keywords: parsed })
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">
          Keywords (comma-separated)
        </label>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            }
          }}
          placeholder="e.g. pricing, demo request, talk to sales"
          className="bg-slate-800 text-white"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">
          Match type
        </label>
        <select
          value={config?.match_type ?? "contains"}
          onChange={(e) => onChange({ ...config, match_type: e.target.value as "exact" | "contains" })}
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white focus:outline-none"
        >
          <option value="contains">Contains</option>
          <option value="exact">Exact</option>
        </select>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Step list + card + connectors
// ------------------------------------------------------------

type ParentScope =
  | { kind: "root" }
  | { kind: "branch"; parentCid: string; branch: "yes" | "no" }

type StepPath = (
  | { kind: "root"; index: number }
  | { kind: "branch"; parentCid: string; branch: "yes" | "no"; index: number }
)[]

interface StepListProps {
  steps: BuilderStep[]
  parentPath: StepPath
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  updateStep: (path: StepPath, updater: (s: BuilderStep) => BuilderStep) => void
  addStepAt: (parent: ParentScope, index: number, type: AutomationStepType) => void
  deleteStepAt: (path: StepPath) => void
  moveStepAt: (path: StepPath, direction: -1 | 1) => void
}

function StepList(props: StepListProps) {
  const { steps, parentPath, ...rest } = props
  const parentScope: ParentScope =
    parentPath.length === 0
      ? { kind: "root" }
      : (() => {
          const last = parentPath[parentPath.length - 1]
          if (last.kind !== "branch") return { kind: "root" } as const
          return { kind: "branch", parentCid: last.parentCid, branch: last.branch } as const
        })()

  return (
    <div className="flex flex-col items-center">
      <AddButton onPick={(t) => props.addStepAt(parentScope, 0, t)} />
      {steps.map((step, idx) => (
        <StepRenderer
          key={step.cid}
          step={step}
          index={idx}
          total={steps.length}
          parentScope={parentScope}
          parentPath={parentPath}
          {...rest}
        />
      ))}
    </div>
  )
}

function StepRenderer({
  step,
  index,
  total,
  parentScope,
  parentPath,
  ...props
}: {
  step: BuilderStep
  index: number
  total: number
  parentScope: ParentScope
  parentPath: StepPath
} & Omit<StepListProps, "steps" | "parentPath">) {
  const path: StepPath = [
    ...parentPath,
    parentScope.kind === "root"
      ? { kind: "root", index }
      : { kind: "branch", parentCid: parentScope.parentCid, branch: parentScope.branch, index },
  ]
  const meta = STEP_META[step.step_type]
  const Icon = meta.icon
  const expanded = props.expandedId === step.cid
  const isCondition = step.step_type === "condition"
  // Always fill the available column width, capped by max-w. A fixed
  // `sm:w-80`/`sm:w-[400px]` used to override this on desktop — fine for
  // a top-level card (its column is the full canvas), but a condition
  // nested inside a Yes/No branch sits in a column that's already been
  // halved by ConditionBranches' grid, and halved again for every level
  // nested below that. Forcing a fixed width there made the card wider
  // than its column, so a chain of 2+ nested conditions (any tag_presence
  // if/else-if/else) rendered as overlapping cards instead of a tree.
  const width = isCondition ? "w-full max-w-[400px]" : "w-full max-w-[320px]"

  return (
    <>
      <div className={cn("z-10 flex flex-col", width)}>
        <div
          className={cn(
            "rounded-lg border border-slate-800 border-l-4 bg-slate-900 shadow-lg",
            meta.border,
          )}
        >
          <button
            type="button"
            onClick={() => props.setExpandedId(expanded ? null : step.cid)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <GripVertical className="h-4 w-4 flex-shrink-0 text-slate-600" aria-hidden />
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-800 text-slate-300">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">
                {isCondition ? "Condition" : step.step_type === "wait" ? "Wait" : "Action"}
              </div>
              <div className="truncate text-sm font-medium text-white">{meta.label}</div>
              <div className="truncate text-[11px] text-slate-500">{previewFor(step)}</div>
            </div>
            <ChevronDown
              className={cn("h-4 w-4 text-slate-400 transition-transform", expanded && "rotate-180")}
            />
          </button>
          {expanded && (
            <div className="border-t border-slate-800 px-4 py-3">
              <StepEditor
                step={step}
                onChange={(next) => props.updateStep(path, () => next)}
              />
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-800 pt-3">
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === 0}
                    aria-label="Move up"
                    onClick={() => props.moveStepAt(path, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === total - 1}
                    aria-label="Move down"
                    onClick={() => props.moveStepAt(path, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => props.deleteStepAt(path)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
            </div>
          )}
        </div>

        {isCondition && (
          <ConditionBranches step={step} parentPath={path} {...props} />
        )}
      </div>

      <AddButton
        onPick={(t) => props.addStepAt(parentScope, index + 1, t)}
      />
    </>
  )
}

function ConditionBranches({
  step,
  parentPath,
  ...props
}: {
  step: BuilderStep
  parentPath: StepPath
} & Omit<StepListProps, "steps" | "parentPath">) {
  const yes = step.branches?.yes ?? []
  const no = step.branches?.no ?? []
  // Build the child scope by appending a branch marker. The scope the
  // StepList uses is driven by the LAST element of parentPath, so the
  // tail's `index` doesn't matter — it's replaced per child during walks.
  const yesPath: StepPath = [
    ...parentPath,
    { kind: "branch", parentCid: step.cid, branch: "yes", index: 0 },
  ]
  const noPath: StepPath = [
    ...parentPath,
    { kind: "branch", parentCid: step.cid, branch: "no", index: 0 },
  ]
  return (
    // Stack Yes/No vertically on mobile — two columns at 375px would
    // cram each branch to ~170px which is too narrow for the nested
    // cards. Two-column grid returns on sm+.
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <BranchColumn label="Yes" color="text-primary">
        <StepList {...props} steps={yes} parentPath={yesPath} />
      </BranchColumn>
      <BranchColumn label="No" color="text-rose-400">
        <StepList {...props} steps={no} parentPath={noPath} />
      </BranchColumn>
    </div>
  )
}

function BranchColumn({
  label,
  color,
  children,
}: {
  label: string
  color: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center">
      <div className={cn("mb-2 text-[11px] font-semibold uppercase", color)}>{label}</div>
      {children}
    </div>
  )
}

function AddButton({ onPick }: { onPick: (t: AutomationStepType) => void }) {
  return (
    <div className="relative flex flex-col items-center">
      <div className="h-4 w-[2px] bg-slate-700" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-slate-700 bg-slate-950 text-slate-400 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary data-[popup-open]:border-primary data-[popup-open]:bg-primary/20 data-[popup-open]:text-primary"
          aria-label="Add step"
        >
          <Plus className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 min-w-56 overflow-y-auto border-slate-700 bg-slate-900"
        >
          {ADDABLE_STEPS.map((t) => {
            const Icon = STEP_META[t].icon
            return (
              <DropdownMenuItem key={t} onClick={() => onPick(t)}>
                <Icon className="h-4 w-4" />
                {STEP_META[t].label}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="h-4 w-[2px] bg-slate-700" aria-hidden />
    </div>
  )
}

// ------------------------------------------------------------
// Per-step config editor
// ------------------------------------------------------------

function StepEditor({
  step,
  onChange,
}: {
  step: BuilderStep
  onChange: (s: BuilderStep) => void
}) {
  const cfg = step.step_config
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...step, step_config: { ...cfg, ...patch } })

  switch (step.step_type) {
    case "send_message":
      return (
        <FieldBlock label="Message text">
          <Textarea
            value={(cfg.text as string) ?? ""}
            onChange={(e) => set({ text: e.target.value })}
            placeholder="Hi! Thanks for reaching out…"
            className="min-h-24 bg-slate-800 text-white"
          />
        </FieldBlock>
      )
    case "send_template":
      return (
        <SendTemplateFields
          templateName={(cfg.template_name as string) ?? ""}
          language={(cfg.language as string) ?? ""}
          variables={(cfg.variables as Record<string, string>) ?? {}}
          onChange={(patch) => set(patch)}
        />
      )
    case "add_tag":
    case "remove_tag":
      return (
        <FieldBlock label="Tag">
          <TagSelect
            value={(cfg.tag_id as string) ?? ""}
            onChange={(v) => set({ tag_id: v })}
          />
        </FieldBlock>
      )
    case "assign_conversation":
      return (
        <>
          <FieldBlock label="Mode">
            <select
              value={(cfg.mode as string) ?? "round_robin"}
              onChange={(e) => set({ mode: e.target.value })}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white"
            >
              <option value="round_robin">Send to lead pool (unassign)</option>
              <option value="specific">Specific agent</option>
            </select>
          </FieldBlock>
          {cfg.mode === "specific" && (
            <FieldBlock label="Agent">
              <AgentSelect
                value={(cfg.agent_id as string) ?? ""}
                onChange={(v) => set({ agent_id: v })}
              />
            </FieldBlock>
          )}
          {cfg.mode === "round_robin" && (
            <p className="text-xs text-slate-500">
              Clears the lead&apos;s owner so any teammate can claim it from
              the contacts pool.
            </p>
          )}
        </>
      )
    case "update_contact_field":
      return (
        <>
          <FieldBlock label="Field">
            <ContactFieldSelect
              value={(cfg.field as string) ?? "name"}
              onChange={(v) => set({ field: v })}
            />
          </FieldBlock>
          <FieldBlock label="Value">
            <Input
              value={(cfg.value as string) ?? ""}
              onChange={(e) => set({ value: e.target.value })}
              placeholder="Text or {{ vars.x }} / {{ message.text }}"
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
        </>
      )
    case "create_deal":
      return (
        <>
          <FieldBlock label="Pipeline id">
            <Input
              value={(cfg.pipeline_id as string) ?? ""}
              onChange={(e) => set({ pipeline_id: e.target.value })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
          <FieldBlock label="Stage id">
            <Input
              value={(cfg.stage_id as string) ?? ""}
              onChange={(e) => set({ stage_id: e.target.value })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
          <FieldBlock label="Title">
            <Input
              value={(cfg.title as string) ?? ""}
              onChange={(e) => set({ title: e.target.value })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
          <FieldBlock label="Value">
            <Input
              type="number"
              value={(cfg.value as number) ?? 0}
              onChange={(e) => set({ value: Number(e.target.value) })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
        </>
      )
    case "wait":
      return (
        <div className="grid grid-cols-2 gap-2">
          <FieldBlock label="Amount">
            <Input
              type="number"
              min={1}
              value={(cfg.amount as number) ?? 1}
              onChange={(e) => set({ amount: Math.max(1, Number(e.target.value)) })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
          <FieldBlock label="Unit">
            <select
              value={(cfg.unit as string) ?? "hours"}
              onChange={(e) => set({ unit: e.target.value })}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white"
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </FieldBlock>
        </div>
      )
    case "condition":
      return (
        <>
          <FieldBlock label="Subject">
            <select
              value={(cfg.subject as string) ?? "tag_presence"}
              onChange={(e) => set({ subject: e.target.value })}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white"
            >
              <option value="tag_presence">Tag presence</option>
              <option value="contact_field">Contact field</option>
              <option value="message_content">Message content</option>
              <option value="time_of_day">Time of day</option>
            </select>
          </FieldBlock>
          <FieldBlock label="Operand">
            <Input
              placeholder={
                cfg.subject === "time_of_day"
                  ? "HH:mm-HH:mm"
                  : cfg.subject === "contact_field"
                  ? "name / email / company"
                  : cfg.subject === "tag_presence"
                  ? "tag id"
                  : ""
              }
              value={(cfg.operand as string) ?? ""}
              onChange={(e) => set({ operand: e.target.value })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
          {(cfg.subject === "contact_field" || cfg.subject === "message_content") && (
            <FieldBlock label="Value">
              <Input
                value={(cfg.value as string) ?? ""}
                onChange={(e) => set({ value: e.target.value })}
                className="bg-slate-800 text-white"
              />
            </FieldBlock>
          )}
        </>
      )
    case "send_webhook":
      return (
        <>
          <FieldBlock label="URL">
            <Input
              value={(cfg.url as string) ?? ""}
              onChange={(e) => set({ url: e.target.value })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
          <FieldBlock label="Body template (JSON)">
            <Textarea
              value={(cfg.body_template as string) ?? ""}
              onChange={(e) => set({ body_template: e.target.value })}
              className="min-h-20 bg-slate-800 font-mono text-xs text-white"
            />
          </FieldBlock>
        </>
      )
    case "close_conversation":
      return (
        <p className="text-xs text-slate-400">
          Sets the conversation status to &quot;closed&quot;. No configuration needed.
        </p>
      )
    default:
      return null
  }
}

function FieldBlock({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-2 last:mb-0">
      <label className="mb-1 block text-xs font-medium text-slate-400">{label}</label>
      {children}
    </div>
  )
}

function previewFor(step: BuilderStep): string {
  switch (step.step_type) {
    case "send_message":
      return (step.step_config.text as string) || "no text yet"
    case "send_template":
      return (step.step_config.template_name as string) || "pick a template"
    case "wait":
      return `${step.step_config.amount ?? "?"} ${step.step_config.unit ?? ""}`
    case "condition":
      return `when ${step.step_config.subject ?? "?"}`
    case "send_webhook":
      return (step.step_config.url as string) || "no url"
    default:
      return ""
  }
}

// ------------------------------------------------------------
// Tree mutation helpers
// ------------------------------------------------------------

function insertAt(
  steps: BuilderStep[],
  parent: ParentScope,
  index: number,
  node: BuilderStep,
): BuilderStep[] {
  if (parent.kind === "root") {
    const copy = [...steps]
    copy.splice(index, 0, node)
    return copy
  }
  return steps.map((s) => {
    if (s.cid !== parent.parentCid || !s.branches) return s
    const list = [...s.branches[parent.branch]]
    list.splice(index, 0, node)
    return { ...s, branches: { ...s.branches, [parent.branch]: list } }
  })
}

function mapAtPath(
  steps: BuilderStep[],
  path: StepPath,
  updater: (s: BuilderStep) => BuilderStep,
): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)

  if (head.kind === "root") {
    return steps.map((s, i) => {
      if (i !== head.index) return s
      return rest.length === 0
        ? updater(s)
        : { ...s, branches: walkBranches(s.branches, rest, updater) }
    })
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const updated = bucket.map((child, i) => {
      if (i !== head.index) return child
      return rest.length === 0
        ? updater(child)
        : { ...child, branches: walkBranches(child.branches, rest, updater) }
    })
    return { ...s, branches: { ...s.branches, [head.branch]: updated } }
  })
}

function walkBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
  updater: (s: BuilderStep) => BuilderStep,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const bucket = branches[head.branch]
  const rest = path.slice(1)
  const updated = bucket.map((child, i) => {
    if (i !== head.index) return child
    return rest.length === 0
      ? updater(child)
      : { ...child, branches: walkBranches(child.branches, rest, updater) }
  })
  return { ...branches, [head.branch]: updated }
}

function removeAt(steps: BuilderStep[], path: StepPath): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  if (head.kind === "root") {
    if (rest.length === 0) return steps.filter((_, i) => i !== head.index)
    return steps.map((s, i) =>
      i !== head.index ? s : { ...s, branches: removeFromBranches(s.branches, rest) },
    )
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const next =
      rest.length === 0
        ? bucket.filter((_, i) => i !== head.index)
        : bucket.map((child, i) =>
            i !== head.index
              ? child
              : { ...child, branches: removeFromBranches(child.branches, rest) },
          )
    return { ...s, branches: { ...s.branches, [head.branch]: next } }
  })
}

function removeFromBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const next =
    rest.length === 0
      ? bucket.filter((_, i) => i !== head.index)
      : bucket.map((child, i) =>
          i !== head.index
            ? child
            : { ...child, branches: removeFromBranches(child.branches, rest) },
        )
  return { ...branches, [head.branch]: next }
}

function moveAt(
  steps: BuilderStep[],
  path: StepPath,
  direction: -1 | 1,
): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  const swap = <T,>(arr: T[], i: number) => {
    const j = i + direction
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }
  if (head.kind === "root") {
    if (rest.length === 0) return swap(steps, head.index)
    return steps.map((s, i) =>
      i !== head.index ? s : { ...s, branches: moveInBranches(s.branches, rest, direction) },
    )
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const next = rest.length === 0 ? swap(bucket, head.index) : bucket
    return { ...s, branches: { ...s.branches, [head.branch]: next } }
  })
}

function moveInBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
  direction: -1 | 1,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const swap = <T,>(arr: T[], i: number) => {
    const j = i + direction
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }
  // When there's more path left, the target isn't a direct child of this
  // branch — descend into it (mirrors walkBranches/removeFromBranches).
  // This was previously a no-op past one level of nesting: any condition
  // nested two-plus branches deep (e.g. a chain of tag_presence checks)
  // silently failed to move at all.
  const next =
    rest.length === 0
      ? swap(bucket, head.index)
      : bucket.map((child, i) =>
          i !== head.index
            ? child
            : { ...child, branches: moveInBranches(child.branches, rest, direction) },
        )
  return { ...branches, [head.branch]: next }
}

// ------------------------------------------------------------
// Serialize builder tree → API payload (flattened shape)
// ------------------------------------------------------------

interface ApiStep {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: ApiStep[]; no?: ApiStep[] }
}

export function toApiSteps(steps: BuilderStep[]): ApiStep[] {
  return steps.map((s) => ({
    step_type: s.step_type,
    step_config: s.step_config,
    branches: s.branches
      ? { yes: toApiSteps(s.branches.yes), no: toApiSteps(s.branches.no) }
      : undefined,
  }))
}

/**
 * Convert server-returned step tree (from loadStepsTree) into the
 * builder-local shape with client ids.
 */
export interface ServerStepNode {
  id: string
  step_type: string
  step_config: Record<string, unknown>
  branches: { yes: ServerStepNode[]; no: ServerStepNode[] }
}

export function fromServerSteps(nodes: ServerStepNode[]): BuilderStep[] {
  return nodes.map((n) => ({
    cid: cid(),
    step_type: n.step_type as AutomationStepType,
    step_config: n.step_config ?? {},
    branches:
      n.step_type === "condition"
        ? {
            yes: fromServerSteps(n.branches?.yes ?? []),
            no: fromServerSteps(n.branches?.no ?? []),
          }
        : undefined,
  }))
}
