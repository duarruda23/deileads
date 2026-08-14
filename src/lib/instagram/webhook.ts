export interface InstagramMessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number | string;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_self?: boolean;
    is_deleted?: boolean;
    is_unsupported?: boolean;
    quick_reply?: { payload?: string };
    reply_to?: { mid?: string; story?: { id?: string; url?: string } };
    attachments?: Array<{
      type?: string;
      payload?: { url?: string };
    }>;
  };
}

export interface NormalizedInstagramMessage {
  messageId: string;
  senderId: string;
  contentType:
    | 'text'
    | 'image'
    | 'document'
    | 'audio'
    | 'video'
    | 'interactive';
  contentText: string | null;
  mediaUrl: string | null;
  replyToMessageId: string | null;
  createdAt: string;
}

const MEDIA_TYPES = new Set(['image', 'document', 'audio', 'video']);

export function normalizeInstagramMessage(
  event: InstagramMessagingEvent
): NormalizedInstagramMessage | null {
  const message = event.message;
  const senderId = event.sender?.id;
  if (!message?.mid || !senderId || message.is_echo || message.is_self)
    return null;

  let contentType: NormalizedInstagramMessage['contentType'] = 'text';
  let contentText = message.text?.trim() || null;
  let mediaUrl: string | null = null;

  if (message.is_deleted) contentText = '[Message deleted on Instagram]';
  else if (message.is_unsupported)
    contentText = '[Unsupported Instagram message]';
  else if (message.quick_reply?.payload) contentType = 'interactive';
  else if (message.attachments?.length) {
    const attachment = message.attachments[0];
    contentType = MEDIA_TYPES.has(attachment.type || '')
      ? (attachment.type as NormalizedInstagramMessage['contentType'])
      : attachment.type === 'ig_reel' || attachment.type === 'reel'
        ? 'video'
        : 'text';
    mediaUrl = attachment.payload?.url || null;
    if (!contentText)
      contentText = `[Instagram ${attachment.type || 'attachment'}]`;
  }

  const timestamp = Number(event.timestamp);
  return {
    messageId: message.mid,
    senderId,
    contentType,
    contentText,
    mediaUrl,
    replyToMessageId: message.reply_to?.mid || null,
    createdAt: Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString()
      : new Date().toISOString(),
  };
}
