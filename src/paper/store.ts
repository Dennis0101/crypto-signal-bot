// src/paper/store.ts
import fs from 'fs';
import path from 'path';

export type Side = 'LONG' | 'SHORT';

export interface Position {
  symbol: string;
  side: Side;
  entry: number;
  qty: number;
  lev: number;
  openedAt: number;
}

export interface Account {
  equityUSD: number;
  orderAmountUSD: number;
  leverage: number;
  currency: 'USD' | 'KRW';
  enabled: boolean;
  positions: Map<string, Position>;
  openedAt: number;
  realizedPnl: number; // 누적 실현손익
}

const SAVE_PATH = path.resolve('data/paper.json');

// ✅ 서버별(guildId) → 유저별(userId) → 계정
const accounts: Map<string, Map<string, Account>> = new Map();

const DEFAULT_ACCOUNT = (): Account => ({
  equityUSD: 100_000,
  orderAmountUSD: 100,
  leverage: 5,
  currency: 'USD',
  enabled: false,
  positions: new Map(),
  openedAt: Date.now(),
  realizedPnl: 0,
});

export function getAccount(guildId: string, userId: string): Account {
  if (!accounts.has(guildId)) accounts.set(guildId, new Map());
  const g = accounts.get(guildId)!;
  if (!g.has(userId)) g.set(userId, DEFAULT_ACCOUNT());
  return g.get(userId)!;
}

export function getPosition(guildId: string, userId: string, symbol: string) {
  return getAccount(guildId, userId).positions.get(symbol);
}

export function upsertPosition(guildId: string, userId: string, pos: Position) {
  getAccount(guildId, userId).positions.set(pos.symbol, pos);
}

export function removePosition(guildId: string, userId: string, symbol: string) {
  getAccount(guildId, userId).positions.delete(symbol);
}

export function addEquity(guildId: string, userId: string, delta: number) {
  const acc = getAccount(guildId, userId);
  acc.equityUSD += delta;
  acc.realizedPnl += delta;
}

export function setOrderAmount(guildId: string, userId: string, usd: number) {
  const acc = getAccount(guildId, userId);
  acc.orderAmountUSD = usd;
}

export function setLeverage(guildId: string, userId: string, lev: number) {
  const acc = getAccount(guildId, userId);
  acc.leverage = lev;
}

export function setCurrency(guildId: string, userId: string, c: 'USD' | 'KRW') {
  getAccount(guildId, userId).currency = c;
}

export function setEnabled(guildId: string, userId: string, e: boolean) {
  getAccount(guildId, userId).enabled = e;
}

export function resetAccount(guildId: string, userId: string) {
  if (!accounts.has(guildId)) accounts.set(guildId, new Map());
  accounts.get(guildId)!.set(userId, DEFAULT_ACCOUNT());
}

/* =============== 랭킹 =============== */
export function getRanking(guildId: string) {
  const g = accounts.get(guildId);
  if (!g) return [];
  return Array.from(g.entries())
    .map(([userId, acc]) => {
      const total = acc.equityUSD + acc.realizedPnl;
      const roi = ((total - 100_000) / 100_000) * 100;
      return { userId, total, roi };
    })
    .sort((a, b) => b.total - a.total);
}

/* =============== 스냅샷 저장/로드 =============== */
function accountToPlain(acc: Account) {
  return {
    equityUSD: acc.equityUSD,
    orderAmountUSD: acc.orderAmountUSD,
    leverage: acc.leverage,
    currency: acc.currency,
    enabled: acc.enabled,
    openedAt: acc.openedAt,
    realizedPnl: acc.realizedPnl,
    positions: Array.from(acc.positions.values()), // Map -> Array
  };
}

export function saveSnapshot() {
  const plain: Record<string, Record<string, ReturnType<typeof accountToPlain>>> = {};
  for (const [guildId, gmap] of accounts.entries()) {
    plain[guildId] = {};
    for (const [userId, acc] of gmap.entries()) {
      plain[guildId][userId] = accountToPlain(acc);
    }
  }
  fs.mkdirSync(path.dirname(SAVE_PATH), { recursive: true });
  fs.writeFileSync(SAVE_PATH, JSON.stringify(plain, null, 2), 'utf8');
}

export function loadSnapshot() {
  if (!fs.existsSync(SAVE_PATH)) return;
  const raw = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8')) as Record<
    string,
    Record<
      string,
      {
        equityUSD: number;
        orderAmountUSD: number;
        leverage: number;
        currency: 'USD' | 'KRW';
        enabled: boolean;
        openedAt: number;
        realizedPnl: number;
        positions: Position[];
      }
    >
  >;

  for (const [guildId, users] of Object.entries(raw)) {
    const gmap = new Map<string, Account>();
    for (const [userId, a] of Object.entries(users)) {
      gmap.set(userId, {
        equityUSD: a.equityUSD,
        orderAmountUSD: a.orderAmountUSD,
        leverage: a.leverage,
        currency: a.currency,
        enabled: a.enabled,
        openedAt: a.openedAt,
        realizedPnl: a.realizedPnl,
        positions: new Map(a.positions.map(p => [p.symbol, p])),
      });
    }
    accounts.set(guildId, gmap);
  }
}

// 주기 저장 + 종료 시 저장
setInterval(saveSnapshot, 30_000);
process.on('SIGINT', () => {
  saveSnapshot();
  process.exit(0);
});
