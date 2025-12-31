import { Prisma } from '@prisma/client';
import { withRlsUser } from '../db/rls.js';
function dec(n) {
    return new Prisma.Decimal(n);
}
export async function getRiskSnapshot(userId) {
    return await withRlsUser(userId, async (tx) => {
        const risk = (await tx.riskLimit.findUnique({ where: { userId } })) ??
            (await tx.riskLimit.create({ data: { userId } }));
        const openTrades = await tx.trade.findMany({
            where: { status: 'OPEN' },
            select: { entryPrice: true, entryQty: true },
        });
        const openExposureUsd = openTrades.reduce((sum, t) => {
            const v = t.entryPrice.mul(t.entryQty);
            return sum.add(v);
        }, new Prisma.Decimal(0));
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const closed = await tx.trade.findMany({
            where: { status: { in: ['CLOSED', 'LIQUIDATED'] }, exitTime: { gte: since } },
            select: { realizedPnlUsd: true },
        });
        const realizedLoss24hUsd = closed.reduce((loss, t) => {
            const pnl = t.realizedPnlUsd;
            if (!pnl)
                return loss;
            if (pnl.greaterThanOrEqualTo(0))
                return loss;
            return loss.add(pnl.abs());
        }, new Prisma.Decimal(0));
        return {
            tradingEnabled: risk.tradingEnabled,
            maxDailyLossUsd: Number(risk.maxDailyLossUsd),
            maxOpenExposureUsd: Number(risk.maxOpenExposureUsd),
            maxConcurrentPositions: risk.maxConcurrentPositions,
            openPositions: openTrades.length,
            openExposureUsd: Number(openExposureUsd),
            realizedLoss24hUsd: Number(realizedLoss24hUsd),
        };
    });
}
export async function assertCanOpenPosition(userId, addExposureUsd) {
    const snap = await getRiskSnapshot(userId);
    if (!snap.tradingEnabled) {
        return { ok: false, code: 'UNCONFIGURED', message: 'Trading is disabled.' };
    }
    if (snap.maxConcurrentPositions > 0 && snap.openPositions >= snap.maxConcurrentPositions) {
        return {
            ok: false,
            code: 'RISK_LIMIT',
            message: `Max concurrent positions reached (${snap.openPositions}/${snap.maxConcurrentPositions}).`,
        };
    }
    if (snap.maxOpenExposureUsd > 0 && snap.openExposureUsd + addExposureUsd > snap.maxOpenExposureUsd) {
        return {
            ok: false,
            code: 'RISK_LIMIT',
            message: `Max exposure exceeded (${Math.round(snap.openExposureUsd + addExposureUsd)} > ${snap.maxOpenExposureUsd}).`,
            meta: { openExposureUsd: snap.openExposureUsd, addExposureUsd, maxOpenExposureUsd: snap.maxOpenExposureUsd },
        };
    }
    if (snap.maxDailyLossUsd > 0 && snap.realizedLoss24hUsd >= snap.maxDailyLossUsd) {
        return {
            ok: false,
            code: 'RISK_LIMIT',
            message: `Max daily loss reached (${snap.realizedLoss24hUsd} >= ${snap.maxDailyLossUsd}).`,
        };
    }
    return { ok: true, snapshot: snap };
}
