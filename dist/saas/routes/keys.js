import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../http/middleware.js';
import { withRlsUser } from '../db/rls.js';
import { encryptSecret, sha256Hex } from '../crypto/secretbox.js';
import { validateExchangeKeyInput } from '../security/exchangeKeyPolicy.js';
const CreateKeySchema = z.object({
    exchange: z.enum(['BITGET']).default('BITGET'),
    label: z.string().max(60).optional(),
    apiKey: z.string().min(8),
    apiSecret: z.string().min(8),
    passphrase: z.string().min(2).max(128).optional(),
    withdrawEnabled: z.literal(false).optional(),
});
export function createRouter() {
    const r = Router();
    r.use(requireAuth);
    r.get('/', async (req, res) => {
        const userId = req.userId;
        const rows = await withRlsUser(userId, (tx) => tx.exchangeKey.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                exchange: true,
                label: true,
                createdAt: true,
                lastUsedAt: true,
                apiKeyLast4: true,
                withdrawEnabled: true,
            },
        }));
        res.json({ keys: rows });
    });
    r.post('/', async (req, res) => {
        const userId = req.userId;
        const body = CreateKeySchema.parse(req.body ?? {});
        const v = validateExchangeKeyInput(body);
        if (!v.ok)
            return res.status(400).json({ error: { code: 'INVALID_KEY', message: v.message } });
        const apiKeyLast4 = body.apiKey.slice(-4);
        const apiKeySha256 = sha256Hex(body.apiKey);
        // Encrypt at rest (never log plaintext)
        const encApiKey = encryptSecret(body.apiKey);
        const encApiSecret = encryptSecret(body.apiSecret);
        const encPassphrase = body.passphrase ? encryptSecret(body.passphrase) : null;
        try {
            const row = await withRlsUser(userId, (tx) => tx.exchangeKey.create({
                data: {
                    userId,
                    exchange: body.exchange,
                    label: body.label ?? null,
                    apiKeyLast4,
                    apiKeySha256,
                    encApiKey,
                    encApiSecret,
                    encPassphrase,
                    withdrawEnabled: false,
                },
                select: { id: true, exchange: true, label: true, apiKeyLast4: true, createdAt: true },
            }));
            // NEVER return secrets (encrypted or plaintext)
            res.status(201).json({ key: row });
        }
        catch (e) {
            // Unique constraint => already stored
            const msg = String(e?.message ?? 'Failed to store key');
            res.status(400).json({ error: { code: 'KEY_STORE_FAILED', message: msg } });
        }
    });
    r.delete('/:id', async (req, res) => {
        const userId = req.userId;
        const id = String(req.params.id);
        await withRlsUser(userId, (tx) => tx.exchangeKey.delete({ where: { id } }));
        res.json({ ok: true });
    });
    return r;
}
