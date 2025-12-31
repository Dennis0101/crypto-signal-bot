import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../http/middleware.js';
import { withRlsUser } from '../db/rls.js';
const ListTradesQuery = z.object({
    symbol: z.string().min(3).max(30).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
});
export function createRouter() {
    const r = Router();
    r.use(requireAuth);
    r.get('/', async (req, res) => {
        const userId = req.userId;
        const q = ListTradesQuery.parse(req.query);
        const rows = await withRlsUser(userId, (tx) => tx.trade.findMany({
            where: { ...(q.symbol ? { symbol: q.symbol } : {}) },
            orderBy: { entryTime: 'desc' },
            take: q.limit,
            select: {
                id: true,
                symbol: true,
                side: true,
                status: true,
                entryTime: true,
                entryPrice: true,
                entryQty: true,
                exitTime: true,
                exitPrice: true,
                realizedPnlUsd: true,
                rationaleJson: true,
                aiMetaJson: true,
            },
        }));
        res.json({ trades: rows });
    });
    return r;
}
