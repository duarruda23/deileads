import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveWhatsappConfigForOwner } from '@/lib/whatsapp/resolve-config'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params

    if (!mediaId) {
      return NextResponse.json(
        { error: 'Media ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Resolve the caller's account_id — whatsapp_config is one-per-
    // account post-multi-user, so a teammate fetching media for a
    // conversation in the shared inbox needs the account's config,
    // not their personal (non-existent) row.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    // 034: this route only knows `mediaId`, not which conversation it
    // belongs to — trace back through the message that referenced it
    // (webhook ingestion stores media_url as this exact proxy path,
    // see generateMediaProxyUrl in whatsapp/webhook/route.ts) to find
    // the owning vendor, same as send/react do via their conversation.
    // A miss (message not found, e.g. a stale/forged mediaId) falls
    // through to the account's primary config rather than 400ing —
    // this route only serves binary bytes for auth'd account members,
    // so worst case is fetching from the "wrong" (but still valid)
    // number.
    const { data: mediaMessage } = await supabase
      .from('messages')
      .select('conversation:conversations(assigned_agent_id, contact:contacts(owner_id))')
      .eq('media_url', `/api/whatsapp/media/${mediaId}`)
      .maybeSingle()

    const conv = mediaMessage?.conversation
      ? Array.isArray(mediaMessage.conversation)
        ? mediaMessage.conversation[0]
        : mediaMessage.conversation
      : null
    const contactForMedia = conv?.contact
      ? Array.isArray(conv.contact)
        ? conv.contact[0]
        : conv.contact
      : null

    const config = await resolveWhatsappConfigForOwner(
      supabase,
      accountId,
      conv?.assigned_agent_id ?? contactForMedia?.owner_id ?? null,
    )

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured' },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // Get the download URL from Meta
    const mediaInfo = await getMediaUrl({ mediaId, accessToken })

    // Download the binary data
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: mediaInfo.url,
      accessToken,
    })

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType || mediaInfo.mimeType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('Error in WhatsApp media GET:', error)
    return NextResponse.json(
      { error: 'Failed to fetch media' },
      { status: 500 }
    )
  }
}
