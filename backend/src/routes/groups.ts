import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireInternal, requireGroupMembership, requireGroupAdmin } from '../middleware/auth';
import { generalLimiter, authLimiter } from '../middleware/rateLimit';
import {
  GroupError, createGroup, listMyGroups, listMembers,
  createInvite, revokeInvite, consumeInvite,
  listJoinRequests, decideJoinRequest,
  leaveGroup, removeMember, signMembershipCapability,
  getGroupSnapshot, getGroupSigningPublicKey,
} from '../services/groupInvite';

const router = Router();

const idParam = z.object({ id: z.string().uuid() });

// --- Endpoint INTERNI (solo relay, via X-Internal-Secret) ---
// Chiave pubblica con cui il relay verifica le membership-capability.
router.get('/signing-key', requireInternal, (_req: Request, res: Response) => {
  res.json({ success: true, data: { public_key_b64: getGroupSigningPublicKey() } });
});
// Snapshot membri+epoch per l'enforcement e il fan-out lato relay.
router.get('/:id/members-internal', requireInternal, handle(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const snap = await getGroupSnapshot(id);
  if (!snap) { res.status(404).json({ success: false, error: 'not_found' }); return; }
  res.json({ success: true, data: snap });
}));

/** Mappa GroupError → HTTP; il resto va all'error handler globale. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch((e: unknown) => {
      if (e instanceof GroupError) { res.status(e.httpStatus).json({ success: false, error: e.code }); return; }
      next(e);
    });
  };
}

// Crea un gruppo (circle). Il creatore diventa owner.
const createSchema = z.object({ max_members: z.number().int().min(2).max(50).optional() });
router.post('/', requireAuth, generalLimiter, handle(async (req, res) => {
  const body = createSchema.parse(req.body ?? {});
  const g = await createGroup(req.user!.id, body.max_members ?? 50);
  res.status(201).json({ success: true, data: { id: g.id, epoch: g.epoch } });
}));

// Lista dei MIEI gruppi (solo id/ruolo/epoch/conteggio — nessun nome, zero-knowledge).
router.get('/', requireAuth, generalLimiter, handle(async (req, res) => {
  const groups = await listMyGroups(req.user!.id);
  res.json({ success: true, data: groups });
}));

// Membri del gruppo (solo membri attivi possono vederli).
router.get('/:id/members', requireAuth, requireGroupMembership, generalLimiter, handle(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ success: true, data: await listMembers(id) });
}));

// Capability di membership firmata per il relay (Blocco C).
router.get('/:id/capability', requireAuth, requireGroupMembership, generalLimiter, handle(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const cap = await signMembershipCapability(id, req.user!.id);
  if (!cap) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  res.json({ success: true, data: cap });
}));

// Crea un invito (solo admin). Default blindato: requires_approval + monouso + 7gg.
const inviteSchema = z.object({
  bound_user_id: z.string().uuid().optional().nullable(),
  requires_approval: z.boolean().optional(),
  max_uses: z.number().int().min(1).max(100).optional(),
  ttl_seconds: z.number().int().min(60).max(30 * 24 * 3600).optional(),
});
router.post('/:id/invites', requireAuth, requireGroupAdmin, generalLimiter, handle(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const body = inviteSchema.parse(req.body ?? {});
  const out = await createInvite(id, req.user!.id, {
    boundUserId: body.bound_user_id ?? null,
    requiresApproval: body.requires_approval ?? true,
    maxUses: body.max_uses ?? 1,
    ttlSeconds: body.ttl_seconds ?? 7 * 24 * 3600,
  });
  res.status(201).json({ success: true, data: { token: out.token, expires_at: out.expiresAt } });
}));

// Revoca un invito (solo admin).
const inviteIdParam = z.object({ id: z.string().uuid(), inviteId: z.string().uuid() });
router.delete('/:id/invites/:inviteId', requireAuth, requireGroupAdmin, generalLimiter, handle(async (req, res) => {
  const p = inviteIdParam.parse(req.params);
  await revokeInvite(p.id, p.inviteId);
  res.json({ success: true, data: { revoked: true } });
}));

// Entra in un gruppo presentando il token (dal QR/link). Limitato come gli endpoint auth.
const joinSchema = z.object({ token: z.string().min(1).max(4096) });
router.post('/join', requireAuth, authLimiter, handle(async (req, res) => {
  const body = joinSchema.parse(req.body);
  const out = await consumeInvite(body.token, req.user!.id);
  res.json({ success: true, data: out });
}));

// Richieste di ingresso pendenti (solo admin).
router.get('/:id/join-requests', requireAuth, requireGroupAdmin, generalLimiter, handle(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ success: true, data: await listJoinRequests(id) });
}));

// Approva/rifiuta una richiesta (solo admin).
const decideParam = z.object({ id: z.string().uuid(), userId: z.string().uuid() });
const decideSchema = z.object({ approve: z.boolean() });
router.post('/:id/join-requests/:userId', requireAuth, requireGroupAdmin, generalLimiter, handle(async (req, res) => {
  const p = decideParam.parse(req.params);
  const body = decideSchema.parse(req.body);
  const out = await decideJoinRequest(p.id, p.userId, req.user!.id, body.approve);
  res.json({ success: true, data: out });
}));

// Esci dal gruppo (epoch++).
router.post('/:id/leave', requireAuth, requireGroupMembership, generalLimiter, handle(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const epoch = await leaveGroup(id, req.user!.id);
  res.json({ success: true, data: { left: true, epoch } });
}));

// Espelli un membro (solo admin, epoch++).
router.delete('/:id/members/:userId', requireAuth, requireGroupAdmin, generalLimiter, handle(async (req, res) => {
  const p = decideParam.parse(req.params);
  const epoch = await removeMember(p.id, p.userId, req.user!.id);
  res.json({ success: true, data: { removed: true, epoch } });
}));

export default router;
