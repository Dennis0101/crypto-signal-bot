import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../http/middleware.js';
import { isUserHalted, createUserHalt } from '../trading/halts.js';
import { paperOpenPosition, paperClosePosition } from '../trading/paper.js';
import { getRiskSnapshot } from '../trading/risk.js';
import { getUserTier } from '../tier/tier.js';
import { confidenceThresholdForTier } from '../ai/strictness.js';
import { enqueueTask, listTasks } from '../tasks/queue.js';
import { fetchCandles, fetchRecentTrades } from '../../clients/bitget.js';
import { calcBaseFeatures } from '../../indicators/calc.js';
import { buildCVDandProfile } from '../../indicators/cvd.js';
import { decide } from '../../strategy/signal.js';
const OpenSchema = z.object({
    symbol: z.string().min(3).max(30),
    side: z.enum(['LONG', 'SHORT']),
    orderUsd: z.coerce.number().min(1).max(1_000_000).default(100),
    leverage: z.coerce.number().int().min(1).max(125).default(5),
    idempotencyKey: z.string().min(8).max(120),
    rationale: z.any().optional(),
    aiMeta: z.any().optional(),
});
const CloseSchema = z.object({
    tradeId: z.string().min(10),
    idempotencyKey: z.string().min(8).max(120),
});
const ExecSignalSchema = z.object({
    symbol: z.string().min(3).max(30).default('BTCUSDT'),
    tf: z.string().min(2).max(10).default('15m'),
    orderUsd: z.coerce.number().min(1).max(1_000_000).optional(),
    leverage: z.coerce.number().int().min(1).max(125).optional(),
    idempotencyKey: z.string().min(8).max(120),
});
export function createRouter() {
    const r = Router();
    r.use(requireAuth);
    r.get('/tasks', async (req, res) => {
        const userId = req.userId;
        const limit = Number(req.query?.limit ?? 50);
        const tasks = await listTasks(userId, limit);
        res.json({ tasks });
    });
    r.get('/status', async (req, res) => {
        const userId = req.userId;
        const risk = await getRiskSnapshot(userId);
        const halts = await isUserHalted(userId);
        res.json({ risk, halts });
    });
    // Explicit manual halt switch (trust feature)
    r.post('/halt', async (req, res) => {
        const userId = req.userId;
        const body = z.object({ message: z.string().min(3).max(200).default('User requested halt') }).parse(req.body ?? {});
        const h = await createUserHalt(userId, 'USER_REQUESTED', body.message, { at: Date.now() });
        res.status(201).json({ halt: h });
    });
    // Paper trading only (live trading stays disabled by default)
    r.post('/paper/open', async (req, res) => {
        const userId = req.userId;
        const halted = await isUserHalted(userId);
        if (halted.halted)
            return res.status(423).json({ error: { code: 'HALTED', message: 'Trading halted', reasons: halted.reasons } });
        try {
            const body = OpenSchema.parse(req.body ?? {});
            const result = await paperOpenPosition(userId, {
                symbol: body.symbol,
                side: body.side,
                orderUsd: body.orderUsd,
                leverage: body.leverage,
                idempotencyKey: body.idempotencyKey,
                rationale: body.rationale ?? { source: 'MANUAL_PAPER', note: 'manual open' },
                aiMeta: body.aiMeta,
            });
            res.json({ ok: true, ...result });
        }
        catch (e) {
            if (e?.halt) {
                return res.status(400).json({ error: { code: e.halt.code || 'RISK_LIMIT', message: e.message, meta: e.halt.meta } });
            }
            res.status(400).json({ error: { code: 'OPEN_FAILED', message: String(e?.message ?? e) } });
        }
    });
    r.post('/paper/close', async (req, res) => {
        const userId = req.userId;
        const halted = await isUserHalted(userId);
        if (halted.halted)
            return res.status(423).json({ error: { code: 'HALTED', message: 'Trading halted', reasons: halted.reasons } });
        try {
            const body = CloseSchema.parse(req.body ?? {});
            const result = await paperClosePosition(userId, body.tradeId, body.idempotencyKey);
            res.json({ ok: true, ...result });
        }
        catch (e) {
            res.status(400).json({ error: { code: 'CLOSE_FAILED', message: String(e?.message ?? e) } });
        }
    });
    // One-click: analyze and (if allowed) open paper position.
    r.post('/paper/execute-signal', async (req, res) => {
        const userId = req.userId;
        const halted = await isUserHalted(userId);
        if (halted.halted)
            return res.status(423).json({ error: { code: 'HALTED', message: 'Trading halted', reasons: halted.reasons } });
        const body = ExecSignalSchema.parse(req.body ?? {});
        const tier = await getUserTier(userId);
        const threshold = confidenceThresholdForTier(tier);
        // Run analysis (server-side only)
        const candles = await fetchCandles(body.symbol, body.tf, 300);
        const f = calcBaseFeatures(candles);
        const tfMin = body.tf.endsWith('m') ? Number(body.tf.replace('m', '')) : body.tf.endsWith('h') ? Number(body.tf.replace('h', '')) * 60 : 15;
        const end = Date.now();
        const start = end - Math.max(tfMin, 15) * 60 * 1000;
        const trades = await fetchRecentTrades(body.symbol, start, end, 5000);
        const { cvdSeries, profile } = buildCVDandProfile(trades, tfMin * 60 * 1000, Math.max(0.5, f.last * 0.001));
        const decision = await decide(body.symbol, body.tf, f, cvdSeries, profile);
        const okCandidate = decision.recommend !== 'NEUTRAL' && decision.confidence >= threshold;
        if (!okCandidate) {
            return res.json({
                ok: true,
                action: 'NO_TRADE',
                tier,
                strictness: { confidenceThreshold: threshold },
                decision,
            });
        }
        // Narrow type for execution
        const side = decision.recommend === 'LONG' ? 'LONG' : 'SHORT';
        // Default sizing: conservative; caller can override.
        const orderUsd = body.orderUsd ?? 100;
        const leverage = body.leverage ?? 5;
        try {
            const result = await paperOpenPosition(userId, {
                symbol: body.symbol,
                side,
                orderUsd,
                leverage,
                idempotencyKey: body.idempotencyKey,
                rationale: {
                    source: 'AUTO_PAPER',
                    at: new Date().toISOString(),
                    symbol: body.symbol,
                    tf: body.tf,
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
                },
                aiMeta: { tier, threshold },
            });
            res.json({ ok: true, action: 'OPENED', tier, strictness: { confidenceThreshold: threshold }, decision, ...result });
        }
        catch (e) {
            if (e?.halt) {
                return res.status(400).json({ error: { code: e.halt.code || 'RISK_LIMIT', message: e.message, meta: e.halt.meta } });
            }
            res.status(400).json({ error: { code: 'EXECUTE_FAILED', message: String(e?.message ?? e) } });
        }
    });
    // Live execution is queued (restart-safe). Worker must be running.
    // Live is disabled by default and must be explicitly enabled server-side.
    r.post('/live/execute-signal', async (req, res) => {
        const userId = req.userId;
        const halted = await isUserHalted(userId);
        if (halted.halted)
            return res.status(423).json({ error: { code: 'HALTED', message: 'Trading halted', reasons: halted.reasons } });
        const tier = await getUserTier(userId);
        if (tier !== 'VIP') {
            return res.status(402).json({ error: { code: 'UPGRADE_REQUIRED', message: 'Live execution requires VIP.' } });
        }
        const body = ExecSignalSchema.parse(req.body ?? {});
        const task = await enqueueTask(userId, 'LIVE_EXECUTE_SIGNAL', {
            symbol: body.symbol,
            tf: body.tf,
            orderUsd: body.orderUsd ?? 100,
            leverage: body.leverage ?? 5,
            idempotencyKey: body.idempotencyKey,
            requestedAt: new Date().toISOString(),
        });
        res.status(202).json({ queued: true, task });
    });
    r.post('/live/verify-key', async (req, res) => {
        const userId = req.userId;
        const halted = await isUserHalted(userId);
        if (halted.halted)
            return res.status(423).json({ error: { code: 'HALTED', message: 'Trading halted', reasons: halted.reasons } });
        const tier = await getUserTier(userId);
        if (tier === 'BASIC') {
            return res.status(402).json({ error: { code: 'UPGRADE_REQUIRED', message: 'Key verification requires Pro or VIP.' } });
        }
        const task = await enqueueTask(userId, 'LIVE_VERIFY_KEY', { requestedAt: new Date().toISOString() });
        res.status(202).json({ queued: true, task });
    });
    return r;
}
