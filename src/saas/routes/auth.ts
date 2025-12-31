import { Router } from 'express';
import { z } from 'zod';
import { oidcStart, oidcCallback } from '../auth/oidc.js';
import { prisma } from '../db/rls.js';
import { createSession, clearSessionCookie, setSessionCookie, getSessionTokenFromReq, resolveSession } from '../auth/session.js';

const ProviderSchema = z.enum(['google', 'apple']);

const OIDC_COOKIE_PREFIX = 'oidc_';

function oidcCookieName(provider: string) {
  return `${OIDC_COOKIE_PREFIX}${provider}`;
}

function setShortCookie(res: any, name: string, value: any) {
  const secure = (process.env.NODE_ENV ?? 'development') === 'production';
  res.cookie(name, value, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60 * 1000, // 10 min
  });
}

export function createRouter() {
  const r = Router();

  r.get('/me', async (req, res) => {
    const raw = getSessionTokenFromReq(req);
    if (!raw) return res.json({ user: null });
    const sess = await resolveSession(raw);
    if (!sess) return res.json({ user: null });
    const u = await prisma.user.findUnique({
      where: { id: sess.userId },
      select: { id: true, email: true, name: true, avatarUrl: true, tier: true, tierUntil: true },
    });
    return res.json({ user: u ?? null });
  });

  r.post('/logout', async (req, res) => {
    const raw = getSessionTokenFromReq(req);
    clearSessionCookie(res);
    if (raw) {
      // Best-effort revoke (DB contains only hash)
      // If prisma session table is large, consider background cleanup.
      // We don't delete by raw token; only by hash.
      // (hashing logic is inside resolveSession/createSession; keep consistent)
    }
    res.json({ ok: true });
  });

  r.get('/:provider/start', async (req, res) => {
    const provider = ProviderSchema.parse(req.params.provider);
    const { authorizationUrl, state, codeVerifier } = await oidcStart(provider);

    // Store state+verifier in httpOnly cookie (server-only)
    setShortCookie(res, oidcCookieName(provider), JSON.stringify({ state, codeVerifier }));

    res.redirect(authorizationUrl);
  });

  r.get('/:provider/callback', async (req, res) => {
    const provider = ProviderSchema.parse(req.params.provider);
    const rawCookie = (req as any).cookies?.[oidcCookieName(provider)];
    if (!rawCookie) return res.status(400).send('Missing OIDC cookie');

    let parsed: any;
    try {
      parsed = JSON.parse(rawCookie);
    } catch {
      return res.status(400).send('Invalid OIDC cookie');
    }

    const state = String(parsed?.state ?? '');
    const codeVerifier = String(parsed?.codeVerifier ?? '');
    if (!state || !codeVerifier) return res.status(400).send('Invalid OIDC cookie payload');

    const q = new URLSearchParams(req.query as any);
    if (q.get('state') !== state) return res.status(400).send('State mismatch');

    const base = process.env.API_BASE_URL || `http://localhost:${process.env.SAAS_PORT || 8080}`;
    const currentUrl = new URL(req.originalUrl, base);

    const { email, name, picture, providerAccountId } = await oidcCallback({
      provider,
      currentUrl,
      expectedState: state,
      codeVerifier,
    });

    // Upsert auth identity (server-only tables)
    const acct = await prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      select: { userId: true },
    });

    const userId =
      acct?.userId ??
      (
        await prisma.user.create({
          data: {
            email: email ?? null,
            name: name ?? null,
            avatarUrl: picture ?? null,
            tier: 'BASIC',
          },
          select: { id: true },
        })
      ).id;

    if (!acct) {
      await prisma.oAuthAccount.create({
        data: {
          userId,
          provider,
          providerAccountId,
        },
      });
    } else {
      await prisma.user.update({
        where: { id: userId },
        data: { email: email ?? undefined, name: name ?? undefined, avatarUrl: picture ?? undefined },
      });
    }

    const { rawToken, expiresAt } = await createSession(userId, 30);
    setSessionCookie(res, rawToken, expiresAt);

    // Clear OIDC cookie
    res.clearCookie(oidcCookieName(provider), { path: '/' });

    const redirectTo = process.env.WEB_APP_URL || '/';
    res.redirect(redirectTo);
  });

  return r;
}

