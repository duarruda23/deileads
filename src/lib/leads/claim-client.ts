import { dispatchDealStageEvent } from '@/lib/automations/dispatch-client';

/**
 * Client side of POST /api/contacts/[id]/claim, shared by the contacts
 * list and the contact detail view. When the claimer picked one of
 * their pipelines, the route moves the deal(s) there and returns them;
 * the move is a stage change like any Kanban drag, so it fires
 * deal_stage_changed for each moved deal.
 */
export async function claimContactLead(
  contactId: string,
  pipelineId: string | null
): Promise<{ ok: boolean; status: number; error?: string; warning?: string }> {
  const res = await fetch(`/api/contacts/${contactId}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pipeline_id: pipelineId }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: payload.error };
  }

  const moved = (payload.moved ?? []) as {
    id: string;
    contact_id: string | null;
    pipeline_id: string;
    stage_id: string;
  }[];
  for (const d of moved) {
    void dispatchDealStageEvent({
      contactId: d.contact_id,
      dealId: d.id,
      pipelineId: d.pipeline_id,
      stageId: d.stage_id,
      event: 'moved',
    });
  }
  return { ok: true, status: res.status, warning: payload.warning };
}
