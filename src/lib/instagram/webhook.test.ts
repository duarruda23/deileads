import { describe, expect, it } from 'vitest';

import { normalizeInstagramMessage } from './webhook';

describe('normalizeInstagramMessage', () => {
  it('normalizes an inbound text event', () => {
    expect(
      normalizeInstagramMessage({
        sender: { id: 'igsid-1' },
        timestamp: 1_700_000_000_000,
        message: { mid: 'mid-1', text: 'Olá' },
      })
    ).toMatchObject({
      messageId: 'mid-1',
      senderId: 'igsid-1',
      contentType: 'text',
      contentText: 'Olá',
    });
  });

  it('ignores echo and self events', () => {
    expect(
      normalizeInstagramMessage({
        sender: { id: 'business' },
        message: { mid: 'mid-echo', text: 'sent', is_echo: true },
      })
    ).toBeNull();
  });

  it('maps reels to video and preserves reply ids', () => {
    expect(
      normalizeInstagramMessage({
        sender: { id: 'igsid-2' },
        message: {
          mid: 'mid-2',
          reply_to: { mid: 'parent-mid' },
          attachments: [{ type: 'ig_reel', payload: { url: 'https://media' } }],
        },
      })
    ).toMatchObject({
      contentType: 'video',
      mediaUrl: 'https://media',
      replyToMessageId: 'parent-mid',
    });
  });
});
