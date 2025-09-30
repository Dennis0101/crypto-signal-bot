// src/paper/service.ts
import {
  getAccount, getPosition, upsertPosition, removePosition,
  addEquity, setOrderAmount, setLeverage, setCurrency, setEnabled,
  resetAccount, type Side
} from './store.js';
import { qtyFromNotionalUSD, unrealizedPnlUSD } from './math.js';
import { getSafePrice } from './price.js';

/** ON/OFF */
export function toggleEnabled(guildId: string, userId: string): boolean {
  const acc = getAccount(guildId, userId);
  acc.enabled = !acc.enabled;
  return acc.enabled;
}

/** USD↔KRW */
export function toggleCurrency(guildId: string, userId: string): 'USD' | 'KRW' {
  const acc = getAccount(guildId, userId);
  acc.currency = acc.currency === 'USD' ? 'KRW' : 'USD';
  setCurrency(guildId, userId, acc.currency);
  return acc.currency;
}

/** 주문 금액 설정 */
export function setPaperAmount(guildId: string, userId: string, usd: number): number {
  setOrderAmount(guildId, userId, usd);
  return getAccount(guildId, userId).orderAmountUSD;
}

/** 레버리지 설정 */
export function setPaperLeverage(guildId: string, userId: string, lev: number): number {
  setLeverage(guildId, userId, lev);
  return getAccount(guildId, userId).leverage;
}

export function resetPaper(guildId: string, userId: string) {
  resetAccount(guildId, userId);
}

/** 시장가 체결(가상) */
export async function placePaperOrder(
  guildId: string,
  userId: string,
  symbol: string,
  side: Side
): Promise<{ price: number; qty: number; lev: number }> {
  const acc = getAccount(guildId, userId);
  if (!acc.enabled) throw new Error('Paper OFF');

  const price = await getSafePrice(symbol);
  if (!isFinite(price)) throw new Error('현재가 조회 실패');

  const lev = acc.leverage;
  const qty = qtyFromNotionalUSD(acc.orderAmountUSD, price, lev);

  const ex = getPosition(guildId, userId, symbol);
  if (ex) {
    if (ex.side === side) {
      const notionalOld = ex.entry * ex.qty;
      const notionalNew = price * qty;
      const qtySum = ex.qty + qty;
      const entryNew = qtySum > 0 ? (notionalOld + notionalNew) / qtySum : price;
      upsertPosition(guildId, userId, { ...ex, entry: entryNew, qty: qtySum, lev });
      return { price, qty, lev };
    } else {
      await closePaperPosition(guildId, userId, symbol);
    }
  }

  upsertPosition(guildId, userId, {
    symbol, side, entry: price, qty, lev, openedAt: Date.now(),
  });
  return { price, qty, lev };
}

/** 청산 */
export async function closePaperPosition(
  guildId: string,
  userId: string,
  symbol: string
): Promise<{ price: number; pnl: number }> {
  const pos = getPosition(guildId, userId, symbol);
  if (!pos) throw new Error('포지션 없음');

  const price = await getSafePrice(symbol);
  if (!isFinite(price)) throw new Error('현재가 조회 실패');

  const pnl = unrealizedPnlUSD(pos.side, pos.entry, price, pos.qty);
  addEquity(guildId, userId, pnl);
  removePosition(guildId, userId, symbol);
  return { price, pnl };
}

/** 반전 */
export async function flipPaperPosition(guildId: string, userId: string, symbol: string) {
  const pos = getPosition(guildId, userId, symbol);
  if (!pos) throw new Error('포지션 없음');
  await closePaperPosition(guildId, userId, symbol);
  const newSide: Side = pos.side === 'LONG' ? 'SHORT' : 'LONG';
  return placePaperOrder(guildId, userId, symbol, newSide);
}
