import { CONFIG } from '../config.js';

/** 주문 금액 → 수량 계산 */
export function qtyFromNotionalUSD(notionalUSD: number, price: number, lev: number): number {
  if (!isFinite(notionalUSD) || !isFinite(price) || !isFinite(lev) || price <= 0 || lev <= 0) return 0;
  return (notionalUSD * lev) / price;
}

/** 미실현 손익 계산 */
export function unrealizedPnlUSD(side: 'LONG'|'SHORT', entry: number, price: number, qty: number): number {
  if (!isFinite(entry) || !isFinite(price) || !isFinite(qty)) return 0;
  const diff = price - entry;
  const pnl = side === 'LONG' ? diff * qty : -diff * qty;
  return pnl;
}

/** 원화 환산 */
export function usdToKrw(usd: number): number {
  return usd * (CONFIG.PAPER.FX_USDKRW || 1400);
}

/** 통화 포맷터 */
export function fmtUSD(n: number): string {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}
export function fmtKRW(n: number): string {
  const v = Math.round(n);
  return `${v.toLocaleString('ko-KR')}원`;
}
