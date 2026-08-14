import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendInstagramText, verifyInstagramAccount } from './meta-api';

afterEach(() => vi.restoreAllMocks());

describe('Instagram Meta API', () => {
  it('sends text to an Instagram-scoped recipient', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ message_id: 'mid.1', recipient_id: 'igsid.1' }),
          { status: 200 }
        )
      );

    await expect(
      sendInstagramText({
        instagramAccountId: 'ig-business',
        recipientId: 'igsid.1',
        accessToken: 'secret',
        text: 'Olá',
      })
    ).resolves.toEqual({ messageId: 'mid.1', recipientId: 'igsid.1' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/ig-business/messages'),
      expect.objectContaining({ method: 'POST' })
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({
      recipient: { id: 'igsid.1' },
      message: { text: 'Olá' },
    });
  });

  it('falls back to the Page endpoint for Facebook Login tokens', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 400 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message_id: 'mid.page', recipient_id: 'igsid.2' }),
          { status: 200 }
        )
      );

    await sendInstagramText({
      instagramAccountId: 'ig-business',
      pageId: 'page-1',
      recipientId: 'igsid.2',
      accessToken: 'page-token',
      text: 'Olá pela Página',
    });

    expect(fetchMock.mock.calls[1][0]).toContain('graph.facebook.com');
    expect(fetchMock.mock.calls[1][0]).toContain('/page-1/messages');
  });

  it('falls back to Facebook Graph for page-scoped tokens', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 400 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'ig-business', username: 'virgo' }), {
          status: 200,
        })
      );

    await expect(
      verifyInstagramAccount({
        instagramAccountId: 'ig-business',
        accessToken: 'page-token',
      })
    ).resolves.toMatchObject({ username: 'virgo' });
    expect(fetchMock.mock.calls[1][0]).toContain('graph.facebook.com');
  });
});
