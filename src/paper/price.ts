// src/paper/price.ts
import { fetchTicker, fetchCandles } from '../clients/bitget.js';

/** 티커 실패 시 1분봉 종가로 폴백 */
export async function getSafePrice(symbol: string): Promise<number> {
  const t = await fetchTicker(symbol);
  if (t && Number.isFinite(t.price)) return t.price;

  // fallback: 1m 캔들 마지막 종가
  const c = await fetchCandles(symbol, '1m', 2);
  const last = c.at(-1)?.close;
  if (Number.isFinite(last)) return last as number;

  throw new Error('현재가 조회 실패');
}
