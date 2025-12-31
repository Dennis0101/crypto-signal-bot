import type { Trade } from '../../clients/bitget.js';

export type Ohlc = { time: number; open: number; high: number; low: number; close: number; volume: number };

export function tradesToOhlc(trades: Trade[], bucketMs: number): Ohlc[] {
  const sorted = trades.slice().sort((a, b) => a.time - b.time);
  const buckets = new Map<number, Ohlc>();

  for (const t of sorted) {
    const ts = Math.floor(t.time / bucketMs) * bucketMs;
    const existing = buckets.get(ts);
    if (!existing) {
      buckets.set(ts, {
        time: ts,
        open: t.price,
        high: t.price,
        low: t.price,
        close: t.price,
        volume: Math.abs(t.size),
      });
    } else {
      existing.high = Math.max(existing.high, t.price);
      existing.low = Math.min(existing.low, t.price);
      existing.close = t.price;
      existing.volume += Math.abs(t.size);
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

