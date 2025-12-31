import type { NextFunction, Request, Response } from 'express';
import { resolveSession } from '../auth/session.js';

export type AuthedRequest = Request & { userId?: string };

export async function authOptional(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const raw = (req as any).cookies?.session;
    if (typeof raw === 'string') {
      const s = await resolveSession(raw);
      if (s) req.userId = s.userId;
    }
  } catch {
    // fail closed: unauthenticated
  }
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.userId) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } });
    return;
  }
  next();
}

