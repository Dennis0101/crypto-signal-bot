import { prisma } from './db/prisma.js';
import { logger } from '../utils/logger.js';
import { Prisma } from '@prisma/client';
import { loadBitgetCreds } from './exchanges/keyVault.js';
import {
  bitgetAllPositions,
  bitgetGetContracts,
  bitgetOrderDetail,
  bitgetPlaceOrder,
  bitgetPrivateAccountOverview,
  bitgetSetLeverage,
  bitgetSetMarginMode,
} from './exchanges/bitgetPrivate.js';
import { withRlsUser } from './db/rls.js';
import { createUserHalt } from './trading/halts.js';
import { fetchTicker } from '../clients/bitget.js';
import { getUserTier } from './tier/tier.js';
import { confidenceThresholdForTier } from './ai/strictness.js';
import { fetchCandles, fetchRecentTrades } from '../clients/bitget.js';
import { calcBaseFeatures } from '../indicators/calc.js';
import { buildCVDandProfile } from '../indicators/cvd.js';
import { decide } from '../strategy/signal.js';
import { assertCanOpenPosition } from './trading/risk.js';

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
  if (!t) return null;

  const updated = await prisma.executionTask.updateMany({
    where: {
      id: t.id,
      status: 'PENDING',
      OR: [{ leasedUntil: null }, { leasedUntil: { lt: now } }],
    },
    data: { status: 'RUNNING', leasedUntil, attempts: { increment: 1 } },
  });
  if (updated.count !== 1) return null;
  return await prisma.executionTask.findUnique({ where: { id: t.id } });
}

