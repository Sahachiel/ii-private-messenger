import React, { useEffect } from 'react';
import { StatusBar, Linking } from 'react-native';
import { Provider } from 'react-redux';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { store } from '@store/index';
import { RootNavigator } from '@/navigation/RootNavigator';
import { AppLockGate } from '@components/AppLockGate';
import { navigate } from '@/navigation/navRef';
import { theme } from '@utils/theme';
import { ensureChannels, requestNotificationPermission, registerFcm } from '@services/notifications';
import { groupsApi } from '@services/api';
import { mtd } from '@/xsec-mtd/engine/MTDEngine';
import { loadPolicy } from '@/xsec-mtd/policy';
import { KC, appKv, getSecureKv } from '@services/keychain';
import { applyScreenProtect } from '@services/screenSecurity';
import { sweepExpiredNow, upsertConversation } from '@store/chatSlice';
import { upsertGroup } from '@store/groupsSlice';
import { sweepExpired as sweepStories } from '@store/storiesSlice';

// Deep link iimsg://join?t=<token>: entra nel gruppo/contatto e apre la chat. Best-effort
// (richiede sessione attiva; se non autenticato il join fallisce e viene ignorato).
async function handleJoinToken(token: string): Promise<void> {
  try {
    const res = await groupsApi.join(token);
    if (!res?.gid) return;
    const gid = res.gid;
    const myId = appKv.getString('auth.userId') ?? '';
    let members: string[] = [myId];
    try { members = (await groupsApi.members(gid)).map((m) => m.user_id); } catch { /* placeholder */ }
    const nm = 'Nuovo contatto';
    store.dispatch(upsertGroup({ id: gid, name: nm, memberIds: members, adminIds: [], createdAt: Date.now(), createdBy: '' }));
    store.dispatch(upsertConversation({ id: gid, peerId: gid, peerName: nm, isGroup: true, unreadCount: 0, muted: false, archived: false, updatedAt: Date.now() }));
    navigate('Chat', { conversationId: gid, peerId: gid, peerName: nm, isGroup: true });
  } catch { /* invito non valido o sessione assente */ }
}
function onDeepLink(url: string | null): void {
  if (!url) return;
  const m = url.match(/[?&]t=([^&\s]+)/);
  if (!m) return;
  try { void handleJoinToken(decodeURIComponent(m[1])); } catch { /* ignore */ }
}

export default function App() {
  useEffect(() => {
    (async () => {
      await applyScreenProtect(); // FLAG_SECURE secondo preferenza (default ON)
      await ensureChannels();
      const ok = await requestNotificationPermission();
      if (ok) await registerFcm();
    })();
    // Start on-device threat detection engine
    mtd.start();

    // Auto-wipe hook (opt-in) — fires on compromise state change
    const offState = mtd.onStateChange(async (s) => {
      if (s !== 'compromised') return;
      if (!loadPolicy().autoWipeOnCompromise) return;
      try {
        await KC.clearToken(); await KC.clearCreds(); await KC.clearIdentity();
        (await getSecureKv()).clearAll();
        appKv.clearAll();
      } catch {}
    });
    // Periodic TTL garbage collection — removes disappearing messages whose
    // expiresAt is past, plus stories past their 24h TTL. Every 30s is a low
    // enough cadence to be imperceptible, high enough to feel responsive.
    const sweepTimer = setInterval(() => {
      store.dispatch(sweepExpiredNow());
      store.dispatch(sweepStories());
    }, 30_000);

    // Deep link iimsg://join?t=… — link di invito ricevuto (cold start + a runtime).
    Linking.getInitialURL().then(onDeepLink).catch(() => {});
    const linkSub = Linking.addEventListener('url', (e) => onDeepLink(e.url));

    return () => { mtd.stop(); offState(); clearInterval(sweepTimer); linkSub.remove(); };
  }, []);

  return (
    <Provider store={store}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg }}>
        <SafeAreaProvider>
          <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
          <AppLockGate>
            <RootNavigator />
          </AppLockGate>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Provider>
  );
}
