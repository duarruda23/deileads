/**
 * Hotmart REST API helpers — OAuth token exchange + product listing.
 *
 * Separate from `src/lib/auth/hotmart.ts` (webhook Hottok hashing) on
 * purpose: the Hottok only authenticates *inbound* webhook calls from
 * Hotmart and is never sent anywhere by us. This file is the other
 * direction — us calling *out* to Hotmart's API — which needs the
 * Client ID/Secret pair generated separately in Ferramentas →
 * Credenciais on the Hotmart dashboard.
 *
 * Named-params functions + a shared error helper, mirroring
 * `src/lib/whatsapp/meta-api.ts`.
 *
 * NOTE for whoever tests this first against a real Hotmart account:
 * the OAuth flow (host, grant type, Basic-auth header) matches
 * Hotmart's published App Authentication docs as of this writing,
 * but the exact Product List response shape (`items[].id` /
 * `items[].name` vs. some other nesting) was not verified against a
 * live response — `listProducts()` throws a clear error if the
 * payload doesn't look like the expected shape rather than silently
 * returning garbage, so a mismatch surfaces immediately instead of
 * quietly mis-tagging contacts.
 */

const HOTMART_AUTH_BASE = 'https://api-sec-vlc.hotmart.com'
const HOTMART_API_BASE = 'https://developers.hotmart.com'

export interface HotmartTokenArgs {
  clientId: string
  clientSecret: string
}

interface HotmartTokenResponse {
  access_token?: string
  token_type?: string
  expires_in?: number
}

async function throwHotmartError(response: Response, fallback: string): Promise<never> {
  let detail = ''
  try {
    const text = await response.text()
    if (text) detail = ` — ${text.slice(0, 300)}`
  } catch {
    // ignore — keep the fallback message
  }
  throw new Error(`${fallback} (${response.status})${detail}`)
}

/**
 * Exchange a Hotmart Client ID/Secret for a short-lived access token
 * (client_credentials grant). Callers should not cache this across
 * requests — token lifetime is Hotmart's call (`expires_in`) and a
 * per-sync fetch keeps this module free of any stateful cache to
 * reason about.
 */
export async function getHotmartAccessToken(args: HotmartTokenArgs): Promise<string> {
  const { clientId, clientSecret } = args
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const url = new URL(`${HOTMART_AUTH_BASE}/security/oauth/token`)
  url.searchParams.set('grant_type', 'client_credentials')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('client_secret', clientSecret)

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { Authorization: `Basic ${basicAuth}` },
  })
  if (!response.ok) {
    await throwHotmartError(response, 'Hotmart auth failed — check the Client ID/Secret')
  }
  const data = (await response.json()) as HotmartTokenResponse
  if (!data.access_token) {
    throw new Error('Hotmart auth response had no access_token')
  }
  return data.access_token
}

export interface HotmartProductSummary {
  id: string
  name: string
}

interface HotmartProductListResponse {
  items?: Array<{ id?: number | string; name?: string; status?: string }>
  page_info?: { next_page_token?: string | null }
}

/**
 * List every product registered under this Hotmart account
 * (Product List API). Paginates via `page_info.next_page_token` if
 * Hotmart returns one — a producer with a handful of products fits
 * in one page, but this shouldn't silently truncate a larger catalog.
 */
export async function listHotmartProducts(
  accessToken: string,
): Promise<HotmartProductSummary[]> {
  const results: HotmartProductSummary[] = []
  let pageToken: string | undefined

  // Hard cap so a pagination bug (server always returning a token)
  // can't loop forever — no real seller has 100 pages of products.
  for (let page = 0; page < 100; page++) {
    const url = new URL(`${HOTMART_API_BASE}/products/api/v1/products`)
    if (pageToken) url.searchParams.set('page_token', pageToken)

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) {
      await throwHotmartError(response, 'Failed to list Hotmart products')
    }
    const data = (await response.json()) as HotmartProductListResponse
    if (!Array.isArray(data.items)) {
      throw new Error(
        'Unexpected Hotmart product-list response shape (no items[] array)',
      )
    }
    for (const item of data.items) {
      if (item.id === undefined || item.id === null) continue
      results.push({ id: String(item.id), name: item.name?.trim() || String(item.id) })
    }

    if (!data.page_info?.next_page_token) break
    pageToken = data.page_info.next_page_token
  }

  return results
}