async function runTask(task: any) {
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
    const tf = String(payload.tf || '15m');
    const orderUsd = Number(payload.orderUsd || 100);
    const leverage = Math.max(1, Math.min(125, Math.floor(Number(payload.leverage || 5))));
    const idempotencyKey = String(payload.idempotencyKey || '').trim();
    if (!idempotencyKey) throw new Error('Missing idempotencyKey');

    // 1) AI/rules decision (backend only). If uncertain -> NO TRADE (succeeds task).
    const tier = await getUserTier(task.userId);
    const threshold = confidenceThresholdForTier(tier);

    const candles = await fetchCandles(symbol, tf, 300);
    const f = calcBaseFeatures(candles);
    const tfMin =
      tf.endsWith('m') ? Number(tf.replace('m', '')) : tf.endsWith('h') ? Number(tf.replace('h', '')) * 60 : 15;
    const end = Date.now();
    const start = end - Math.max(tfMin, 15) * 60 * 1000;
    const trades = await fetchRecentTrades(symbol, start, end, 5000);
    const { cvdSeries, profile } = buildCVDandProfile(trades, tfMin * 60 * 1000, Math.max(0.5, f.last * 0.001));
    const decision = await decide(symbol, tf, f, cvdSeries, profile);

    const okCandidate = decision.recommend !== 'NEUTRAL' && decision.confidence >= threshold;
    if (!okCandidate) {
      return {
        action: 'NO_TRADE',
        tier,
        strictness: { confidenceThreshold: threshold },
        decision,
      };
    }

    const direction = decision.recommend === 'LONG' ? 'LONG' : 'SHORT';

    const ticker = await fetchTicker(symbol);
    if (!ticker?.price) throw new Error('Price unavailable');
    const price = ticker.price;
    const notional = orderUsd * leverage;

    // 2) Risk gate (RLS-protected)
    const riskGate = await assertCanOpenPosition(task.userId, notional);
    if (!riskGate.ok) {
      await createUserHalt(task.userId, String(riskGate.code || 'RISK_LIMIT'), String(riskGate.message), riskGate.meta);
      throw new Error(String(riskGate.message));
    }

    const contracts = await bitgetGetContracts(baseUrl);
    const c = contracts.find((x: any) => String(x.symbol).toUpperCase() === symbol);
    if (!c?.sizeMultiplier) {
      await createUserHalt(task.userId, 'API_DESYNC', `Contract metadata missing for ${symbol}`, { symbol });
      throw new Error(`Contract metadata missing for ${symbol}`);
    }
    const sizeMultiplier = Number(c.sizeMultiplier);
    if (!Number.isFinite(sizeMultiplier) || sizeMultiplier <= 0) {
      await createUserHalt(task.userId, 'API_DESYNC', `Invalid sizeMultiplier for ${symbol}`, { symbol, sizeMultiplier: c.sizeMultiplier });
      throw new Error(`Invalid sizeMultiplier for ${symbol}`);
    }
    const minTradeNum = Number(c.minTradeNum ?? 0);
    const minTradeUSDT = Number(c.minTradeUSDT ?? 0);

    // Convert notional -> base size; round down to allowed increment.
    const rawSize = notional / price;
    const steps = Math.floor(rawSize / sizeMultiplier);
    const size = steps * sizeMultiplier;
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error(`Computed size is too small (min step ${sizeMultiplier})`);
    }
    if (minTradeNum > 0 && size < minTradeNum) {
      throw new Error(`Computed size ${size} < minTradeNum ${minTradeNum}`);
    }
    if (minTradeUSDT > 0 && notional < minTradeUSDT) {
      throw new Error(`Notional ${notional} < minTradeUSDT ${minTradeUSDT}`);
    }

    const creds = await loadBitgetCreds(task.userId);

    // Dry-run unless explicitly enabled
    const send = String(process.env.LIVE_ORDER_SEND || '').toLowerCase() === 'true';
    if (!send) {
      return {
        dryRun: true,
        action: 'DRY_RUN',
        tier,
        symbol,
        direction,
        strictness: { confidenceThreshold: threshold },
        decision,
        notional,
        leverage,
        price,
        size,
        sizeMultiplier,
        minTradeNum,
        minTradeUSDT,
        keyLast4: creds.apiKeyLast4,
        note: 'Set LIVE_ORDER_SEND=true to actually place orders (dangerous; use with extreme care).',
      };
    }

    // 3) Convert direction -> side/tradeSide deterministically (no guessing beyond this mapping)
    const side = direction === 'LONG' ? 'buy' : 'sell';
    const tradeSide = 'open';

    // 4) Best-effort account settings (if API rejects -> HALT)
    await bitgetSetMarginMode(baseUrl, creds, { symbol, marginCoin: 'USDT', marginMode: 'isolated' });
    await bitgetSetLeverage(baseUrl, creds, {
      symbol,
      marginCoin: 'USDT',
      leverage,
      holdSide: direction === 'LONG' ? 'long' : 'short',
    });

    // 5) Create order record before sending (idempotency enforced at DB level)
    const createdOrder = await withRlsUser(task.userId, async (tx) => {
      const existing = await tx.order.findUnique({
        where: { userId_idempotencyKey: { userId: task.userId, idempotencyKey } },
        select: { id: true, status: true, tradeId: true, exchangeOrderId: true },
      });
      if (existing) return existing;

      return await tx.order.create({
        data: {
          userId: task.userId,
          exchange: 'BITGET',
          symbol,
          side: direction,
          qty: new Prisma.Decimal(size),
          leverage,
          status: 'PENDING',
          idempotencyKey,
          clientRequestId: 'LIVE_EXECUTE_SIGNAL',
        },
        select: { id: true, status: true, tradeId: true, exchangeOrderId: true },
      });
    });

    // If we already executed this idempotency key, never place again.
    if (createdOrder.tradeId && createdOrder.status === 'FILLED') {
      return { reused: true, action: 'ALREADY_FILLED', orderId: createdOrder.id, tradeId: createdOrder.tradeId };
    }
    if (createdOrder.exchangeOrderId && (createdOrder.status === 'PLACED' || createdOrder.status === 'FILLED')) {
      await createUserHalt(task.userId, 'INVARIANT_VIOLATION', 'Idempotency key already used (refusing duplicate send)', {
        orderId: createdOrder.id,
        exchangeOrderId: createdOrder.exchangeOrderId,
        status: createdOrder.status,
      });
      throw new Error('Idempotency key already used (refusing duplicate send)');
    }

    // 6) Place market order
    const body = {
      symbol,
      productType: 'usdt-futures',
      marginMode: 'isolated',
      marginCoin: 'USDT',
      size: String(size),
      orderType: 'market',
      side,
      tradeSide,
      clientOid: idempotencyKey,
    };

    let placed: any;
    try {
      placed = await bitgetPlaceOrder(baseUrl, creds, body);
    } catch (e: any) {
      await createUserHalt(task.userId, 'EXCHANGE_ERROR', `Order rejected: ${String(e?.message ?? e)}`, { symbol });
      throw e;
    }

    const exchangeOrderId = String(placed?.orderId ?? placed?.orderID ?? placed?.data?.orderId ?? '');
    await withRlsUser(task.userId, async (tx) => {
      await tx.order.update({
        where: { id: createdOrder.id },
        data: { status: 'PLACED', exchangeOrderId: exchangeOrderId || null },
      });
    });

    // 7) Poll order detail; if we can't confirm fill, HALT (safety-first).
    let detail: any = null;
    for (let i = 0; i < 5; i++) {
      try {
        detail = await bitgetOrderDetail(baseUrl, creds, { symbol, orderId: exchangeOrderId || undefined, clientOid: idempotencyKey });
        if (detail) break;
      } catch {
        // ignore and retry
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    if (!detail) {
      await createUserHalt(task.userId, 'API_DESYNC', 'Could not confirm order status (order detail missing)', { symbol, exchangeOrderId });
      throw new Error('Could not confirm order status (order detail missing)');
    }

    // Attempt to extract executed price/size. If missing -> HALT.
    const avgPx = Number(detail?.avgPrice ?? detail?.priceAvg ?? detail?.avgPx ?? detail?.fillPrice ?? NaN);
    const filledSize = Number(detail?.filledSize ?? detail?.baseVolume ?? detail?.size ?? NaN);
    if (!Number.isFinite(avgPx) || avgPx <= 0 || !Number.isFinite(filledSize) || filledSize <= 0) {
      await createUserHalt(task.userId, 'API_DESYNC', 'Order detail missing fill fields (refusing to assume filled)', {
        symbol,
        exchangeOrderId,
        keys: Object.keys(detail || {}),
      });
      throw new Error('Order detail missing fill fields (refusing to assume filled)');
    }

    // 8) Record Trade + events
    await withRlsUser(task.userId, async (tx) => {
      const trade = await tx.trade.create({
        data: {
          userId: task.userId,
          exchange: 'BITGET',
          symbol,
          side: direction,
          status: 'OPEN',
          entryTime: new Date(),
          entryPrice: new Prisma.Decimal(avgPx),
          entryQty: new Prisma.Decimal(filledSize),
          rationaleJson: JSON.stringify({
            source: 'LIVE_EXECUTE_SIGNAL',
            symbol,
            tf,
            decision: {
              recommend: decision.recommend,
              confidence: decision.confidence,
              rationale: decision.rationale,
              reasons: decision.reasons,
              levels: decision.levels,
              risk: decision.risk,
              source: decision.source,
            },
            policy: { tier, confidenceThreshold: threshold },
          }),
          aiMetaJson: JSON.stringify({ tier, confidenceThreshold: threshold }),
        },
        select: { id: true },
      });

      await tx.order.update({ where: { id: createdOrder.id }, data: { status: 'FILLED', tradeId: trade.id } });
      await tx.tradeEvent.create({
        data: {
          userId: task.userId,
          tradeId: trade.id,
          type: 'ENTRY',
          message: `${direction} entry @ ${avgPx.toFixed(4)} (live)`,
          metaJson: JSON.stringify({ exchangeOrderId, avgPx, filledSize, notional, leverage }),
        },
      });
    });

    // 9) Extra safety: snapshot positions; if endpoint errors, HALT.
    try {
      await bitgetAllPositions(baseUrl, creds);
    } catch (e: any) {
      await createUserHalt(task.userId, 'API_DESYNC', 'Could not fetch positions after order', { symbol, exchangeOrderId, err: String(e?.message ?? e) });
      throw new Error('Could not fetch positions after order');
    }

    // Record in DB (RLS-protected tables) under user context
    await withRlsUser(task.userId, async (tx) => {
      // Create minimal audit trail; full reconciliation will be added next.
      await tx.auditLog.create({
        data: {
          userId: task.userId,
          action: 'LIVE_ORDER_PLACED',
          metaJson: JSON.stringify({ symbol, notional, leverage, size, clientOid: idempotencyKey, exchangeOrderId }),
        },
      });
    });

    return { dryRun: false, placed, exchangeOrderId };
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
    } catch (e: any) {
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

