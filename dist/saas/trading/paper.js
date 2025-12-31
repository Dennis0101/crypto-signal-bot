import { Prisma } from '@prisma/client';
import { fetchTicker } from '../../clients/bitget.js';
import { withRlsUser } from '../db/rls.js';
import { assertCanOpenPosition } from './risk.js';
function dec(n) {
    return new Prisma.Decimal(n);
}
export async function paperOpenPosition(userId, input) {
    const symbol = input.symbol.toUpperCase();
    const leverage = Math.max(1, Math.min(125, Math.floor(input.leverage)));
    const orderUsd = Math.max(1, Number(input.orderUsd));
    const idempotencyKey = String(input.idempotencyKey || '').trim();
    if (!idempotencyKey)
        throw new Error('Missing idempotencyKey');
    const t = await fetchTicker(symbol);
    if (!t?.price || !Number.isFinite(t.price) || t.price <= 0) {
        throw new Error('Price unavailable');
    }
    const price = t.price;
    const notional = orderUsd * leverage;
    const qty = notional / price;
    const gate = await assertCanOpenPosition(userId, notional);
    if (!gate.ok) {
        const err = new Error(gate.message);
        err.halt = gate;
        throw err;
    }
    return await withRlsUser(userId, async (tx) => {
        // Idempotency: if order already exists, return it
        const existing = await tx.order.findUnique({
            where: { userId_idempotencyKey: { userId, idempotencyKey } },
            select: { id: true, tradeId: true },
        });
        if (existing?.tradeId) {
            const trade = await tx.trade.findUnique({ where: { id: existing.tradeId } });
            return { reused: true, orderId: existing.id, trade };
        }
        const trade = await tx.trade.create({
            data: {
                userId,
                exchange: 'BITGET',
                symbol,
                side: input.side,
                status: 'OPEN',
                entryTime: new Date(),
                entryPrice: dec(price),
                entryQty: dec(qty),
                rationaleJson: JSON.stringify(input.rationale ?? { source: 'PAPER' }),
                aiMetaJson: input.aiMeta ? JSON.stringify(input.aiMeta) : null,
            },
        });
        const order = await tx.order.create({
            data: {
                userId,
                exchange: 'BITGET',
                symbol,
                side: input.side,
                qty: dec(qty),
                leverage,
                status: 'FILLED',
                idempotencyKey,
                tradeId: trade.id,
            },
            select: { id: true, status: true, createdAt: true },
        });
        await tx.tradeEvent.create({
            data: {
                userId,
                tradeId: trade.id,
                type: 'ENTRY',
                message: `${input.side} entry @ ${price.toFixed(4)} (paper)`,
                metaJson: JSON.stringify({ price, qty, orderUsd, leverage, notional }),
            },
        });
        return { reused: false, orderId: order.id, trade };
    });
}
export async function paperClosePosition(userId, tradeId, idempotencyKey) {
    const key = String(idempotencyKey || '').trim();
    if (!key)
        throw new Error('Missing idempotencyKey');
    return await withRlsUser(userId, async (tx) => {
        const trade = await tx.trade.findUnique({ where: { id: tradeId } });
        if (!trade)
            throw new Error('Trade not found');
        if (trade.status !== 'OPEN')
            return { closed: true, trade };
        const t = await fetchTicker(trade.symbol);
        if (!t?.price || !Number.isFinite(t.price) || t.price <= 0) {
            throw new Error('Price unavailable');
        }
        const exitPrice = t.price;
        const qty = Number(trade.entryQty);
        const entry = Number(trade.entryPrice);
        const pnl = trade.side === 'LONG' ? (exitPrice - entry) * qty : (entry - exitPrice) * qty;
        // idempotency for close: if an order exists for this key, return updated trade
        const existing = await tx.order.findUnique({
            where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
            select: { id: true },
        });
        if (existing) {
            const updated = await tx.trade.findUnique({ where: { id: tradeId } });
            return { closed: true, trade: updated };
        }
        const updated = await tx.trade.update({
            where: { id: tradeId },
            data: {
                status: 'CLOSED',
                exitTime: new Date(),
                exitPrice: dec(exitPrice),
                realizedPnlUsd: dec(pnl),
            },
        });
        await tx.order.create({
            data: {
                userId,
                exchange: 'BITGET',
                symbol: trade.symbol,
                side: trade.side,
                qty: trade.entryQty,
                leverage: 1,
                status: 'FILLED',
                idempotencyKey: key,
                tradeId: trade.id,
                clientRequestId: 'CLOSE',
            },
        });
        await tx.tradeEvent.create({
            data: {
                userId,
                tradeId: trade.id,
                type: 'EXIT',
                message: `Exit @ ${exitPrice.toFixed(4)} (paper)`,
                metaJson: JSON.stringify({ exitPrice, pnl }),
            },
        });
        return { closed: true, trade: updated };
    });
}
