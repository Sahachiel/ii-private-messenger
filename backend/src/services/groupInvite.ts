/**
 * Inviti di gruppo blindati + transizioni di membership con rotazione epoch.
 *
 * Sicurezza (dai requisiti + review avversariale):
 *  - Token = capability firmata Ed25519 (chiave server su disco 0600, fuori dal DB —
 *    stesso pattern di mtdAdmin.ts). In DB solo l'hash SHA-256 del token, mai il token.
 *  - Firma PER-TIPO: il payload contiene `t` ('gi' invito | 'cap' membership-capability);
 *    verifyToken rifiuta un tipo inatteso → niente confusione invito/pairing.
 *  - NESSUN metadato sensibile nel token (no nome gruppo, no inviter): solo gid opaco,
 *    jti, scadenza, e bind opzionale al destinatario.
 *  - Blindatura: bound_user_id (l'invito vale solo per quell'UUID) e/o requires_approval
 *    (l'ingresso richiede l'ok di un admin). Consumo monouso ATOMICO (used_count<max_uses).
 *  - Forward secrecy: ogni join/leave/kick fa epoch++ ATOMICO sulla conversazione, così i
 *    client ruotano la Sender Key e l'ex-membro non decifra i messaggi nuovi.
 *  - La stessa chiave firma anche le membership-capability che il relay verificherà (Blocco C).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/client';

const KEY_DIR = process.env.GROUP_SIGNING_KEY_DIR ?? '/app/group-keys';
const KEY_FILE = 'group-signing.key';

let privKey: crypto.KeyObject | null = null;
let pubKey: crypto.KeyObject | null = null;
let pubB64 = '';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function sha256hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}
function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Codici d'errore mappati a HTTP dal router. */
export class GroupError extends Error {
  constructor(public code: string, public httpStatus = 400) {
    super(code);
  }
}

