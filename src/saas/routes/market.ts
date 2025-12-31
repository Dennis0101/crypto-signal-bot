import { Router } from 'express';
import { z } from 'zod';
import { fetchCandles, fetchRecentTrades } from '../../clients/bitget.js';
import { tradesToOhlc } from '../market/aggregate.js';
import { timeframeToMs, type Timeframe } from '../market/timeframes.js';
import type { AuthedRequest } from '../http/middleware.js';
import { getUserTier, requireTier } from '../tier/tier.js';

const CandlesQuery = z.object({
  symbol: z.string().min(3).max(30).default('BTCUSDT'),
  tf: z.custom<Timeframe>((v) => typeof v === 'string', 'tf').transform((v) => String(v) as Timeframe),
  limit: z.coerce.number().int().min(20).max(2000).default(300),
});

export function createRouter() {
  const r = Router();

  r.get('/candles', async (req: AuthedRequest, res) => {
    const q = CandlesQuery.parse(req.query);
    const tfMs = timeframeToMs(q.tf);
    if (!tfMs) return res.status(400).json({ error: { code: 'BAD_TF', message: 'Unsupported timeframe' } });

    // Small timeframes are synthesized from trades (higher load → capped limits).
    if (tfMs < 60_000) {
      const tier = req.userId ? await getUserTier(req.userId) : 'BASIC';
      const gate = requireTier(tier, 'PRO');
      if (!gate.ok) {
        return res.status(402).json({
          error: { code: 'UPGRADE_REQUIRED', message: 'Sub-minute timeframes require Pro plan.' },
        });
      }
      const end = Date.now();
      const start = end - Math.min(q.limit, 1000) * tfMs;
      const trades = await fetchRecentTrades(q.symbol, start, end, 5000);
      const ohlc = tradesToOhlc(trades, tfMs).slice(-q.limit);
      return res.json({ symbol: q.symbol, tf: q.tf, candles: ohlc });
    }

    // For >= 1m: use exchange candles (best-effort mapping).
    const tfMap: Record<string, string> = {
      '1m': '1m',
      '3m': '3m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1h',
      '4h': '4h',
      '1d': '1d',
      '1w': '1w',
      '1M': '1M',
    };

    const exTf = tfMap[q.tf];
    if (!exTf) {
      // 1y: synthesize from 1w/1d depending on what the exchange supports
      const fallback = '1w';
      try {
        const candles = await fetchCandles(q.symbol, fallback, Math.min(q.limit, 1000));
        return res.json({ symbol: q.symbol, tf: q.tf, candles });
      } catch (e: any) {
        return res.status(502).json({ error: { code: 'CANDLES_FAILED', message: String(e?.message ?? e) } });
      }
    }

    try {
      const candles = await fetchCandles(q.symbol, exTf, Math.min(q.limit, 1000));
      return res.json({ symbol: q.symbol, tf: q.tf, candles });
    } catch (e: any) {
      return res.status(502).json({ error: { code: 'CANDLES_FAILED', message: String(e?.message ?? e) } });
    }
  });

  return r;
}

