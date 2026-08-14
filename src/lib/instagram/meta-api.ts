const API_VERSION = process.env.META_GRAPH_API_VERSION || 'v23.0';

interface MetaErrorBody {
  error?: { message?: string; code?: number; type?: string };
}

async function metaError(response: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const payload = (await response.json()) as MetaErrorBody;
    if (payload.error?.message) message = payload.error.message;
  } catch {
    // Keep the HTTP fallback when Meta did not return JSON.
  }
  throw new Error(message);
}

async function graphRequest(
  host: 'instagram' | 'facebook',
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<Response> {
  const base =
    host === 'instagram'
      ? 'https://graph.instagram.com'
      : 'https://graph.facebook.com';
  return fetch(`${base}/${API_VERSION}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
}

export interface InstagramAccountInfo {
  id: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
}

export async function verifyInstagramAccount(args: {
  instagramAccountId: string;
  accessToken: string;
}): Promise<InstagramAccountInfo> {
  const path = `${encodeURIComponent(args.instagramAccountId)}?fields=id,username,name,profile_picture_url`;
  let response = await graphRequest('instagram', path, args.accessToken);
  if (!response.ok) {
    // Page-scoped tokens from the Facebook Login setup use the Facebook
    // Graph host; Instagram Login tokens use graph.instagram.com.
    response = await graphRequest('facebook', path, args.accessToken);
  }
  if (!response.ok) {
    await metaError(response, `Meta API error: ${response.status}`);
  }
  return response.json();
}

export async function subscribeInstagramWebhooks(args: {
  instagramAccountId: string;
  pageId?: string;
  accessToken: string;
}): Promise<void> {
  const fields = [
    'messages',
    'messaging_postbacks',
    'messaging_seen',
    'message_reactions',
  ].join(',');
  const body = JSON.stringify({ subscribed_fields: fields });

  let response = await graphRequest(
    'instagram',
    `${encodeURIComponent(args.instagramAccountId)}/subscribed_apps`,
    args.accessToken,
    { method: 'POST', body }
  );
  if (!response.ok && args.pageId) {
    response = await graphRequest(
      'facebook',
      `${encodeURIComponent(args.pageId)}/subscribed_apps`,
      args.accessToken,
      { method: 'POST', body }
    );
  }
  if (!response.ok) {
    await metaError(
      response,
      `Failed to subscribe Instagram webhooks: ${response.status}`
    );
  }
}

export async function getInstagramUserProfile(args: {
  instagramScopedId: string;
  accessToken: string;
}): Promise<InstagramAccountInfo | null> {
  try {
    const path = `${encodeURIComponent(args.instagramScopedId)}?fields=id,username,name,profile_pic`;
    let response = await graphRequest('instagram', path, args.accessToken);
    if (!response.ok)
      response = await graphRequest('facebook', path, args.accessToken);
    if (!response.ok) return null;
    const row = (await response.json()) as InstagramAccountInfo & {
      profile_pic?: string;
    };
    return {
      ...row,
      profile_picture_url: row.profile_picture_url || row.profile_pic,
    };
  } catch {
    // Profile enrichment is best effort. A transient Meta/network failure
    // must not prevent the inbound message itself from being captured.
    return null;
  }
}

export async function sendInstagramText(args: {
  instagramAccountId: string;
  pageId?: string;
  recipientId: string;
  accessToken: string;
  text: string;
}): Promise<{ messageId: string; recipientId: string }> {
  let response = await graphRequest(
    'instagram',
    `${encodeURIComponent(args.instagramAccountId)}/messages`,
    args.accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        recipient: { id: args.recipientId },
        message: { text: args.text },
      }),
    }
  );
  if (!response.ok && args.pageId) {
    response = await graphRequest(
      'facebook',
      `${encodeURIComponent(args.pageId)}/messages`,
      args.accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          recipient: { id: args.recipientId },
          messaging_type: 'RESPONSE',
          message: { text: args.text },
        }),
      }
    );
  }
  if (!response.ok) {
    await metaError(response, `Instagram send failed: ${response.status}`);
  }
  const payload = (await response.json()) as {
    message_id: string;
    recipient_id: string;
  };
  return { messageId: payload.message_id, recipientId: payload.recipient_id };
}
