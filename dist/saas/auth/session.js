import crypto from 'node:crypto';
import { withRlsUser } from '../db/rls.js';
import { prisma } from '../db/prisma.js';
const COOKIE_NAME = 'session';
function base64url(buf) {
    return buf
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}
function sha256Hex(raw) {
    return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}
export function sessionTokenSha256(rawToken) {
    return sha256Hex(rawToken);
}
export function getSessionTokenFromReq(req) {
    const v = req.cookies?.[COOKIE_NAME];
    if (typeof v === 'string' && v.length > 20)
        return v;
    return null;
}
export function setSessionCookie(res, rawToken, expiresAt) {
    const secure = (process.env.NODE_ENV ?? 'development') === 'production';
    res.cookie(COOKIE_NAME, rawToken, {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
        expires: expiresAt,
    });
}
export function clearSessionCookie(res) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
}
export async function createSession(userId, ttlDays = 30) {
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
export async function resolveSession(rawToken) {
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
    if (!row)
        return null;
    if (row.expiresAt.getTime() < Date.now())
        return null;
    return { userId: row.userId };
}
export async function revokeSession(rawToken) {
    const tokenSha256 = sha256Hex(rawToken);
    await prisma.session.deleteMany({ where: { tokenSha256 } });
}
