import { CONFIG } from '../config.js';

export type Side = 'LONG' | 'SHORT';
export type Currency = 'USD' | 'KRW';

export interface Position {
  symbol: string;
  side: Side;
  entry: number;   // 평균 진입가
  qty: number;     // 계약 수량(코인 수량)
  lev: number;
  openedAt: number;
}

export interface Account {
  userId: string;
  enabled: boolean;
  currency: Currency;
  equityUSD: number;        // 현금(미실현 포함 총자산은 계산 시 구함)
  orderAmountUSD: number;   // 1회 주문 금액(USD)
  leverage: number;
  positions: Map<string, Position>; // symbol -> position
}

const accounts = new Map<string, Account>();

export function getAccount(userId: string): Account {
  let acc = accounts.get(userId);
  if (!acc) {
    acc = {
      userId,
      enabled: true,
      currency: 'USD',
      equityUSD: CONFIG.PAPER.DEFAULT_EQUITY_USD,
      orderAmountUSD: 100,
      leverage: CONFIG.PAPER.DEFAULT_LEVERAGE,
      positions: new Map(),
    };
    accounts.set(userId, acc);
  }
  return acc;
}

export function setEnabled(userId: string, on: boolean) {
  getAccount(userId).enabled = on;
}

export function setCurrency(userId: string, cur: Currency) {
  getAccount(userId).currency = cur;
}

export function setOrderAmount(userId: string, usd: number) {
  getAccount(userId).orderAmountUSD = Math.max(1, Math.round(usd));
}

export function setLeverage(userId: string, lev: number) {
  const L = Math.min(CONFIG.PAPER.MAX_LEVERAGE, Math.max(1, Math.floor(lev)));
  getAccount(userId).leverage = L;
}

export function upsertPosition(userId: string, p: Position) {
  getAccount(userId).positions.set(p.symbol, p);
}

export function getPosition(userId: string, symbol: string): Position | undefined {
  return getAccount(userId).positions.get(symbol);
}

export function removePosition(userId: string, symbol: string) {
  getAccount(userId).positions.delete(symbol);
}

export function addEquity(userId: string, deltaUSD: number) {
  getAccount(userId).equityUSD += deltaUSD;
}

export function resetAccount(userId: string) {
  const acc = getAccount(userId);
  acc.equityUSD = CONFIG.PAPER.DEFAULT_EQUITY_USD;
  acc.orderAmountUSD = 100;
  acc.leverage = CONFIG.PAPER.DEFAULT_LEVERAGE;
  acc.positions.clear();
}
