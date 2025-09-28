import { getAccount, resetAccount, type Side } from './store.js';
import { clampLev, qtyFromAmount, positionPnlUSD, marginUsedUSD } from './math.js';
import { fetchTicker } from '../clients/bitget.js';

export async function placePaperOrder(userId: string, symbol: string, side: Side) {
  const acc = getAccount(userId);
  if (!acc.enabled) throw new Error('Paper trading disabled');

  const t = await fetchTicker(symbol);
  if (!t) throw new Error('가격을 가져오지 못했습니다.');
  const price = t.price;

  const lev = clampLev(acc.leverage);
  const qty = qtyFromAmount(acc.orderAmountUSD, lev, price);
  if (qty <= 0) throw new Error('수량이 0입니다(금액/레버리지/가격 확인).');

  acc.positions.push({
    symbol, side, entry: price, qty, leverage: lev, openedAt: Date.now()
  });

  // 대략적 사용 마진 갱신
  acc.usedMarginUSD += (acc.orderAmountUSD);
  return { price, qty, lev };
}

export async function closePaperPosition(userId: string, symbol: string) {
  const acc = getAccount(userId);
  const posIdx = acc.positions.findIndex(p => p.symbol === symbol);
  if (posIdx < 0) throw new Error('해당 심볼 포지션이 없습니다.');
  const pos = acc.positions[posIdx];

  const t = await fetchTicker(symbol);
  if (!t) throw new Error('가격을 가져오지 못했습니다.');
  const price = t.price;

  const pnl = positionPnlUSD(pos, price);
  acc.equityUSD += pnl; // 실현손익 반영
  acc.usedMarginUSD = Math.max(0, acc.usedMarginUSD - (price*pos.qty/pos.leverage));

  acc.history.unshift({
    symbol: pos.symbol, side: pos.side, entry: pos.entry, exit: price,
    qty: pos.qty, leverage: pos.leverage, pnlUSD: pnl,
    openedAt: pos.openedAt, closedAt: Date.now()
  });
  acc.positions.splice(posIdx, 1);
  return { price, pnl };
}

export async function flipPaperPosition(userId: string, symbol: string) {
  const acc = getAccount(userId);
  const t = await fetchTicker(symbol);
  if (!t) throw new Error('가격을 가져오지 못했습니다.');
  const price = t.price;

  // 있으면 청산 후 반대 사이드로 재진입
  const exists = acc.positions.find(p => p.symbol === symbol);
  if (exists) await closePaperPosition(userId, symbol);

  const side: Side = exists?.side === 'LONG' ? 'SHORT' : 'LONG';
  return placePaperOrder(userId, symbol, side);
}

export function setPaperAmount(userId: string, amountUSD: number) {
  const acc = getAccount(userId);
  acc.orderAmountUSD = Math.max(1, Math.floor(amountUSD));
  return acc.orderAmountUSD;
}

export function setPaperLeverage(userId: string, lev: number) {
  const acc = getAccount(userId);
  acc.leverage = clampLev(lev);
  return acc.leverage;
}

export function toggleCurrency(userId: string) {
  const acc = getAccount(userId);
  acc.currency = acc.currency === 'USD' ? 'KRW' : 'USD';
  return acc.currency;
}

export function toggleEnabled(userId: string) {
  const acc = getAccount(userId);
  acc.enabled = !acc.enabled;
  return acc.enabled;
}

export function resetPaper(userId: string) {
  return resetAccount(userId);
}
