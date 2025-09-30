// src/paper/price.ts
import { fetchTicker, fetchCandles } from '../clients/bitget.js';

type SafeTicker = { price: number; change24h?: number };

// ---- 간단 캐시 (짧은 TTL로 과호출 방지) ----
const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { at: number; price: number; change24h?: number }>();

function now() { return Date.now(); }
function isFiniteNum(n: any): n is number { return Number.isFinite(n); }
function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

/** 최근 n개의 1m 캔들로 중앙값 종가 계산 */
async function medianCloseFrom1m(symbol: string, n = 3): Promise<number | null> {
  const candles = await fetchCandles(symbol, '1m', Math.max(2, n));
  const closes = candles.slice(-n).map(c => c.close).filter(isFiniteNum);
  if (closes.length === 0) return null;
  const sorted = closes.slice().sort((a,b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 값이 최근 기준 대비 너무 튀면 이상치로 판단 (기본 15%) */
function isOutlier(value: number, ref: number, thresholdPct = 0.15): boolean {
  if (!isFiniteNum(value) || !isFiniteNum(ref) || ref <= 0) return true;
  const dev = Math.abs(value - ref) / ref;
  return dev > thresholdPct;
}

/** 안전한 현재가(USDT 선물) — 티커 → 폴백(1m 중앙값) */
export async function getSafePrice(symbol: string): Promise<number> {
  const key = `p:${symbol}`;
  const c = cache.get(key);
  if (c && now() - c.at < CACHE_TTL_MS && isFiniteNum(c.price)) return c.price;

  // 1) 티커 시도 (짧은 재시도)
  let lastErr: any = null;
  for (let k = 0; k < 2; k++) {
    try {
      const t = await fetchTicker(symbol);
      if (t && isFiniteNum(t.price)) {
        // 폴백 기준(최근 1m 중앙값)과 비교해 이상치면 캔들값 사용
        const ref = await medianCloseFrom1m(symbol, 3);
        const price = ref && isOutlier(t.price, ref) ? ref : t.price;
        cache.set(key, { at: now(), price, change24h: t.change24h });
        return price;
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(100 * (k + 1));
  }

  // 2) 폴백: 1m 캔들 중앙값
  const med = await medianCloseFrom1m(symbol, 3);
  if (isFiniteNum(med)) {
    cache.set(key, { at: now(), price: med });
    return med;
  }

  // 3) 그래도 실패
  throw new Error(`현재가 조회 실패${lastErr ? `: ${String(lastErr)}` : ''}`);
}

/** 안전한 티커(가격 + 24h 변화). 변화율이 없으면 캔들로 추정 */
export async function getSafeTicker(symbol: string): Promise<SafeTicker> {
  const key = `t:${symbol}`;
  const c = cache.get(key);
  if (c && now() - c.at < CACHE_TTL_MS && isFiniteNum(c.price)) {
    return { price: c.price, change24h: c.change24h };
  }

  // 우선 티커
  try {
    const t = await fetchTicker(symbol);
    if (t && isFiniteNum(t.price)) {
      // 이상치 방어
      const ref = await medianCloseFrom1m(symbol, 3);
      const price = ref && isOutlier(t.price, ref) ? ref : t.price;
      cache.set(key, { at: now(), price, change24h: t.change24h });
      return { price, change24h: t.change24h };
    }
  } catch { /* 무시하고 폴백 */ }

  // 폴백: 1m 중앙값 + 변화율 근사(직전 종가 대비)
  const candles = await fetchCandles(symbol, '1m', 2);
  const prev = candles.at(-2)?.close;
  const last = candles.at(-1)?.close;
  if (isFiniteNum(last)) {
    let change24h: number | undefined = undefined;
    if (isFiniteNum(prev) && prev > 0) {
      change24h = (last - prev) / prev; // 근사치 (1m 기준)
    }
    cache.set(key, { at: now(), price: last, change24h });
    return { price: last, change24h };
  }

  throw new Error('티커/캔들 모두 조회 실패');
}
