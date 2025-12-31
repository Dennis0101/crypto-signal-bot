import crypto from 'node:crypto';
import type { Response, Request } from 'express';
import { withRlsUser } from '../db/rls.js';
import { prisma } from '../db/prisma.js';

const COOKIE_NAME = 'session';

function base64url(buf: Buffer) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function getSessionTokenFromReq(req: Request): string | null {
  const v = (req as any).cookies?.[COOKIE_NAME];
  if (typeof v === 'string' && v.length > 20) return v;
  return null;
}

export function setSessionCookie(res: Response, rawToken: string, expiresAt: Date) {
  const secure = (process.env.NODE_ENV ?? 'development') === 'production';
  res.cookie(COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export async function createSession(userId: string, ttlDays = 30): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = base64url(crypto.randomBytes(32));
  const tokenSha256 = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  await withRlsUser(userId, async (tx) => {
    await tx.session.create({
      data: {
        userId,
        tokenSha256,
        expiresAt,
      },
    });
  });

  return { rawToken, expiresAt };
}

export async function resolveSession(rawToken: string): Promise<{ userId: string } | null> {
  const tokenSha256 = sha256Hex(rawToken);
  // Session is intentionally excluded from RLS because we must resolve it before we know userId.
  // Security model:
  // - Cookie stores raw random token
  // - DB stores only SHA-256 hash
  // - API never returns the raw token
  const row = await prisma.session.findUnique({
    where: { tokenSha256 },
    select: { userId: true, expiresAt: true },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return { userId: row.userId };
}

