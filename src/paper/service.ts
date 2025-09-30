// src/paper/service.ts
import {
  getAccount, getPosition, upsertPosition, removePosition,
  addEquity, setOrderAmount, setLeverage, setCurrency, setEnabled,
  resetAccount, type Side
} from './store.js';
import { qtyFromNotionalUSD, unrealizedPnlUSD } from './math.js';
import { getSafePrice } from './price.js';

export function toggleEnabled(userId: string, guildId?: string): boolean {
  const acc = getAccount(userId, guildId);
  acc.enabled = !acc.enabled;
  return acc.enabled;
}

export function toggleCurrency(userId: string, guildId?: string): 'USD' | 'KRW' {
  const acc = getAccount(userId, guildId);
  acc.currency = acc.currency === 'USD' ? 'KRW' : 'USD';
  return acc.currency;
}

export function setPaperAmount(userId: string, usd: number, guildId?: string): number {
  return setOrderAmount(userId, usd, guildId);
}

export function setPaperLeverage(userId: string, lev: number, guildId?: string): number {
  return setLeverage(userId, lev, guildId);
}

export function resetPaper(userId: string, guildId?: string) {
  resetAccount(userId, guildId);
}

export async function placePaperOrder(
  userId: string,
  symbol: string,
  side: Side,
  guildId?: string
): Promise<{ price: number; qty: number; lev: number }> {
  const acc = getAccount(userId, guildId);
  if (!acc.enabled) throw new Error('Paper OFF');

  const price = await getSafePrice(symbol);
  if (!isFinite(price)) throw new Error('현재가 조회 실패');

  const lev = acc.leverage;
  const qty = qtyFromNotionalUSD(acc.orderAmountUSD, price, lev);

  const ex = getPosition(userId, symbol, guildId);
  if (ex) {
    if (ex.side === side) {
      const notionalOld = ex.entry * ex.qty;
      const notionalNew = price * qty;
      const qtySum = ex.qty + qty;
      const entryNew = qtySum > 0 ? (notionalOld + notionalNew) / qtySum : price;
      upsertPosition(userId, { ...ex, entry: entryNew, qty: qtySum, lev }, guildId);
      return { price, qty, lev };
    } else {
      await closePaperPosition(userId, symbol, guildId);
    }
  }

  upsertPosition(userId, { symbol, side, entry: price, qty, lev, openedAt: Date.now() }, guildId);
  return { price, qty, lev };
}

export async function closePaperPosition(
  userId: string,
  symbol: string,
  guildId?: string
): Promise<{ price: number; pnl: number }> {
  const pos = getPosition(userId, symbol, guildId);
  if (!pos) throw new Error('포지션 없음');

  const price = await getSafePrice(symbol);
  if (!isFinite(price)) throw new Error('현재가 조회 실패');

  const pnl = unrealizedPnlUSD(pos.side, pos.entry, price, pos.qty);
  addEquity(userId, pnl, guildId);
  removePosition(userId, symbol, guildId);
  return { price, pnl };
}

export async function flipPaperPosition(userId: string, symbol: string, guildId?: string) {
  const pos = getPosition(userId, symbol, guildId);
  if (!pos) throw new Error('포지션 없음');
  await closePaperPosition(userId, symbol, guildId);
  const newSide: Side = pos.side === 'LONG' ? 'SHORT' : 'LONG';
  return placePaperOrder(userId, symbol, newSide, guildId);
}
