import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Avatar } from './Avatar';
import { theme } from '@utils/theme';
import { Conversation, TrustLevel, MessageType } from '../types';
import { TrustBadge } from './TrustBadge';
import { TypingDots } from './TypingDots';
import { mediaPreviewLabel } from '../services/media';
import dayjs from 'dayjs';

interface Props {
  conversation: Conversation;
  trust?: TrustLevel;
  online?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}

// Small icon glyph prefix shown before the preview text when the last message
// is media (WhatsApp pattern).
function kindGlyph(kind?: MessageType): string {
  switch (kind) {
    case 'voice':    return '🎤 ';
    case 'image':    return '📷 ';
    case 'video':    return '🎬 ';
    case 'file':     return '📎 ';
    case 'location': return '📍 ';
    default: return '';
  }
}

export const ConversationItem: React.FC<Props> = ({ conversation, trust, online, onPress, onLongPress }) => {
  const last = conversation.lastMessage;
  const ts = last?.sentAt ?? conversation.updatedAt;
  const preview = (() => {
    if (!last) return '🔒 End-to-end encrypted';
    if (last.type !== 'text' && last.type !== 'reaction' && last.type !== 'system') {
      return `${kindGlyph(last.type)}${last.body || mediaPreviewLabel(last.type)}`;
    }
    return last.body || '…';
  })();

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.bgElev }]}>
      <View>
        <Avatar name={conversation.peerName} url={conversation.peerAvatar} />
        {online && <View style={styles.onlineDot} />}
      </View>
      <View style={styles.center}>
        <View style={styles.line1}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{conversation.peerName}</Text>
            {trust && trust !== 'unknown' && <TrustBadge level={trust} compact />}
            {conversation.disappearingMs && <Text style={styles.ttl}>⏱</Text>}
          </View>
          <Text style={styles.ts}>{dayjs(ts).format('HH:mm')}</Text>
        </View>
        <View style={styles.line2}>
          {conversation.peerTyping ? (
            <View style={styles.typingWrap}>
              <TypingDots color={theme.accent} size={5} />
              <Text style={[styles.preview, { color: theme.accent, fontStyle: 'italic' }]}>typing…</Text>
            </View>
          ) : (
            <Text style={[styles.preview, conversation.unreadCount > 0 && { color: theme.text }]} numberOfLines={1}>
              {preview}
            </Text>
          )}
          {conversation.unreadCount > 0 && (
            <View style={styles.badge}><Text style={styles.badgeText}>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</Text></View>
          )}
          {conversation.muted && <Text style={styles.muted}>🔕</Text>}
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    gap: 12,
  },
  center: { flex: 1 },
  line1: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  line2: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  name: { color: theme.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  ts: { color: theme.textMute, fontSize: 11, marginLeft: 8 },
  ttl: { color: theme.textMute, fontSize: 11 },

  preview: { color: theme.textDim, fontSize: 13, flex: 1 },
  typingWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },

  badge: {
    backgroundColor: theme.accent, paddingHorizontal: 7, paddingVertical: 2,
    minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center',
    borderRadius: 10, marginLeft: 8,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  muted: { fontSize: 14, marginLeft: 6 },

  onlineDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: theme.success,
    borderWidth: 2, borderColor: theme.bg,
  },
});
