import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { theme } from '@utils/theme';
import { Message } from '../types';
import { AnimatedTicks } from './AnimatedTicks';
import { VoicePlayer } from './VoicePlayer';
import { mediaDataUri, mediaPreviewLabel } from '../services/media';
import { FileIcon, LocationIcon } from './Icons';
import dayjs from 'dayjs';

interface Props {
  message: Message;
  mine: boolean;
  senderName?: string; // shown in group chats for "theirs" messages
  onLongPress?: () => void;
  onPressReply?: () => void;
  onPressMedia?: (uri: string) => void;
  showReply?: boolean; // tappable reply preview that scrolls to original
}

function reactionRows(r?: Record<string, string[]>): Array<[string, number]> {
  if (!r) return [];
  return Object.entries(r)
    .map<[string, number]>(([emoji, users]) => [emoji, users.length])
    .filter(([, n]) => n > 0);
}

export const MessageBubble: React.FC<Props> = ({ message, mine, senderName, onLongPress, onPressReply, onPressMedia }) => {
  // Bolle stile WhatsApp chiaro: uscita verde chiaro, entrata bianco, testo scuro su entrambe.
  const bubbleBg = mine ? '#D9FDD3' : '#FFFFFF';
  const textColor = '#111B21';
  const dimText   = '#667781';
  const reactions = useMemo(() => reactionRows(message.reactions), [message.reactions]);

  // Render media body (voice / image / video thumb / file). Absent → text body.
  const mediaBlock = (() => {
    if (!message.media) return null;
    const m = message.media;
    if (message.type === 'voice') {
      return <VoicePlayer media={m} messageId={message.id} mine={mine} />;
    }
    if (message.type === 'image' && m.data) {
      const uri = mediaDataUri(m);
      const aspect = m.width && m.height ? m.width / m.height : 1;
      return (
        <Pressable onPress={() => onPressMedia?.(uri)} style={{ borderRadius: 12, overflow: 'hidden' }}>
          <Image source={{ uri }} style={{ width: 240, aspectRatio: aspect, backgroundColor: '#00000030' }} resizeMode="cover" />
        </Pressable>
      );
    }
    if (message.type === 'video' && m.data) {
      const uri = mediaDataUri(m);
      return (
        <Pressable onPress={() => onPressMedia?.(uri)} style={styles.videoCard}>
          <Text style={[styles.fileMeta, { color: textColor }]}>▶ Video · {Math.round((m.size ?? 0) / 1024)} KB</Text>
        </Pressable>
      );
    }
    if (message.type === 'file') {
      return (
        <View style={styles.fileRow}>
          <FileIcon size={22} color={mine ? '#fff' : theme.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.body, { color: textColor }]} numberOfLines={1}>{message.body || 'Attachment'}</Text>
            <Text style={[styles.fileMeta, { color: dimText }]}>{m.mime} · {Math.round((m.size ?? 0) / 1024)} KB</Text>
          </View>
        </View>
      );
    }
    if (message.type === 'location') {
      return (
        <View style={styles.fileRow}>
          <LocationIcon size={22} color={mine ? '#fff' : theme.accent} />
          <Text style={[styles.body, { color: textColor }]}>{message.body || 'Location'}</Text>
        </View>
      );
    }
    return null;
  })();

  const showCaption = !!message.body && (message.type === 'image' || message.type === 'video');
  const hasVisualMedia = message.type === 'image' || message.type === 'video';

  return (
    <Pressable onLongPress={onLongPress} style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[
        styles.bubble,
        { backgroundColor: bubbleBg },
        mine ? styles.mineTail : styles.theirsTail,
        hasVisualMedia && { padding: 4, paddingBottom: 4 },
      ]}>
        {!mine && senderName && (
          <Text style={[styles.sender, { color: theme.accentAlt }]}>{senderName}</Text>
        )}

        {message.replyTo && (
          <Pressable onPress={onPressReply} style={[styles.replyStrip, { borderLeftColor: mine ? 'rgba(11,20,26,0.22)' : theme.accent }]}>
            <Text style={[styles.replySender, { color: mine ? '#025C4C' : theme.accent }]} numberOfLines={1}>
              {message.replyTo.senderId === message.senderId ? (senderName ?? 'You') : 'You'}
            </Text>
            <Text style={[styles.replyPreview, { color: theme.textDim }]} numberOfLines={1}>
              {message.replyTo.preview}
            </Text>
          </Pressable>
        )}

        {mediaBlock}

        {(!mediaBlock || showCaption) && !!message.body && message.type !== 'file' && message.type !== 'location' && (
          <Text style={[styles.body, { color: textColor }, hasVisualMedia && { paddingHorizontal: 10, paddingVertical: 6 }]}>
            {message.senderCompromised && <Text style={{ color: theme.alert }}>⚠ </Text>}
            {message.body}
          </Text>
        )}

        <View style={[styles.meta, hasVisualMedia && { paddingHorizontal: 10, paddingBottom: 6 }]}>
          {message.expiresAt && (
            <Text style={[styles.ttl, { color: dimText }]}>⏱</Text>
          )}
          <Text style={[styles.ts, { color: dimText }]}>{dayjs(message.sentAt).format('HH:mm')}</Text>
          {mine && <AnimatedTicks status={message.status} size={14} light={false} />}
        </View>
      </View>

      {reactions.length > 0 && (
        <View style={[styles.reactionsRow, mine ? { alignSelf: 'flex-end', marginRight: 8 } : { alignSelf: 'flex-start', marginLeft: 8 }]}>
          {reactions.map(([emoji, n]) => (
            <View key={emoji} style={styles.reactionChip}>
              <Text style={styles.reactionEmoji}>{emoji}</Text>
              {n > 1 && <Text style={styles.reactionCount}>{n}</Text>}
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: { paddingHorizontal: 10, marginVertical: 3 },
  rowMine: { alignItems: 'flex-end' },
  rowTheirs: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 18,
    minWidth: 60,
  },
  mineTail: { borderBottomRightRadius: 4 },
  theirsTail: { borderBottomLeftRadius: 4 },

  sender: { fontSize: 11, fontWeight: '700', marginBottom: 4, letterSpacing: 0.4 },

  replyStrip: {
    borderLeftWidth: 3,
    paddingLeft: 8, paddingVertical: 3,
    marginBottom: 6, borderRadius: 4,
  },
  replySender: { fontSize: 11, fontWeight: '700' },
  replyPreview: { fontSize: 12, marginTop: 1 },

  body: { fontSize: 15, lineHeight: 21 },

  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  fileMeta: { fontSize: 11, marginTop: 2 },

  videoCard: {
    paddingHorizontal: 10, paddingVertical: 10,
    backgroundColor: '#00000033', borderRadius: 10,
  },

  meta: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 4 },
  ts: { fontSize: 10, fontVariant: ['tabular-nums'] },
  ttl: { fontSize: 10 },

  reactionsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: -6,
  },
  reactionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3,
    backgroundColor: theme.bgCard,
    borderRadius: 999,
    borderWidth: 1, borderColor: theme.border,
  },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { fontSize: 11, color: theme.textDim, fontWeight: '600' },
});
