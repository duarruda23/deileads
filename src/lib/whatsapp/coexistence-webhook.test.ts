import { describe, expect, it } from 'vitest';
import {
  extractEchoMessages,
  extractHistoryErrors,
  extractHistoryMessages,
  extractStateSyncContacts,
  isCoexistenceWebhookField,
  mapMirroredContent,
} from './coexistence-webhook';

// Payloads follow Meta's "Onboard WhatsApp Business app users" docs.
const metadata = { display_phone_number: '15550783881', phone_number_id: '106540352242922' };

describe('isCoexistenceWebhookField', () => {
  it('matches only the three coexistence fields', () => {
    expect(isCoexistenceWebhookField('smb_message_echoes')).toBe(true);
    expect(isCoexistenceWebhookField('history')).toBe(true);
    expect(isCoexistenceWebhookField('smb_app_state_sync')).toBe(true);
    expect(isCoexistenceWebhookField('messages')).toBe(false);
    expect(isCoexistenceWebhookField('message_template_status_update')).toBe(false);
  });
});

describe('extractEchoMessages', () => {
  it('turns an app-sent message into an agent message for the recipient', () => {
    const out = extractEchoMessages({
      metadata,
      message_echoes: [
        {
          from: '15550783881',
          to: '16505551234',
          id: 'wamid.ECHO1',
          timestamp: '1700255121',
          type: 'text',
          text: { body: 'Requested information' },
        },
      ],
    });
    expect(out).toEqual([
      {
        customerPhone: '16505551234',
        senderType: 'agent',
        metaMessageId: 'wamid.ECHO1',
        contentType: 'text',
        contentText: 'Requested information',
        mediaUrl: null,
        status: 'sent',
        createdAt: new Date(1700255121 * 1000).toISOString(),
      },
    ]);
  });

  it('skips echoes without id or recipient', () => {
    expect(
      extractEchoMessages({
        message_echoes: [
          { id: '', to: '1', timestamp: '1', type: 'text' },
          { id: 'x', to: '', timestamp: '1', type: 'text' },
        ],
      }),
    ).toEqual([]);
  });
});

describe('extractHistoryMessages', () => {
  it('splits a thread into business (agent) and customer messages', () => {
    const out = extractHistoryMessages({
      metadata,
      history: [
        {
          metadata: { phase: 0, chunk_order: 1, progress: 55 },
          threads: [
            {
              id: '16505551234',
              messages: [
                {
                  from: '15550783881',
                  id: 'wamid.H1',
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: 'Oi, tudo bem?' },
                  history_context: { status: 'READ' },
                },
                {
                  from: '16505551234',
                  id: 'wamid.H2',
                  timestamp: '1700000100',
                  type: 'image',
                  image: { id: 'MEDIA1', caption: 'foto' },
                  history_context: { status: 'PLAYED' },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      customerPhone: '16505551234',
      senderType: 'agent',
      status: 'read',
      contentText: 'Oi, tudo bem?',
    });
    expect(out[1]).toMatchObject({
      customerPhone: '16505551234',
      senderType: 'customer',
      // Unknown history status falls back to the inbound default.
      status: 'delivered',
      contentType: 'image',
      contentText: 'foto',
      mediaUrl: '/api/whatsapp/media/MEDIA1',
    });
  });

  it('returns nothing for a declined-history payload and reports the error', () => {
    const value = {
      metadata,
      history: [
        {
          errors: [
            {
              code: 2593109,
              title: 'History sync is turned off by business',
              message: 'History sync is turned off by business',
            },
          ],
        },
      ],
    };
    expect(extractHistoryMessages(value)).toEqual([]);
    expect(extractHistoryErrors(value)).toEqual([
      '2593109: History sync is turned off by business',
    ]);
  });
});

describe('extractStateSyncContacts', () => {
  it('keeps adds/edits with a phone and drops removals', () => {
    const out = extractStateSyncContacts({
      metadata,
      state_sync: [
        {
          type: 'contact',
          action: 'add',
          contact: { full_name: 'Maria Souza', first_name: 'Maria', phone_number: '+55 81 99999-0000' },
        },
        { type: 'contact', action: 'edit', contact: { first_name: 'João', phone_number: '5581988887777' } },
        { type: 'contact', action: 'remove', contact: { full_name: 'Removido', phone_number: '5581977776666' } },
        { type: 'contact', action: 'add', contact: { full_name: 'Sem telefone' } },
      ],
    });
    expect(out).toEqual([
      { phone: '5581999990000', name: 'Maria Souza' },
      { phone: '5581988887777', name: 'João' },
    ]);
  });
});

describe('mapMirroredContent', () => {
  it('maps unsupported types to a text placeholder the CHECK constraint accepts', () => {
    expect(mapMirroredContent({ id: 'x', timestamp: '1', type: 'poll' })).toEqual({
      contentType: 'text',
      contentText: '[poll]',
      mediaUrl: null,
    });
  });

  it('treats stickers as images', () => {
    expect(mapMirroredContent({ id: 'x', timestamp: '1', type: 'sticker', sticker: { id: 'S1' } })).toEqual({
      contentType: 'image',
      contentText: null,
      mediaUrl: '/api/whatsapp/media/S1',
    });
  });
});
