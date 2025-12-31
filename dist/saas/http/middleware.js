import { resolveSession } from '../auth/session.js';
export async function authOptional(req, _res, next) {
    try {
        const raw = req.cookies?.session;
        if (typeof raw === 'string') {
            const s = await resolveSession(raw);
            if (s)
                req.userId = s.userId;
        }
    }
    catch {
        // fail closed: unauthenticated
    }
    next();
}
export function requireAuth(req, res, next) {
    if (!req.userId) {
        res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } });
        return;
    }
    next();
}
