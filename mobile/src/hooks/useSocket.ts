import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';
import { socket } from '@services/socket';
import { groupsApi, contactsApi } from '@services/api';
import { useAppDispatch, useAppSelector } from '@store/index';
import { decryptIncoming, updateMessageStatus, setTyping, addMessage, upsertConversation } from '@store/chatSlice';
import { receiveCall, answerCall, addIceCandidate, setRemoteSDP, endCall } from '@store/callSlice';
import { upsertGroup } from '@store/groupsSlice';
import { navigate } from '../navigation/navRef';
import { appKv } from '@services/keychain';
import { displayMessageNotification, displayIncomingCall, startBackgroundConnection, stopBackgroundConnection } from '@services/notifications';
import { store } from '@store/index';

export function useSocket(): void {
  const dispatch = useAppDispatch();
  const relayUrl = useAppSelector((s) => s.auth.relayUrl);
  const token = useAppSelector((s) => s.auth.accessToken);

  useEffect(() => {
    if (!relayUrl || !token) return;
    socket.connect(relayUrl, token);
    // Push sovrana: foreground service che tiene viva la connessione al relay in background (no FCM).
    void startBackgroundConnection();
    const off = socket.on((ev) => {
      switch (ev.type) {
        case 'message': {
          if (!ev.from || !ev.ciphertext || !ev.messageId) break;
          let payload: any;
          try { payload = JSON.parse(ev.ciphertext); } catch { break; }
          // ev.gid presente ⇒ messaggio di gruppo (sender key); assente ⇒ 1:1 pairwise.
          const cid = ev.gid ?? ev.from;
          dispatch(decryptIncoming({ from: ev.from, payload, messageId: ev.messageId, conversationId: ev.gid }))
            .unwrap()
            .then((res: any) => {
              // Notifica locale solo se l'app NON è in primo piano e il messaggio è reale
              // (non una distribuzione sender-key/di sistema). Rispetta il default "senza contenuto".
              if (AppState.currentState === 'active' || !res?.envelope) return;
              const conv = store.getState().chat.conversations[cid];
              const title = conv?.peerName || 'Nuovo messaggio';
              const k = res.envelope.kind;
              const body = k === 'voice' ? '🎤 Messaggio vocale' : k === 'image' ? '📷 Foto'
                : k === 'video' ? '🎬 Video' : k === 'file' ? '📎 File' : k === 'location' ? '📍 Posizione'
                : (res.envelope.body || 'Messaggio');
              displayMessageNotification(title, body);
            })
            .catch(() => {});
          break;
        }
        case 'delivery_receipt': {
          // Il relay conferma al mittente la consegna → spunta ✓✓ "consegnato".
          const cid = ev.gid ?? ev.conversationId;
          if (ev.messageId && cid) {
            dispatch(updateMessageStatus({ conversationId: cid, messageId: ev.messageId, status: 'delivered' }));
          }
          break;
        }
        case 'read_receipt': {
          // Il destinatario ha letto → spunta ✓✓ blu "letto".
          const cid = ev.gid ?? ev.conversationId;
          if (ev.messageId && cid) {
            dispatch(updateMessageStatus({ conversationId: cid, messageId: ev.messageId, status: 'read' }));
          }
          break;
        }
        case 'typing_start':
          if (ev.from) dispatch(setTyping({ userId: ev.conversationId ?? ev.from, active: true }));
          break;
        case 'typing_stop':
          if (ev.from) dispatch(setTyping({ userId: ev.conversationId ?? ev.from, active: false }));
          break;
        case 'call_offer':
          if (ev.from && ev.callType && ev.sdp) {
            let sdp: any; try { sdp = JSON.parse(ev.sdp); } catch { sdp = ev.sdp; }
            const isVideo = ev.callType === 'video';
            dispatch(receiveCall({
              call: { peerId: ev.from, peerName: ev.from, type: ev.callType, status: 'ringing', isOutgoing: false },
              sdp,
            }));
            // Apri la schermata chiamata (prima si fermava allo stato redux → nessuna UI, impossibile rispondere).
            navigate(isVideo ? 'VideoCall' : 'Call', { peerId: ev.from, peerName: ev.from });
            // In background mostra la notifica di chiamata (suoneria + tocco per rispondere).
            if (AppState.currentState !== 'active') {
              const conv = store.getState().chat.conversations[ev.from];
              displayIncomingCall(conv?.peerName || 'Contatto', ev.callType);
            }
          }
          break;
        case 'call_answer':
          if (ev.sdp) {
            let sdp: any; try { sdp = JSON.parse(ev.sdp); } catch { sdp = ev.sdp; }
            dispatch(setRemoteSDP(sdp));
            dispatch(answerCall());
          }
          break;
        case 'ice_candidate':
          if (ev.candidate) dispatch(addIceCandidate(ev.candidate));
          break;
        case 'call_end':
          dispatch(endCall());
          break;
        case 'contact_invite': {
          // Richiesta di contatto seamless: qualcuno ci ha trovati col codice e ci invita.
          if (!ev.token) break;
          const nm = ev.fromName || 'Qualcuno';
          Alert.alert(
            'Richiesta di contatto',
            `${nm} vuole contattarti su II Private Messenger.`,
            [
              { text: 'Ignora', style: 'cancel' },
              { text: 'Accetta', onPress: async () => {
                try {
                  const res = await groupsApi.join(ev.token as string);
                  const gid = res?.gid;
                  if (!gid) return;
                  const myId = appKv.getString('auth.userId') ?? '';
                  let members: string[] = [myId];
                  try { members = (await groupsApi.members(gid)).map((m) => m.user_id); } catch { /* placeholder */ }
                  dispatch(upsertGroup({ id: gid, name: nm, memberIds: members, adminIds: [], createdAt: Date.now(), createdBy: ev.from ?? '' }));
                  dispatch(upsertConversation({ id: gid, peerId: gid, peerName: nm, isGroup: true, unreadCount: 0, muted: false, archived: false, updatedAt: Date.now() }));
                  // Registra chi ci ha aggiunti nella rubrica (grafo contatti reale, bidirezionale).
                  if (ev.from) contactsApi.add(ev.from).catch(() => {});
                  navigate('Chat', { conversationId: gid, peerId: gid, peerName: nm, isGroup: true });
                } catch { /* invito scaduto/non valido */ }
              } },
            ],
          );
          break;
        }
      }
    });
    return () => { off(); socket.disconnect(); void stopBackgroundConnection(); };
  }, [relayUrl, token, dispatch]);
}

export function useSocketPresence(): void {
  const isAuth = useAppSelector((s) => s.auth.isAuthenticated);
  const myId = appKv.getString('auth.userId');
  useEffect(() => { void isAuth; void myId; }, [isAuth, myId]);
}
