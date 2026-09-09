/**
 * Fire a `deal_stage_changed` automation trigger from client components.
 *
 * Deal creation/move today happens as direct client-side Supabase writes
 * (Kanban drag-and-drop, the deal form, CSV import) rather than through a
 * server route — the same shape of gap that made `tag_added` silently
 * never fire for tags applied straight from the Kanban UI. Each call site
 * that changes `deals.stage_id` calls this right after the write succeeds
 * so the automation engine actually sees the event.
 *
 * Best-effort: failures are logged, never thrown, so a hiccup here never
 * blocks the deal save/move the user is actually waiting on.
 */
export async function dispatchDealStageEvent(input: {
  contactId: string | null
  dealId: string
  pipelineId: string
  stageId: string
  event: 'created' | 'moved'
}): Promise<void> {
  if (!input.contactId) return
  try {
    await fetch('/api/automations/engine', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        trigger_type: 'deal_stage_changed',
        contact_id: input.contactId,
        context: {
          deal_id: input.dealId,
          pipeline_id: input.pipelineId,
          stage_id: input.stageId,
          deal_stage_event: input.event,
        },
      }),
    })
  } catch (err) {
    console.error('[automations] deal_stage_changed dispatch failed:', err)
  }
}
