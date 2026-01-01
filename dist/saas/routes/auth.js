import { Router } from 'express';
import { z } from 'zod';
import { oidcStart, oidcCallback } from '../auth/oidc.js';
import { prisma } from '../db/rls.js';
import { createSession, clearSessionCookie, setSessionCookie, getSessionTokenFromReq, resolveSession, revokeSession } from '../auth/session.js';
const ProviderSchema = z.enum(['google', 'apple']);
const OIDC_COOKIE_PREFIX = 'oidc_';
function oidcCookieName(provider) {
    return `${OIDC_COOKIE_PREFIX}${provider}`;
}
function setShortCookie(res, name, value) {
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
    async function handleCallback(req, res) {
        const provider = ProviderSchema.parse(req.params.provider);
        const rawCookie = req.cookies?.[oidcCookieName(provider)];
        if (!rawCookie)
            return res.status(400).send('Missing OIDC cookie');
        let parsed;
        try {
            parsed = JSON.parse(rawCookie);
        }
        catch {
            return res.status(400).send('Invalid OIDC cookie');
        }
        const expectedState = String(parsed?.state ?? '');
        const codeVerifier = String(parsed?.codeVerifier ?? '');
        if (!expectedState || !codeVerifier)
            return res.status(400).send('Invalid OIDC cookie payload');
        // Support both query callbacks (GET) and form_post (POST) for Apple.
        const qp = new URLSearchParams(req.query);
        const bp = new URLSearchParams((req.body ?? {}));
        const state = qp.get('state') || bp.get('state') || '';
        const code = qp.get('code') || bp.get('code') || '';
        const error = qp.get('error') || bp.get('error') || '';
        if (error)
            return res.status(400).send(`OIDC error: ${error}`);
        if (!state || !code)
            return res.status(400).send('Missing state/code');
        if (state !== expectedState)
            return res.status(400).send('State mismatch');
        const base = process.env.API_BASE_URL || `http://localhost:${process.env.SAAS_PORT || 8080}`;
        const currentUrl = new URL(req.path, base);
        currentUrl.searchParams.set('state', state);
        currentUrl.searchParams.set('code', code);
        const { email, name, picture, providerAccountId } = await oidcCallback({
            provider,
            currentUrl,
            expectedState,
            codeVerifier,
        });
        // Upsert auth identity (server-only tables)
        const acct = await prisma.oAuthAccount.findUnique({
            where: { provider_providerAccountId: { provider, providerAccountId } },
            select: { userId: true },
        });
        const userId = acct?.userId ??
            (await prisma.user.create({
                data: {
                    email: email ?? null,
                    name: name ?? null,
                    avatarUrl: picture ?? null,
                    tier: 'BASIC',
                },
                select: { id: true },
            })).id;
        if (!acct) {
            await prisma.oAuthAccount.create({
                data: {
                    userId,
                    provider,
                    providerAccountId,
                },
            });
        }
        else {
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
    }
    r.get('/me', async (req, res) => {
        const raw = getSessionTokenFromReq(req);
        if (!raw)
            return res.json({ user: null });
        const sess = await resolveSession(raw);
        if (!sess)
            return res.json({ user: null });
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
            await revokeSession(raw).catch(() => { });
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
    r.get('/:provider/callback', handleCallback);
    r.post('/:provider/callback', handleCallback);
    return r;
}
