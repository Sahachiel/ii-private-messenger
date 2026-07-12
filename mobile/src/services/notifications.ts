import notifee, { AndroidImportance, AuthorizationStatus, EventType } from '@notifee/react-native';
import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import firebase from '@react-native-firebase/app';
import { Platform } from 'react-native';
import { usersApi } from './api';

// Firebase è OPZIONALE: se l'APK è compilato senza google-services.json non esiste il
// FirebaseApp di default e qualunque chiamata a messaging() lancia ("Default FirebaseApp is
// not initialized"). Prima l'app chiamava messaging().requestPermission() allo startup →
// crash immediato del release. Ora ogni uso di messaging() è protetto: senza Firebase l'app
// funziona lo stesso, solo senza notifiche push.
function firebaseReady(): boolean {
  try {
    return firebase.apps.length > 0;
  } catch {
    return false;
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  // notifee gestisce il permesso su iOS e Android 13+ SENZA dipendere da Firebase.
  const settings = await notifee.requestPermission();
  return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
}

export async function registerFcm(): Promise<string | null> {
  if (!firebaseReady()) return null;
  try {
    await messaging().registerDeviceForRemoteMessages();
    const token = await messaging().getToken();
    if (token) {
      try { await usersApi.updateFcmToken(token); } catch {}
      return token;
    }
  } catch {}
  return null;
}

export function onTokenRefresh(cb: (t: string) => void): () => void {
  if (!firebaseReady()) return () => {};
  return messaging().onTokenRefresh(async (t) => {
    try { await usersApi.updateFcmToken(t); } catch {}
    cb(t);
  });
}

export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({
    id: 'messages', name: 'Messages', importance: AndroidImportance.HIGH, sound: 'default', vibration: true,
  });
  await notifee.createChannel({
    id: 'calls', name: 'Calls', importance: AndroidImportance.HIGH, sound: 'ringtone', vibration: true,
  });
}

export async function displayMessageNotification(title: string, body: string): Promise<void> {
  await notifee.displayNotification({
    title, body,
    android: { channelId: 'messages', smallIcon: 'ic_launcher', pressAction: { id: 'default' } },
    ios: { sound: 'default' },
  });
}

export async function displayIncomingCall(from: string, callType: 'voice' | 'video'): Promise<void> {
  await notifee.displayNotification({
    title: callType === 'video' ? 'Incoming video call' : 'Incoming call',
    body: from,
    android: { channelId: 'calls', smallIcon: 'ic_launcher', ongoing: true, fullScreenAction: { id: 'default' } },
    ios: { sound: 'ringtone', critical: true },
  });
}

export function onForegroundMessage(handler: (m: FirebaseMessagingTypes.RemoteMessage) => void): () => void {
  if (!firebaseReady()) return () => {};
  return messaging().onMessage(async (m) => handler(m));
}

export function onBackgroundMessage(handler: (m: FirebaseMessagingTypes.RemoteMessage) => Promise<void>): void {
  if (!firebaseReady()) return;
  messaging().setBackgroundMessageHandler(handler);
}

export function onNotificationInteraction(cb: (data?: any) => void): () => void {
  return notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS) cb(detail.notification?.data);
  });
}
