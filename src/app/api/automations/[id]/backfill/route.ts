import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runAutomationForExistingDeals } from '@/lib/automations/engine'

/**
 * One-off action for a `deal_stage_changed` automation: run it now
 * against every deal already sitting in its configured pipeline/stage,
 * so activating a new automation doesn't skip contacts that reached
 * that stage before the automation existed (e.g. a batch of deals
 * imported straight into a stage).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Same ownership pattern as the other /api/automations/[id]/* routes:
  // scoped by user_id, then the account_id needed for the deals lookup
  // is read off the row itself.
  const admin = supabaseAdmin()
  const { data: automation, error: lookupErr } = await admin
    .from('automations')
    .select('id, account_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const result = await runAutomationForExistingDeals(id, automation.account_id as string)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'backfill failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
