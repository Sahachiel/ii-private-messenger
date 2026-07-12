import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { Provider } from 'react-redux';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { store } from '@store/index';
import { RootNavigator } from '@/navigation/RootNavigator';
import { AppLockGate } from '@components/AppLockGate';
import { theme } from '@utils/theme';
import { ensureChannels, requestNotificationPermission, registerFcm } from '@services/notifications';
import { mtd } from '@/xsec-mtd/engine/MTDEngine';
import { loadPolicy } from '@/xsec-mtd/policy';
import { KC, appKv, getSecureKv } from '@services/keychain';
import { sweepExpiredNow } from '@store/chatSlice';
import { sweepExpired as sweepStories } from '@store/storiesSlice';

export default function App() {
  useEffect(() => {
    (async () => {
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

    return () => { mtd.stop(); offState(); clearInterval(sweepTimer); };
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
