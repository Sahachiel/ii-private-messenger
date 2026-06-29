import { NextFunction, Request, Response } from 'express';
import { verifyAccess } from '../services/jwt';
import { config } from '../config';
import { isMember, isAdmin } from '../services/groupInvite';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const h = req.header('authorization') ?? req.header('Authorization');
  if (!h || !h.toLowerCase().startsWith('bearer ')) {
    res.status(401).json({ success: false, error: 'Missing bearer token' });
    return;
  }
  const token = h.slice(7).trim();
  try {
    const claims = verifyAccess(token);
    req.user = { id: claims.sub, username: claims.username, region: claims.region };
    next();
  } catch (e) {
    res.status(401).json({ success: false, error: `Invalid token: ${(e as Error).message}` });
  }
}

export function requireInternal(req: Request, res: Response, next: NextFunction): void {
  const secret = req.header('x-internal-secret');
  if (!secret || secret !== config.interNodeSecret) {
    res.status(401).json({ success: false, error: 'Invalid internal secret' });
    return;
  }
  next();
}

/**
 * Richiede che il chiamante sia membro ATTIVO del gruppo :id. Ai non-membri risponde 404
 * UNIFORME (stesso responso di "gruppo inesistente") per non rivelare l'esistenza del gruppo
 * — niente oracolo di membership cross-group.
 */
export function requireGroupMembership(req: Request, res: Response, next: NextFunction): void {
  const user = req.user;
  const gid = req.params.id;
  if (!user) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }
  isMember(gid, user.id).then((ok) => {
    if (!ok) { res.status(404).json({ success: false, error: 'Not found' }); return; }
    next();
  }).catch(next);
}

/**
 * Richiede ruolo owner/admin sul gruppo :id. Non-membro → 404 uniforme; membro-non-admin → 403.
 */
export function requireGroupAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = req.user;
  const gid = req.params.id;
  if (!user) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }
  isMember(gid, user.id).then(async (member) => {
    if (!member) { res.status(404).json({ success: false, error: 'Not found' }); return; }
    if (!(await isAdmin(gid, user.id))) { res.status(403).json({ success: false, error: 'Forbidden' }); return; }
    next();
  }).catch(next);
}
