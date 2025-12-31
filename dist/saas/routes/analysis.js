import { Router } from 'express';
import { z } from 'zod';
import { fetchCandles, fetchRecentTrades } from '../../clients/bitget.js';
import { calcBaseFeatures } from '../../indicators/calc.js';
import { buildCVDandProfile } from '../../indicators/cvd.js';
import { decide } from '../../strategy/signal.js';
import { requireAuth } from '../http/middleware.js';
import { getUserTier } from '../tier/tier.js';
import { confidenceThresholdForTier } from '../ai/strictness.js';
const Query = z.object({
    symbol: z.string().min(3).max(30).default('BTCUSDT'),
    tf: z.string().min(2).max(10).default('15m'),
});
export function createRouter() {
    const r = Router();
    r.use(requireAuth);
    r.get('/signal', async (req, res) => {
        const userId = req.userId;
        const q = Query.parse(req.query);
        const tier = await getUserTier(userId);
        const threshold = confidenceThresholdForTier(tier);
        const candles = await fetchCandles(q.symbol, q.tf, 300);
        const f = calcBaseFeatures(candles);
        const tfMin = q.tf.endsWith('m')
            ? Number(q.tf.replace('m', ''))
            : q.tf.endsWith('h')
                ? Number(q.tf.replace('h', '')) * 60
                : 15;
        const end = Date.now();
        const start = end - Math.max(tfMin, 15) * 60 * 1000;
        const trades = await fetchRecentTrades(q.symbol, start, end, 5000);
        const { cvdSeries, profile } = buildCVDandProfile(trades, tfMin * 60 * 1000, Math.max(0.5, f.last * 0.001));
        const decision = await decide(q.symbol, q.tf, f, cvdSeries, profile);
        const action = decision.recommend !== 'NEUTRAL' && decision.confidence >= threshold ? 'TRADE_CANDIDATE' : 'NO_TRADE';
        const policyReason = action === 'NO_TRADE'
            ? `Policy: tier=${tier}, requiredConfidence>=${threshold}.`
            : `Policy: tier=${tier}, passedConfidence>=${threshold}.`;
        res.json({
            symbol: q.symbol,
            tf: q.tf,
            tier,
            strictness: { confidenceThreshold: threshold },
            action,
            decision: {
                recommend: decision.recommend,
                confidence: decision.confidence,
                reasons: [...decision.reasons, policyReason],
                rationale: decision.rationale,
                risk: decision.risk,
                levels: decision.levels,
                source: decision.source,
            },
        });
    });
    return r;
}
