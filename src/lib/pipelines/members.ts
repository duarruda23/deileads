import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Pipeline responsáveis (047). A pipeline with members belongs to
 * those people (one vendor or a group); a pipeline with none is a
 * general pipeline. Shared by the Kanban page, the claim picker and
 * the claim API route so all of them agree on what "my pipeline" and
 * "the entry stage" mean.
 */

/** pipeline_id → profile ids responsible for it (RLS scopes to the caller's account). */
export async function loadPipelineMembers(
  db: SupabaseClient
): Promise<Record<string, string[]>> {
  const { data, error } = await db
    .from('pipeline_members')
    .select('pipeline_id, profile_id');
  if (error) {
    console.error('[pipelines] failed to load members:', error.message);
    return {};
  }
  const map: Record<string, string[]> = {};
  for (const row of data ?? []) (map[row.pipeline_id] ??= []).push(row.profile_id);
  return map;
}

/** Pipelines the given profile is responsible for, by name. */
export async function loadMyPipelines(
  db: SupabaseClient,
  profileId: string
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db
    .from('pipeline_members')
    .select('pipeline:pipelines(id, name)')
    .eq('profile_id', profileId);
  if (error) {
    console.error('[pipelines] failed to load my pipelines:', error.message);
    return [];
  }
  return (data ?? [])
    .map((row) => row.pipeline as unknown as { id: string; name: string } | null)
    .filter((p): p is { id: string; name: string } => !!p)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Replace a pipeline's member list with `profileIds` (admin+ under RLS). */
export async function savePipelineMembers(
  db: SupabaseClient,
  accountId: string,
  pipelineId: string,
  profileIds: string[]
): Promise<{ error: string | null }> {
  const { data: current, error: loadError } = await db
    .from('pipeline_members')
    .select('profile_id')
    .eq('pipeline_id', pipelineId);
  if (loadError) return { error: loadError.message };

  const existing = new Set((current ?? []).map((r) => r.profile_id as string));
  const wanted = new Set(profileIds);
  const toRemove = [...existing].filter((id) => !wanted.has(id));
  const toAdd = [...wanted].filter((id) => !existing.has(id));

  if (toRemove.length > 0) {
    const { error } = await db
      .from('pipeline_members')
      .delete()
      .eq('pipeline_id', pipelineId)
      .in('profile_id', toRemove);
    if (error) return { error: error.message };
  }
  if (toAdd.length > 0) {
    const { error } = await db.from('pipeline_members').insert(
      toAdd.map((profile_id) => ({
        pipeline_id: pipelineId,
        profile_id,
        account_id: accountId,
      }))
    );
    if (error) return { error: error.message };
  }
  return { error: null };
}

/**
 * The stage a lead lands in when it's moved into a pipeline: the
 * first open stage by position, falling back to the first stage at
 * all for a pipeline that (oddly) has no open stage.
 */
export async function entryStageId(
  db: SupabaseClient,
  pipelineId: string
): Promise<string | null> {
  const { data } = await db
    .from('pipeline_stages')
    .select('id, stage_type')
    .eq('pipeline_id', pipelineId)
    .order('position');
  if (!data || data.length === 0) return null;
  return (data.find((s) => s.stage_type === 'open') ?? data[0]).id;
}
