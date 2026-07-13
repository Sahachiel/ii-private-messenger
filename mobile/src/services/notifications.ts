import notifee, { AndroidImportance, AuthorizationStatus, EventType } from '@notifee/react-native';
import { Platform } from 'react-native';
import { appKv } from './keychain';

/**
 * Notifiche SOVRANE — nessun Google/Firebase (FCM rimosso).
 *
 * Meccanismo: un FOREGROUND SERVICE (notifee) tiene vivo il processo dell'app in background, così
 * il WebSocket verso il NOSTRO relay resta connesso e i messaggi arrivano in tempo reale → mostriamo
 * una notifica locale. Zero dipendenza da Google Play Services: gira anche su Android de-googlato.
 *
 * ONESTÀ (limiti): se l'utente/OEM forza-chiude l'app o un battery-manager aggressivo uccide il
 * servizio, la connessione cade finché l'app non viene riaperta. FCM sveglierebbe un'app uccisa via
 * Google — noi rinunciamo a quella comodità in cambio della sovranità. Su iOS il push in background
 * passa comunque da Apple (APNs), non eliminabile: là si userà un push APNS senza contenuto.
 */

// Privacy: di default le notifiche NON mostrano mittente né testo (solo "Nuovo messaggio").
const KEY_HIDE = 'notify.hideContent';
export function isNotifyContentHidden(): boolean { return appKv.getBoolean(KEY_HIDE) ?? true; }
export function setNotifyContentHidden(v: boolean): void { appKv.set(KEY_HIDE, v); }

let fgRegistered = false;
let fgRunning = false;

export async function requestNotificationPermission(): Promise<boolean> {
  const settings = await notifee.requestPermission();
  return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
}

export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({ id: 'messages', name: 'Messaggi', importance: AndroidImportance.HIGH, sound: 'default', vibration: true });
  await notifee.createChannel({ id: 'calls', name: 'Chiamate', importance: AndroidImportance.HIGH, sound: 'ringtone', vibration: true });
  await notifee.createChannel({ id: 'service', name: 'Connessione', importance: AndroidImportance.LOW });
}

/**
 * Avvia il foreground service che mantiene viva la connessione al relay (push sovrana).
 * La task del service non si risolve mai: tiene vivo il processo; il WebSocket vero gira nel JS.
 */
export async function startBackgroundConnection(): Promise<void> {
  if (Platform.OS !== 'android' || fgRunning) return;
  if (!fgRegistered) {
    notifee.registerForegroundService(() => new Promise(() => { /* mantiene vivo il servizio */ }));
    fgRegistered = true;
  }
  try {
    await notifee.displayNotification({
      title: 'II Private Messenger',
      body: 'Connesso — ricezione messaggi attiva',
      android: {
        channelId: 'service',
        asForegroundService: true,
        // Android 14 (targetSdk 34) ESIGE un foregroundServiceType per startForeground: notifee 7.8.2 non
        // espone il campo lato JS, quindi il tipo ('dataSync' = connessione WebSocket) è dichiarato sul
        // service nel AndroidManifest (override di app.notifee.core.ForegroundService) + permesso dedicato.
        ongoing: true,
        smallIcon: 'ic_launcher',
        pressAction: { id: 'default' },
      },
    });
    fgRunning = true;
  } catch { /* alcune build/OEM negano il foreground service: l'app funziona in foreground */ }
}

export async function stopBackgroundConnection(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try { await notifee.stopForegroundService(); } catch { /* */ }
  fgRunning = false;
}

export async function displayMessageNotification(title: string, body: string): Promise<void> {
  const hide = isNotifyContentHidden();
  await notifee.displayNotification({
    title: hide ? 'II Private Messenger' : title,
    body: hide ? 'Nuovo messaggio' : body,
    android: { channelId: 'messages', smallIcon: 'ic_launcher', pressAction: { id: 'default' } },
    ios: { sound: 'default' },
  });
}

export async function displayIncomingCall(from: string, callType: 'voice' | 'video'): Promise<void> {
  const hide = isNotifyContentHidden();
  await notifee.displayNotification({
    title: callType === 'video' ? 'Videochiamata in arrivo' : 'Chiamata in arrivo',
    body: hide ? 'Tocca per rispondere' : from,
    android: { channelId: 'calls', smallIcon: 'ic_launcher', ongoing: true, fullScreenAction: { id: 'default' } },
    ios: { sound: 'ringtone', critical: true },
  });
}

export function onNotificationInteraction(cb: (data?: any) => void): () => void {
  return notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS) cb(detail.notification?.data);
  });
}
