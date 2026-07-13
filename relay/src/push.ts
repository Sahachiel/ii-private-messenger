import axios from 'axios';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://backend:3000';
const INTER_NODE_SECRET = process.env.INTER_NODE_SECRET ?? '';

/**
 * Notifica push al destinatario OFFLINE (fire-and-forget). Chiamata dall'enqueue quando un
 * messaggio non è stato consegnato in tempo reale. Delega al backend, che ha il fcm_token e le
 * credenziali Firebase. Best-effort: qualunque errore è ignorato (la coda offline resta la
 * garanzia di consegna; la push è solo il "risveglio"). Payload generico per privacy.
 */
export async function notifyPush(userId: string): Promise<void> {
  if (!INTER_NODE_SECRET) return;
  try {
    await axios.post(
      `${BACKEND_URL}/api/push/notify`,
      { user_id: userId, title: 'II Private Messenger', body: 'Nuovo messaggio' },
      { headers: { 'X-Internal-Secret': INTER_NODE_SECRET }, timeout: 4000 },
    );
  } catch {
    /* best-effort: la consegna è comunque garantita dalla coda offline */
  }
}
