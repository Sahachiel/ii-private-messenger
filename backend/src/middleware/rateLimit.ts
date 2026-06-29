import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { config } from '../config';

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.authPerMin,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many auth attempts, try again shortly' },
});

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.generalPerMin,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    if (req.user?.id) return `user:${req.user.id}`;
    return req.ip ?? '0.0.0.0';
  },
  message: { success: false, error: 'Rate limit exceeded' },
});
