import { fetchTicker } from '../clients/bitget.js';
import {
  getAccount, getPosition, upsertPosition, removePosition,
  addEquity, setOrderAmount, setLeverage, setCurrency, setEnabled,
  resetAccount, type Side
} from './store.js';
import { qtyFromNotionalUSD, unrealizedPnlUSD } from './math.js';

export function toggleEnabled(userId: string): boolean {
  const acc = getAccount(userId);
  acc.enabled = !acc.enabled;
  return acc.enabled;
}

export function toggleCurrency(userId: string): 'USD' | 'KRW' {
  const acc = getAccount(userId);
  acc.currency = acc.currency === 'USD' ? 'KRW' : 'USD';
  return acc.currency;
}

export function setPaperAmount(userId: string, usd: number): number {
  setOrderAmount(userId, usd);
  return getAccount(userId).orderAmountUSD;
}

export function setPaperLeverage(userId: string, lev: number): number {
  setLeverage(userId, lev);
  return getAccount(userId).leverage;
}

export function resetPaper(userId: string) {
  resetAccount(userId);
}

/** 시장가 체결(가상) */
export async function placePaperOrder(userId: string, symbol: string, side: Side): Promise<{price:number; qty:number; lev:number}> {
  const acc = getAccount(userId);
  if (!acc.enabled) throw new Error('Paper OFF');

  const t = await fetchTicker(symbol);
  if (!t || !isFinite(t.price)) throw new Error('현재가 조회 실패');
  const price = t.price;

  const lev = acc.leverage;
  const qty = qtyFromNotionalUSD(acc.orderAmountUSD, price, lev);

  const ex = getPosition(userId, symbol);
  if (ex) {
    if (ex.side === side) {
      // 동일 방향 → 평균가 갱신
      const notionalOld = ex.entry * ex.qty;
      const notionalNew = price * qty;
      const qtySum = ex.qty + qty;
      const entryNew = qtySum > 0 ? (notionalOld + notionalNew) / qtySum : price;
      upsertPosition(userId, { ...ex, entry: entryNew, qty: qtySum, lev });
      return { price, qty, lev };
    } else {
      // 반대 → 기존 청산 후 새 포지션
      await closePaperPosition(userId, symbol);
    }
  }

  upsertPosition(userId, {
    symbol, side, entry: price, qty, lev, openedAt: Date.now(),
  });
  return { price, qty, lev };
}

/** 청산 */
export async function closePaperPosition(userId: string, symbol: string): Promise<{price:number; pnl:number}> {
  const pos = getPosition(userId, symbol);
  if (!pos) throw new Error('포지션 없음');

  const t = await fetchTicker(symbol);
  if (!t || !isFinite(t.price)) throw new Error('현재가 조회 실패');
  const price = t.price;

  const pnl = unrealizedPnlUSD(pos.side, pos.entry, price, pos.qty);
  addEquity(userId, pnl);
  removePosition(userId, symbol);
  return { price, pnl };
}

/** 반전 */
export async function flipPaperPosition(userId: string, symbol: string) {
  const pos = getPosition(userId, symbol);
  if (!pos) throw new Error('포지션 없음');
  await closePaperPosition(userId, symbol);
  const newSide: Side = pos.side === 'LONG' ? 'SHORT' : 'LONG';
  return placePaperOrder(userId, symbol, newSide);
}
