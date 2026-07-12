import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { isLockEnabled, shouldLockOnForeground, markBackground, authenticate, getSupportedBiometry } from '@services/appLock';
import { LockScreen } from '@screens/LockScreen';

/**
 * Gate del blocco app. Copre i contenuti con la LockScreen quando l'app è bloccata:
 *  - avvio a freddo con blocco attivo → bloccato + prompt biometrico automatico;
 *  - andata in background → marca il timestamp e (se attivo) blocca subito, così lo snapshot
 *    dell'app-switcher e il rientro non mostrano contenuti (con FLAG_SECURE lo snapshot è già oscurato);
 *  - rientro in foreground → se oltre la "grace" richiede lo sblocco, altrimenti sblocca da solo.
 */
export const AppLockGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locked, setLocked] = useState<boolean>(() => isLockEnabled());
  const [biometry, setBiometry] = useState<string | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const tryUnlock = useCallback(async () => {
    const ok = await authenticate();
    if (ok) setLocked(false);
  }, []);

  useEffect(() => {
    getSupportedBiometry().then(setBiometry).catch(() => {});
    if (isLockEnabled()) { setLocked(true); void tryUnlock(); }
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appState.current;
      appState.current = next;
      if (next === 'background' || next === 'inactive') {
        markBackground();
        if (isLockEnabled()) setLocked(true);
      } else if (next === 'active' && (prev === 'background' || prev === 'inactive')) {
        if (!isLockEnabled()) { setLocked(false); return; }
        if (shouldLockOnForeground()) { setLocked(true); void tryUnlock(); }
        else setLocked(false);
      }
    });
    return () => sub.remove();
  }, [tryUnlock]);

  return (
    <>
      {children}
      {locked && <LockScreen onUnlock={tryUnlock} biometry={biometry} />}
    </>
  );
};
