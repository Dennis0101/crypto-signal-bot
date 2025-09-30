// src/paper/store.ts
import { CONFIG } from '../config.js';

export type Side = 'LONG' | 'SHORT';

export type Position = {
  symbol: string;
  side: Side;
  entry: number;
  qty: number;
  lev: number;
  openedAt: number;
};

export type Account = {
  enabled: boolean;
  currency: 'USD' | 'KRW';
  equityUSD: number;
  orderAmountUSD: number;
  leverage: number;
  positions: Map<string, Position>; // key: symbol
};

const ACCOUNTS = new Map<string, Account>();

function keyOf(userId: string, guildId?: string) {
  if (CONFIG.PAPER.SCOPE === 'per_guild') {
    return `${guildId || 'dm'}:${userId}`;
  }
  return userId; // global
}

function newAccount(): Account {
  return {
    enabled: true,
    currency: 'USD',
    equityUSD: CONFIG.PAPER.DEFAULT_EQUITY_USD,
    orderAmountUSD: Math.min(
      Math.max(CONFIG.PAPER.MIN_ORDER_USD, 500),
      CONFIG.PAPER.MAX_ORDER_USD
    ),
    leverage: CONFIG.PAPER.DEFAULT_LEVERAGE,
    positions: new Map(),
  };
}

export function getAccount(userId: string, guildId?: string): Account {
  const k = keyOf(userId, guildId);
  let acc = ACCOUNTS.get(k);
  if (!acc) {
    acc = newAccount();
    ACCOUNTS.set(k, acc);
  }
  return acc;
}

export function setEnabled(userId: string, enabled: boolean, guildId?: string) {
  getAccount(userId, guildId).enabled = enabled;
}

export function setCurrency(userId: string, c: 'USD'|'KRW', guildId?: string) {
  getAccount(userId, guildId).currency = c;
}

export function setOrderAmount(userId: string, usd: number, guildId?: string) {
  const acc = getAccount(userId, guildId);
  const min = CONFIG.PAPER.MIN_ORDER_USD;
  const max = CONFIG.PAPER.MAX_ORDER_USD;
  const v = Math.min(Math.max(Math.round(usd), min), max);
  acc.orderAmountUSD = v;
  return v;
}

export function setLeverage(userId: string, lev: number, guildId?: string) {
  const acc = getAccount(userId, guildId);
  const v = Math.min(Math.max(Math.round(lev), 1), CONFIG.PAPER.MAX_LEVERAGE);
  acc.leverage = v;
  return v;
}

export function addEquity(userId: string, delta: number, guildId?: string) {
  const acc = getAccount(userId, guildId);
  acc.equityUSD += delta;
}

export function resetAccount(userId: string, guildId?: string) {
  const k = keyOf(userId, guildId);
  ACCOUNTS.set(k, newAccount());
}

export function getPosition(userId: string, symbol: string, guildId?: string) {
  return getAccount(userId, guildId).positions.get(symbol);
}

export function upsertPosition(userId: string, p: Position, guildId?: string) {
  getAccount(userId, guildId).positions.set(p.symbol, p);
}

export function removePosition(userId: string, symbol: string, guildId?: string) {
  getAccount(userId, guildId).positions.delete(symbol);
}
