import { prisma } from './db/prisma.js';
import { logger } from '../utils/logger.js';
import { loadBitgetCreds } from './exchanges/keyVault.js';
import { bitgetGetContracts, bitgetPrivateAccountOverview, bitgetPlaceOrder } from './exchanges/bitgetPrivate.js';
import { withRlsUser } from './db/rls.js';
import { createUserHalt } from './trading/halts.js';
import { fetchTicker } from '../clients/bitget.js';
/**
 * DB-backed worker (restart-safe):
 * - Leases PENDING tasks
 * - Executes deterministically
 * - Records resultJson / lastError
 *
 * NOTE: Do not run this in the frontend. Run as separate process/container.
 */
const LEASE_MS = 30_000;
const LOOP_DELAY_MS = 1_000;
async function leaseOne() {
    const now = new Date();
    const leasedUntil = new Date(Date.now() + LEASE_MS);
    // Best-effort: find one available task and lease it.
    // In production, use SKIP LOCKED and a single UPDATE ... RETURNING.
    const t = await prisma.executionTask.findFirst({
        where: {
            status: 'PENDING',
            OR: [{ leasedUntil: null }, { leasedUntil: { lt: now } }],
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
    });
    if (!t)
        return null;
    const updated = await prisma.executionTask.updateMany({
        where: {
            id: t.id,
            status: 'PENDING',
            OR: [{ leasedUntil: null }, { leasedUntil: { lt: now } }],
        },
        data: { status: 'RUNNING', leasedUntil, attempts: { increment: 1 } },
    });
    if (updated.count !== 1)
        return null;
    return await prisma.executionTask.findUnique({ where: { id: t.id } });
}
async function runTask(task) {
    const baseUrl = process.env.BITGET_BASE || 'https://api.bitget.com';
    const payload = JSON.parse(task.payloadJson || '{}');
    if (task.type === 'LIVE_VERIFY_KEY') {
        const creds = await loadBitgetCreds(task.userId);
        const data = await bitgetPrivateAccountOverview(baseUrl, creds);
        return { ok: true, keyLast4: creds.apiKeyLast4, account: data };
    }
    if (task.type === 'LIVE_EXECUTE_SIGNAL') {
        // Fail-closed by default
        const enabled = String(process.env.LIVE_TRADING_ENABLED || '').toLowerCase() === 'true';
        if (!enabled) {
            throw new Error('LIVE_TRADING_ENABLED is not true. Live execution is disabled by default.');
        }
        // We only attempt a best-effort sizing sanity check; if contracts schema changes, we halt.
        const symbol = String(payload.symbol || 'BTCUSDT').toUpperCase();
        const orderUsd = Number(payload.orderUsd || 100);
        const leverage = Math.max(1, Math.min(125, Math.floor(Number(payload.leverage || 5))));
        const idempotencyKey = String(payload.idempotencyKey || '').trim();
        if (!idempotencyKey)
            throw new Error('Missing idempotencyKey');
        const ticker = await fetchTicker(symbol);
        if (!ticker?.price)
            throw new Error('Price unavailable');
        const price = ticker.price;
        const notional = orderUsd * leverage;
        const contracts = await bitgetGetContracts(baseUrl);
        const c = contracts.find((x) => String(x.symbol).toUpperCase() === symbol);
        if (!c?.sizeMultiplier) {
            await createUserHalt(task.userId, 'API_DESYNC', `Contract metadata missing for ${symbol}`, { symbol });
            throw new Error(`Contract metadata missing for ${symbol}`);
        }
        const sizeMultiplier = Number(c.sizeMultiplier);
        if (!Number.isFinite(sizeMultiplier) || sizeMultiplier <= 0) {
            await createUserHalt(task.userId, 'API_DESYNC', `Invalid sizeMultiplier for ${symbol}`, { symbol, sizeMultiplier: c.sizeMultiplier });
            throw new Error(`Invalid sizeMultiplier for ${symbol}`);
        }
        // Convert notional -> base size; round down to allowed increment.
        const rawSize = notional / price;
        const steps = Math.floor(rawSize / sizeMultiplier);
        const size = steps * sizeMultiplier;
        if (!Number.isFinite(size) || size <= 0) {
            throw new Error(`Computed size is too small (min step ${sizeMultiplier})`);
        }
        const creds = await loadBitgetCreds(task.userId);
        // Dry-run unless explicitly enabled
        const send = String(process.env.LIVE_ORDER_SEND || '').toLowerCase() === 'true';
        if (!send) {
            return {
                dryRun: true,
                symbol,
                notional,
                leverage,
                price,
                size,
                sizeMultiplier,
                keyLast4: creds.apiKeyLast4,
                note: 'Set LIVE_ORDER_SEND=true to actually place orders (dangerous; use with extreme care).',
            };
        }
        // Place a market order with conservative parameters.
        // If Bitget rejects params, we halt (safety-first).
        const body = {
            symbol,
            productType: 'usdt-futures',
            marginMode: 'isolated',
            marginCoin: 'USDT',
            size: String(size),
            orderType: 'market',
            // side/tradeSide are exchange-specific; we intentionally require caller to provide.
            // If missing, we stop.
            side: payload.side, // e.g. "buy" | "sell"
            tradeSide: payload.tradeSide, // e.g. "open" | "close"
            clientOid: idempotencyKey,
        };
        if (!body.side || !body.tradeSide) {
            throw new Error('Missing side/tradeSide for live order (refusing to guess).');
        }
        const placed = await bitgetPlaceOrder(baseUrl, creds, body);
        // Record in DB (RLS-protected tables) under user context
        await withRlsUser(task.userId, async (tx) => {
            // Create minimal audit trail; full reconciliation will be added next.
            await tx.auditLog.create({
                data: {
                    userId: task.userId,
                    action: 'LIVE_ORDER_PLACED',
                    metaJson: JSON.stringify({ symbol, notional, leverage, size, clientOid: idempotencyKey }),
                },
            });
        });
        return { dryRun: false, placed };
    }
    throw new Error(`Unknown task type: ${task.type}`);
}
export async function main() {
    logger.info('Worker started');
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const task = await leaseOne();
        if (!task) {
            await new Promise((r) => setTimeout(r, LOOP_DELAY_MS));
            continue;
        }
        try {
            const result = await runTask(task);
            await prisma.executionTask.update({
                where: { id: task.id },
                data: { status: 'SUCCEEDED', leasedUntil: null, resultJson: JSON.stringify(result ?? {}) },
            });
        }
        catch (e) {
            await prisma.executionTask.update({
                where: { id: task.id },
                data: { status: 'FAILED', leasedUntil: null, lastError: String(e?.message ?? e) },
            });
        }
    }
}
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        // Avoid leaking secrets
        logger.error({ err: String(e?.message ?? e) }, 'Worker crashed');
        process.exit(1);
    });
}
