import admin from 'firebase-admin';
import { config } from '../config';

let initialized = false;
let disabled = false;

function init(): void {
  if (initialized || disabled) return;
  const raw = config.firebaseServiceAccountJson;
  if (!raw) {
    disabled = true;
    // eslint-disable-next-line no-console
    console.warn('[push] FIREBASE_SERVICE_ACCOUNT_JSON not set — push disabled');
    return;
  }
  try {
    const serviceAccount = JSON.parse(raw) as admin.ServiceAccount;
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    initialized = true;
  } catch (e) {
    disabled = true;
    // eslint-disable-next-line no-console
    console.error('[push] Failed to init firebase-admin:', (e as Error).message);
  }
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendPush(fcmToken: string, payload: PushPayload): Promise<boolean> {
  init();
  if (disabled || !initialized) return false;
  if (!fcmToken) return false;

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title: payload.title, body: payload.body },
      data: payload.data ?? {},
      android: { priority: 'high' },
      apns: { headers: { 'apns-priority': '10' } },
    });
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[push] send failed:', (e as Error).message);
    return false;
  }
}
