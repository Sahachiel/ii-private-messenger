import { useEffect } from 'react';
import { Alert } from 'react-native';
import { socket } from '@services/socket';
import { groupsApi } from '@services/api';
import { useAppDispatch, useAppSelector } from '@store/index';
import { decryptIncoming, updateMessageStatus, setTyping, addMessage } from '@store/chatSlice';
import { receiveCall, answerCall, addIceCandidate, setRemoteSDP, endCall } from '@store/callSlice';
import { navigate } from '../navigation/navRef';
import { appKv } from '@services/keychain';

export function useSocket(): void {
  const dispatch = useAppDispatch();
  const relayUrl = useAppSelector((s) => s.auth.relayUrl);
  const token = useAppSelector((s) => s.auth.accessToken);

  useEffect(() => {
    if (!relayUrl || !token) return;
    socket.connect(relayUrl, token);
    const off = socket.on((ev) => {
      switch (ev.type) {
        case 'message': {
          if (!ev.from || !ev.ciphertext || !ev.messageId) break;
          let payload: any;
          try { payload = JSON.parse(ev.ciphertext); } catch { break; }
          // ev.gid presente ⇒ messaggio di gruppo (sender key); assente ⇒ 1:1 pairwise.
          dispatch(decryptIncoming({ from: ev.from, payload, messageId: ev.messageId, conversationId: ev.gid }));
          break;
        }
        case 'delivery_receipt': {
          const st = (window as any);
          void st;
          // Redux thunk would be cleaner; we iterate via dispatch
          // No-op; chatSlice matches on messageId via updateMessageStatus callers
          break;
        }
        case 'read_receipt':
          if (ev.messageId && ev.conversationId) {
            dispatch(updateMessageStatus({ conversationId: ev.conversationId, messageId: ev.messageId, status: 'read' }));
          }
          break;
        case 'delivery_receipt':
          // chatSlice matches on messageId scan in reducer below — emit a thunk later if needed
          break;
        case 'typing_start':
          if (ev.from) dispatch(setTyping({ userId: ev.from, active: true }));
          break;
        case 'typing_stop':
          if (ev.from) dispatch(setTyping({ userId: ev.from, active: false }));
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
                  const gid = (res as any)?.gid;
                  if (gid) navigate('Chat', { conversationId: gid, peerId: gid, peerName: nm, isGroup: true });
                } catch { /* invito scaduto/non valido */ }
              } },
            ],
          );
          break;
        }
      }
    });
    return () => { off(); socket.disconnect(); };
  }, [relayUrl, token, dispatch]);
}

export function useSocketPresence(): void {
  const isAuth = useAppSelector((s) => s.auth.isAuthenticated);
  const myId = appKv.getString('auth.userId');
  useEffect(() => { void isAuth; void myId; }, [isAuth, myId]);
}
