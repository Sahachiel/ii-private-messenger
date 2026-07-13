import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Pressable, Alert, Clipboard,
} from 'react-native';
import { MessageBubble } from '@components/MessageBubble';
import { Avatar } from '@components/Avatar';
import { useAppDispatch, useAppSelector } from '@store/index';
import { sendMessage, sendReaction, markAsRead, deleteMessage, setDisappearingTimer, setChatWallpaper, clearConversation, upsertConversation } from '@store/chatSlice';
import { sendToGroup } from '@store/groupsSlice';
import { initiateCall } from '@store/callSlice';
import { socket } from '@services/socket';
import { groupsApi } from '@services/api';
import { theme, wallpaperById } from '@utils/theme';
import { SendIcon, PlusIcon, SmileIcon, ReplyIcon, TrashIcon, CopyIcon, ForwardIcon } from '@components/Icons';
import { TrustBadge } from '@components/TrustBadge';
import { TypingDots } from '@components/TypingDots';
import { AttachmentMenu } from '@components/AttachmentMenu';
import { ReactionsPicker } from '@components/ReactionsPicker';
import { ChatHeaderMenu } from '@components/ChatHeaderMenu';
import { VoiceRecorder } from '@components/VoiceRecorder';
import { Swipeable } from 'react-native-gesture-handler';
import BottomSheet, { BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import ImageView from 'react-native-image-viewing';
import LinearGradient from 'react-native-linear-gradient';
import HapticFeedback from 'react-native-haptic-feedback';
import { getPeerTrustLevel } from '@services/attestationStore';
import { pickMedia } from '@services/media';
import { Message, ReplyRef, MediaRef } from '../types';

function messagePreview(m: Message): string {
  if (m.type === 'voice')    return '🎤 Messaggio vocale';
  if (m.type === 'image')    return '📷 Foto';
  if (m.type === 'video')    return '🎬 Video';
  if (m.type === 'file')     return '📎 File';
  if (m.type === 'location') return '📍 Posizione';
  return m.body || '…';
}

export const ChatScreen: React.FC<{ route: any; navigation: any }> = ({ route, navigation }) => {
  const { conversationId, peerId, peerName, isGroup } = route.params;
  const dispatch = useAppDispatch();
  const messages = useAppSelector((s) => s.chat.messages[conversationId] ?? []);
  const conversation = useAppSelector((s) => s.chat.conversations[conversationId]);
  const typing = useAppSelector((s) => s.chat.typing[peerId]);
  const myId = useAppSelector((s) => s.auth.user?.id);
  const groupMembers = useAppSelector((s) => (isGroup ? s.groups.byId[conversationId]?.memberIds ?? [] : []));
  const contactsById = useAppSelector((s) => {
    const out: Record<string, { displayName: string }> = {};
    for (const c of s.contacts.contacts) out[c.id] = { displayName: c.displayName ?? c.username };
    return out;
  });

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<Message | null>(null);
  const [reactTargetId, setReactTargetId] = useState<string | null>(null);

  const listRef = useRef<FlatList>(null);
  const typingTimer = useRef<any>(null);
  const swipeRefs = useRef<Record<string, Swipeable | null>>({});

  const attachSheet = useRef<BottomSheet>(null);
  const reactSheet = useRef<BottomSheet>(null);
  const actionSheet = useRef<BottomSheet>(null);
  const headerSheet = useRef<BottomSheet>(null);

  const wallpaper = useMemo(() => wallpaperById(conversation?.wallpaperId), [conversation?.wallpaperId]);
  const trustLevel = !isGroup ? getPeerTrustLevel(peerId) : 'unknown';

  useEffect(() => {
    dispatch(markAsRead({ conversationId }));
    // Ensure a conversation row exists for wallpaper/disappearing to persist.
    if (!conversation) {
      dispatch(upsertConversation({
        id: conversationId, peerId, peerName, isGroup: !!isGroup,
        unreadCount: 0, muted: false, archived: false, updatedAt: Date.now(),
      }));
    }
  }, [conversationId, messages.length, dispatch]);

  // Invia read_receipt (spunte blu) al mittente dei messaggi RICEVUTI mentre la chat è aperta.
  // Una volta confermato un id non lo si re-invia (ackedRef). Per i gruppi serve la capability firmata.
  const ackedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const received = messages.filter((m) => m.senderId && m.senderId !== myId && !ackedRef.current.has(m.id));
    if (!received.length) return;
    let alive = true;
    (async () => {
      let cap: string | undefined;
      if (isGroup) { try { cap = (await groupsApi.capability(conversationId)).cap; } catch { return; } }
      if (!alive) return;
      for (const m of received) {
        ackedRef.current.add(m.id);
        socket.send({ type: 'read_receipt', to: m.senderId, messageId: m.id, conversationId, gid: isGroup ? conversationId : undefined, cap } as any);
      }
    })();
    return () => { alive = false; };
  }, [messages.length, conversationId, myId, isGroup]);

  const onType = (v: string): void => {
    setText(v);
    socket.send({ type: 'typing_start', to: peerId, conversationId });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socket.send({ type: 'typing_stop', to: peerId, conversationId }), 1500);
  };

  const send = async (): Promise<void> => {
    const body = text.trim();
    if (!body) return;
    setText('');
    const reply = replyTo;
    setReplyTo(null);
    try {
      if (isGroup) {
        await dispatch(sendToGroup({ groupId: conversationId, kind: 'text', body, replyTo: reply ?? undefined })).unwrap();
      } else {
        await dispatch(sendMessage({ conversationId, recipientId: peerId, kind: 'text', body, replyTo: reply ?? undefined })).unwrap();
      }
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e: any) {
      const reason = typeof e === 'string' ? e : (e?.message ?? 'errore sconosciuto');
      if (reason === 'device_compromised') {
        Alert.alert('Dispositivo compromesso', 'Invio disabilitato — il dispositivo risulta compromesso.');
      } else Alert.alert('Invio fallito', reason);
    }
  };

  const sendMedia = async (kind: 'image' | 'video', source: 'library' | 'camera'): Promise<void> => {
    try {
      const media = await pickMedia({ source, kind });
      if (!media) return;
      if (isGroup) {
        await dispatch(sendToGroup({ groupId: conversationId, kind, body: '', media })).unwrap();
      } else {
        await dispatch(sendMessage({ conversationId, recipientId: peerId, kind, body: '', media })).unwrap();
      }
    } catch (e: any) { Alert.alert('Allegato', e?.message ?? 'non riuscito'); }
  };

  const sendVoice = async (media: MediaRef): Promise<void> => {
    try {
      if (isGroup) {
        await dispatch(sendToGroup({ groupId: conversationId, kind: 'voice', body: '', media })).unwrap();
      } else {
        await dispatch(sendMessage({ conversationId, recipientId: peerId, kind: 'voice', body: '', media })).unwrap();
      }
    } catch (e: any) { Alert.alert('Invio fallito', e?.message ?? 'vocale'); }
  };

  const openActionSheet = (msg: Message): void => {
    HapticFeedback.trigger('impactMedium', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });
    setActionMsg(msg);
    actionSheet.current?.expand();
  };

  const openReactions = (msgId: string): void => {
    setReactTargetId(msgId);
    reactSheet.current?.expand();
  };

  const doReply = (msg: Message): void => {
    setReplyTo({
      id: msg.id, senderId: msg.senderId,
      preview: messagePreview(msg).slice(0, 80),
      kind: msg.type,
    });
  };

  const doReact = async (emoji: string): Promise<void> => {
    if (!reactTargetId) return;
    try {
      await dispatch(sendReaction({ conversationId, recipientId: peerId, targetId: reactTargetId, emoji })).unwrap();
    } catch {}
    setReactTargetId(null);
  };

  const renderRightAction = useCallback((mine: boolean) => () => (
    <View style={[styles.swipeHint, mine ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}>
      <ReplyIcon size={20} color={theme.accent} />
    </View>
  ), []);

  const bdrop = useCallback((p: any) => <BottomSheetBackdrop {...p} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.55} />, []);

  const headerTitle = (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={styles.name} numberOfLines={1}>{conversation?.peerName ?? peerName}</Text>
        {!isGroup && trustLevel !== 'unknown' && <TrustBadge level={trustLevel} compact />}
      </View>
      {typing ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <TypingDots color={theme.success} size={4} />
          <Text style={[styles.sub, { color: theme.success }]}>typing…</Text>
        </View>
      ) : (
        <Text style={styles.sub}>🔒 End-to-end encrypted{conversation?.disappearingMs ? ' · ⏱ on' : ''}</Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.c}>
      <LinearGradient colors={wallpaper.colors} style={StyleSheet.absoluteFill} />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}><Text style={styles.back}>‹</Text></Pressable>
        <Avatar name={conversation?.peerName ?? peerName} size={36} />
        {headerTitle}
        {!isGroup && (
          <>
            <Pressable onPress={() => { dispatch(initiateCall({ peerId, peerName, type: 'voice', status: 'dialing', isOutgoing: true })); navigation.navigate('Call', { peerId, peerName, type: 'voice' }); }}>
              <Text style={styles.icon}>📞</Text>
            </Pressable>
            <Pressable onPress={() => { dispatch(initiateCall({ peerId, peerName, type: 'video', status: 'dialing', isOutgoing: true })); navigation.navigate('VideoCall', { peerId, peerName, type: 'video' }); }}>
              <Text style={styles.icon}>📹</Text>
            </Pressable>
          </>
        )}
        <Pressable onPress={() => headerSheet.current?.expand()} hitSlop={10}><Text style={[styles.icon, { fontSize: 24 }]}>⋯</Text></Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingVertical: 8 }}
          renderItem={({ item }) => {
            const mine = item.senderId === myId;
            const senderContact = mine ? undefined : (contactsById[item.senderId]?.displayName ?? item.senderId.slice(0, 6));
            return (
              <Swipeable
                ref={(r) => { swipeRefs.current[item.id] = r; }}
                renderRightActions={mine ? renderRightAction(true) : undefined}
                renderLeftActions={!mine ? renderRightAction(false) : undefined}
                friction={2}
                overshootFriction={8}
                onSwipeableOpen={() => {
                  HapticFeedback.trigger('impactLight', { enableVibrateFallback: true, ignoreAndroidSystemSettings: false });
                  doReply(item);
                  swipeRefs.current[item.id]?.close();
                }}
              >
                <MessageBubble
                  message={item}
                  mine={mine}
                  senderName={isGroup ? senderContact : undefined}
                  onLongPress={() => openActionSheet(item)}
                  onPressMedia={(uri) => setLightboxUri(uri)}
                />
              </Swipeable>
            );
          }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />

        {replyTo && (
          <View style={styles.replyBar}>
            <View style={styles.replyBarLeft}>
              <ReplyIcon size={14} color={theme.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.replyBarSender}>Replying to</Text>
                <Text style={styles.replyBarPreview} numberOfLines={1}>{replyTo.preview}</Text>
              </View>
            </View>
            <Pressable onPress={() => setReplyTo(null)}><Text style={styles.replyBarClose}>✕</Text></Pressable>
          </View>
        )}

        <View style={styles.composer}>
          <Pressable style={styles.attach} onPress={() => attachSheet.current?.expand()}>
            <PlusIcon size={22} color={theme.accent} />
          </Pressable>
          <View style={styles.inputWrap}>
            <TextInput
              placeholder="Messaggio cifrato…"
              placeholderTextColor={theme.textDim}
              value={text}
              onChangeText={onType}
              style={styles.input}
              multiline
            />
          </View>
          {text.trim().length > 0 ? (
            <Pressable onPress={send} style={styles.send}><SendIcon size={20} color={theme.bg} /></Pressable>
          ) : (
            <VoiceRecorder onSend={sendVoice} />
          )}
        </View>
      </KeyboardAvoidingView>

      <ImageView images={lightboxUri ? [{ uri: lightboxUri }] : []} imageIndex={0} visible={!!lightboxUri} onRequestClose={() => setLightboxUri(null)} />

      <BottomSheet ref={attachSheet} snapPoints={['36%']} index={-1} enablePanDownToClose backdropComponent={bdrop} backgroundStyle={{ backgroundColor: theme.bgElev }} handleIndicatorStyle={{ backgroundColor: theme.border }}>
        <AttachmentMenu
          onPickCamera={() => sendMedia('image', 'camera')}
          onPickImage={() => sendMedia('image', 'library')}
          onPickVideo={() => sendMedia('video', 'library')}
          onPickFile={() => Alert.alert('Coming soon', 'File picker lands in v0.2.6')}
          onPickLocation={() => Alert.alert('Coming soon', 'Location share lands in v0.2.6')}
          onClose={() => attachSheet.current?.close()}
        />
      </BottomSheet>

      <BottomSheet ref={reactSheet} snapPoints={['20%']} index={-1} enablePanDownToClose backdropComponent={bdrop} backgroundStyle={{ backgroundColor: theme.bgElev }} handleIndicatorStyle={{ backgroundColor: theme.border }}>
        <ReactionsPicker onPick={doReact} onClose={() => reactSheet.current?.close()} />
      </BottomSheet>

      <BottomSheet ref={actionSheet} snapPoints={['36%']} index={-1} enablePanDownToClose backdropComponent={bdrop} backgroundStyle={{ backgroundColor: theme.bgElev }} handleIndicatorStyle={{ backgroundColor: theme.border }}>
        {actionMsg && (
          <View style={styles.actionSheet}>
            <Pressable style={styles.actionRow} onPress={() => { actionSheet.current?.close(); setTimeout(() => openReactions(actionMsg.id), 250); }}>
              <SmileIcon color={theme.accent} /><Text style={styles.actionLabel}>React</Text>
            </Pressable>
            <Pressable style={styles.actionRow} onPress={() => { actionSheet.current?.close(); doReply(actionMsg); }}>
              <ReplyIcon color={theme.accent} /><Text style={styles.actionLabel}>Reply</Text>
            </Pressable>
            <Pressable style={styles.actionRow} onPress={() => { Clipboard.setString(actionMsg.body ?? ''); actionSheet.current?.close(); }}>
              <CopyIcon color={theme.accent} /><Text style={styles.actionLabel}>Copy</Text>
            </Pressable>
            <Pressable style={styles.actionRow} onPress={() => { actionSheet.current?.close(); Alert.alert('Coming soon', 'Forward lands in v0.2.6'); }}>
              <ForwardIcon color={theme.accent} /><Text style={styles.actionLabel}>Forward</Text>
            </Pressable>
            <Pressable style={[styles.actionRow, { marginTop: 8 }]} onPress={() => {
              actionSheet.current?.close();
              const mine = actionMsg.senderId === myId;
              Alert.alert('Delete message', '', [
                { text: 'Delete for me', style: 'destructive', onPress: () => dispatch(deleteMessage({ conversationId, messageId: actionMsg.id, forEveryone: false })) },
                ...(mine ? [{ text: 'Delete for everyone', style: 'destructive' as const, onPress: () => dispatch(deleteMessage({ conversationId, messageId: actionMsg.id, forEveryone: true })) }] : []),
                { text: 'Cancel', style: 'cancel' },
              ]);
            }}>
              <TrashIcon color={theme.alert} /><Text style={[styles.actionLabel, { color: theme.alert }]}>Delete</Text>
            </Pressable>
          </View>
        )}
      </BottomSheet>

      <BottomSheet ref={headerSheet} snapPoints={['56%']} index={-1} enablePanDownToClose backdropComponent={bdrop} backgroundStyle={{ backgroundColor: theme.bgElev }} handleIndicatorStyle={{ backgroundColor: theme.border }}>
        <ChatHeaderMenu
          currentWallpaperId={conversation?.wallpaperId}
          onPickWallpaper={(id) => dispatch(setChatWallpaper({ conversationId, wallpaperId: id }))}
          onSetTimer={(ms) => dispatch(setDisappearingTimer({ conversationId, ms }))}
          onClear={() => { dispatch(clearConversation({ conversationId })); headerSheet.current?.close(); }}
          onClose={() => headerSheet.current?.close()}
          onVerify={isGroup && groupMembers.length <= 2 ? () => { headerSheet.current?.close(); navigation.navigate('SafetyNumber', { gid: conversationId, peerName: conversation?.peerName ?? peerName }); } : undefined}
        />
      </BottomSheet>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: theme.border, gap: 12,
    backgroundColor: '#F0F2F5',
  },
  back: { color: theme.accent, fontSize: 32, fontWeight: '300', width: 22, marginTop: -4 },
  name: { color: theme.text, fontSize: 15, fontWeight: '700' },
  sub: { color: theme.textDim, fontSize: 10, letterSpacing: 1.5, marginTop: 2 },
  icon: { fontSize: 20, paddingHorizontal: 8, color: theme.text },

  swipeHint: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },

  replyBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: theme.bgElev, borderTopWidth: 1, borderTopColor: theme.border,
    gap: 10,
  },
  replyBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  replyBarSender: { color: theme.accent, fontSize: 11, fontWeight: '700' },
  replyBarPreview: { color: theme.textDim, fontSize: 12, marginTop: 1 },
  replyBarClose: { color: theme.textDim, fontSize: 16, paddingHorizontal: 8 },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 10, paddingVertical: 10, gap: 8,
    backgroundColor: '#F0F2F5',
    borderTopWidth: 1, borderTopColor: theme.border,
  },
  attach: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: theme.bgInput, alignItems: 'center', justifyContent: 'center',
  },
  inputWrap: {
    flex: 1, backgroundColor: theme.bgInput, borderRadius: 22,
    paddingHorizontal: 6,
  },
  input: {
    color: theme.text, paddingHorizontal: 12, paddingVertical: 10,
    maxHeight: 120, minHeight: 42, fontSize: 15,
  },
  send: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center',
    ...theme.shadow.glow,
  },

  actionSheet: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 20, gap: 2 },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingVertical: 14, borderRadius: 10,
  },
  actionLabel: { color: theme.text, fontSize: 15, fontWeight: '500' },
});