/** Genera/carica la chiave Ed25519 di firma (idempotente al boot). */
export function ensureGroupSigningKey(): { publicKeyB64: string } {
  const privPath = path.join(KEY_DIR, KEY_FILE);
  if (fs.existsSync(privPath)) {
    privKey = crypto.createPrivateKey(fs.readFileSync(privPath, 'utf8'));
  } else {
    const kp = crypto.generateKeyPairSync('ed25519');
    fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(privPath, kp.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
    privKey = kp.privateKey;
    // eslint-disable-next-line no-console
    console.log(`[group-signing] generated Ed25519 signing key at ${privPath}`);
  }
  pubKey = crypto.createPublicKey(privKey);
  const der = pubKey.export({ format: 'der', type: 'spki' }) as Buffer;
  pubB64 = der.subarray(der.length - 32).toString('base64');
  return { publicKeyB64: pubB64 };
}

/** Chiave pubblica (base64 raw32) — la userà il relay per verificare le capability. */
export function getGroupSigningPublicKey(): string {
  if (!pubB64) ensureGroupSigningKey();
  return pubB64;
}

function signToken(payload: Record<string, unknown>): string {
  if (!privKey) ensureGroupSigningKey();
  const b64p = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = crypto.sign(null, Buffer.from(b64p), privKey as crypto.KeyObject);
  return `${b64p}.${b64url(sig)}`;
}

function verifyToken(token: string, expectedType: string): Record<string, any> {
  if (!pubKey) ensureGroupSigningKey();
  const parts = token.split('.');
  if (parts.length !== 2) throw new GroupError('invite_malformed', 400);
  const [b64p, b64s] = parts;
  const ok = crypto.verify(null, Buffer.from(b64p), pubKey as crypto.KeyObject, fromB64url(b64s));
  if (!ok) throw new GroupError('invite_bad_signature', 400);
  let payload: Record<string, any>;
  try { payload = JSON.parse(fromB64url(b64p).toString('utf8')); } catch { throw new GroupError('invite_malformed', 400); }
  if (payload.t !== expectedType) throw new GroupError('invite_wrong_type', 400);
  if (typeof payload.exp !== 'number' || payload.exp < nowSec()) throw new GroupError('invite_expired', 410);
  return payload;
}

// ---------- gruppi ----------

export async function createGroup(createdBy: string, maxMembers = 50): Promise<{ id: string; epoch: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query(
      `INSERT INTO conversations (is_group, created_by, max_members) VALUES (TRUE, $1, $2) RETURNING id, epoch`,
      [createdBy, maxMembers],
    );
    const row = c.rows[0] as { id: string; epoch: number };
    await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role, member_epoch, status)
       VALUES ($1, $2, 'owner', $3, 'active')`,
      [row.id, createdBy, row.epoch],
    );
    await client.query(
      `INSERT INTO group_audit (conversation_id, actor_id, action, target_id, epoch) VALUES ($1,$2,'create',$2,$3)`,
      [row.id, createdBy, row.epoch],
    );
    await client.query('COMMIT');
    return { id: row.id, epoch: row.epoch };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function isMember(gid: string, userId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND status='active' LIMIT 1`,
    [gid, userId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function isAdmin(gid: string, userId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM conversation_members
      WHERE conversation_id=$1 AND user_id=$2 AND status='active' AND role IN ('owner','admin') LIMIT 1`,
    [gid, userId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function listMembers(gid: string): Promise<Array<{ user_id: string; role: string; member_epoch: number }>> {
  const r = await pool.query(
    `SELECT user_id, role, member_epoch FROM conversation_members
      WHERE conversation_id=$1 AND status='active' ORDER BY joined_at ASC`,
    [gid],
  );
  return r.rows as Array<{ user_id: string; role: string; member_epoch: number }>;
}

export async function listMyGroups(userId: string): Promise<Array<{ id: string; role: string; epoch: number; member_count: number }>> {
  const r = await pool.query(
    `SELECT c.id, cm.role, c.epoch,
            (SELECT COUNT(*) FROM conversation_members m WHERE m.conversation_id=c.id AND m.status='active') AS member_count
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.user_id=$1 AND cm.status='active' AND c.is_group=TRUE AND c.deleted_at IS NULL`,
    [userId],
  );
  return r.rows.map((x: any) => ({ id: x.id, role: x.role, epoch: x.epoch, member_count: Number(x.member_count) }));
}

/** Aggiunge un membro con epoch++ atomico. Riusato da consumeInvite e approveJoinRequest. */
async function addMemberWithEpochBump(gid: string, userId: string, invitedVia: string | null): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const e = await client.query(
      `UPDATE conversations SET epoch = epoch + 1 WHERE id=$1 AND deleted_at IS NULL RETURNING epoch`,
      [gid],
    );
    if (e.rowCount === 0) { await client.query('ROLLBACK'); throw new GroupError('group_not_found', 404); }
    const newEpoch = (e.rows[0] as { epoch: number }).epoch;
    await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role, member_epoch, status, invited_via)
       VALUES ($1,$2,'member',$3,'active',$4)
       ON CONFLICT (conversation_id, user_id)
       DO UPDATE SET status='active', member_epoch=$3, invited_via=$4`,
      [gid, userId, newEpoch, invitedVia],
    );
    await client.query(
      `INSERT INTO group_audit (conversation_id, actor_id, action, target_id, epoch) VALUES ($1,$2,'join',$2,$3)`,
      [gid, userId, newEpoch],
    );
    await client.query('COMMIT');
    return newEpoch;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ---------- inviti ----------

export async function createInvite(
  gid: string,
  createdBy: string,
  opts: { boundUserId?: string | null; requiresApproval?: boolean; maxUses?: number; ttlSeconds?: number },
): Promise<{ token: string; expiresAt: number }> {
  const ce = await pool.query(`SELECT epoch FROM conversations WHERE id=$1 AND deleted_at IS NULL`, [gid]);
  if (ce.rowCount === 0) throw new GroupError('group_not_found', 404);
  const epoch = (ce.rows[0] as { epoch: number }).epoch;

  const jti = crypto.randomUUID();
  const ttl = opts.ttlSeconds ?? 7 * 24 * 3600;
  const exp = nowSec() + ttl;
  const bnd = opts.boundUserId ?? null;
  const token = signToken({ t: 'gi', gid, jti, exp, bnd });
  const tokenHash = sha256hex(token);

  await pool.query(
    `INSERT INTO group_invites
       (conversation_id, created_by, token_hash, bound_user_id, requires_approval, max_uses, bound_epoch, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, to_timestamp($8))`,
    [gid, createdBy, tokenHash, bnd, opts.requiresApproval ?? true, opts.maxUses ?? 1, epoch, exp],
  );
  return { token, expiresAt: exp };
}

export async function revokeInvite(gid: string, inviteId: string): Promise<void> {
  await pool.query(
    `UPDATE group_invites SET revoked_at=NOW() WHERE id=$1 AND conversation_id=$2 AND revoked_at IS NULL`,
    [inviteId, gid],
  );
}

/**
 * Consuma un invito. Ritorna 'joined' (entrato) o 'pending' (in attesa di approvazione)
 * o 'already_member'. Applica bind al destinatario, monouso atomico, e epoch++ all'ingresso.
 */
export async function consumeInvite(token: string, joiningUserId: string): Promise<{ status: 'joined' | 'pending' | 'already_member'; gid: string }> {
  const payload = verifyToken(token, 'gi');
  const gid = String(payload.gid);
  if (payload.bnd && payload.bnd !== joiningUserId) throw new GroupError('invite_bound_other', 403);

  const tokenHash = sha256hex(token);
  const inv = await pool.query(
    `SELECT id, requires_approval, max_uses, used_count, revoked_at, expires_at
       FROM group_invites WHERE token_hash=$1 AND conversation_id=$2`,
    [tokenHash, gid],
  );
  if (inv.rowCount === 0) throw new GroupError('invite_not_found', 404);
  const row = inv.rows[0] as { id: string; requires_approval: boolean; max_uses: number; used_count: number; revoked_at: string | null };
  if (row.revoked_at) throw new GroupError('invite_revoked', 410);

  if (await isMember(gid, joiningUserId)) return { status: 'already_member', gid };

  if (row.requires_approval) {
    await pool.query(
      `INSERT INTO group_join_requests (conversation_id, user_id, invite_id, status)
       VALUES ($1,$2,$3,'pending')
       ON CONFLICT (conversation_id, user_id)
       DO UPDATE SET status='pending', invite_id=$3, created_at=NOW()
       WHERE group_join_requests.status <> 'approved'`,
      [gid, joiningUserId, row.id],
    );
    return { status: 'pending', gid };
  }

  // Consumo atomico monouso/quota
  const used = await pool.query(
    `UPDATE group_invites SET used_count = used_count + 1
      WHERE id=$1 AND used_count < max_uses AND revoked_at IS NULL AND expires_at > NOW()
      RETURNING id`,
    [row.id],
  );
  if (used.rowCount === 0) throw new GroupError('invite_exhausted', 410);

  await addMemberWithEpochBump(gid, joiningUserId, row.id);
  return { status: 'joined', gid };
}

export async function listJoinRequests(gid: string): Promise<Array<{ user_id: string; created_at: string }>> {
  const r = await pool.query(
    `SELECT user_id, created_at FROM group_join_requests
      WHERE conversation_id=$1 AND status='pending' ORDER BY created_at ASC`,
    [gid],
  );
  return r.rows as Array<{ user_id: string; created_at: string }>;
}

export async function decideJoinRequest(gid: string, targetUserId: string, adminId: string, approve: boolean): Promise<{ epoch: number | null }> {
  const r = await pool.query(
    `SELECT id, invite_id FROM group_join_requests WHERE conversation_id=$1 AND user_id=$2 AND status='pending'`,
    [gid, targetUserId],
  );
  if (r.rowCount === 0) throw new GroupError('request_not_found', 404);
  const reqRow = r.rows[0] as { id: string; invite_id: string | null };

  if (!approve) {
    await pool.query(
      `UPDATE group_join_requests SET status='denied', decided_at=NOW(), decided_by=$3
        WHERE conversation_id=$1 AND user_id=$2`,
      [gid, targetUserId, adminId],
    );
    return { epoch: null };
  }

  // FIX quota: la "spesa" dell'invito avviene QUI (all'approvazione), in modo atomico.
  // Senza questo, con requires_approval=true il max_uses era totalmente aggirabile.
  if (reqRow.invite_id) {
    const used = await pool.query(
      `UPDATE group_invites SET used_count = used_count + 1
        WHERE id=$1 AND used_count < max_uses AND revoked_at IS NULL AND expires_at > NOW()
        RETURNING id`,
      [reqRow.invite_id],
    );
    if (used.rowCount === 0) throw new GroupError('invite_exhausted', 410);
  }

  const newEpoch = await addMemberWithEpochBump(gid, targetUserId, reqRow.invite_id);
  await pool.query(
    `UPDATE group_join_requests SET status='approved', decided_at=NOW(), decided_by=$3
      WHERE conversation_id=$1 AND user_id=$2`,
    [gid, targetUserId, adminId],
  );
  return { epoch: newEpoch };
}

/** Uscita volontaria: epoch++ così i rimasti ruotano la Sender Key (forward secrecy). */
export async function leaveGroup(gid: string, userId: string): Promise<number> {
  return statusTransition(gid, userId, 'left', userId, 'leave');
}

/** Espulsione (admin): epoch++ → l'ex-membro non decifra i messaggi nuovi. */
export async function removeMember(gid: string, targetId: string, adminId: string): Promise<number> {
  return statusTransition(gid, targetId, 'removed', adminId, 'kick');
}

async function statusTransition(gid: string, targetId: string, newStatus: string, actorId: string, action: string): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE conversation_members SET status=$3 WHERE conversation_id=$1 AND user_id=$2 AND status='active' RETURNING user_id`,
      [gid, targetId, newStatus],
    );
    if (upd.rowCount === 0) { await client.query('ROLLBACK'); throw new GroupError('not_a_member', 404); }
    const e = await client.query(`UPDATE conversations SET epoch = epoch + 1 WHERE id=$1 RETURNING epoch`, [gid]);
    const newEpoch = (e.rows[0] as { epoch: number }).epoch;
    await client.query(
      `INSERT INTO group_audit (conversation_id, actor_id, action, target_id, epoch) VALUES ($1,$2,$3,$4,$5)`,
      [gid, actorId, action, targetId, newEpoch],
    );
    await client.query('COMMIT');
    return newEpoch;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Membership-capability firmata che il client mostra al relay (Blocco C). Il relay la
 * verifica con la chiave pubblica del backend e droppa i messaggi se non valida o epoch
 * scaduto — senza dover fidarsi solo di una lista in cache.
 */
export async function signMembershipCapability(gid: string, userId: string, ttlSeconds = 3600): Promise<{ cap: string; epoch: number } | null> {
  const ce = await pool.query(`SELECT epoch FROM conversations WHERE id=$1 AND deleted_at IS NULL`, [gid]);
  if (ce.rowCount === 0) return null;
  const epoch = (ce.rows[0] as { epoch: number }).epoch;
  if (!(await isMember(gid, userId))) return null;
  const cap = signToken({ t: 'cap', gid, uid: userId, epoch, exp: nowSec() + ttlSeconds });
  return { cap, epoch };
}

/** Snapshot per il relay (endpoint interno): epoch corrente + UUID dei membri attivi. */
export async function getGroupSnapshot(gid: string): Promise<{ epoch: number; members: string[] } | null> {
  const ce = await pool.query(`SELECT epoch FROM conversations WHERE id=$1 AND deleted_at IS NULL`, [gid]);
  if (ce.rowCount === 0) return null;
  const epoch = (ce.rows[0] as { epoch: number }).epoch;
  const m = await pool.query(
    `SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND status='active'`,
    [gid],
  );
  return { epoch, members: m.rows.map((r: { user_id: string }) => r.user_id) };
}
