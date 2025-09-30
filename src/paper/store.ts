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
  realizedPnl: number;
}

const SAVE_PATH = path.resolve('data/paper.json');

// 🏦 서버별 계정 저장소 (guildId -> userId -> Account)
const accounts: Map<string, Map<string, Account>> = new Map();

/* ===================== 계정 접근 ===================== */
export function getAccount(guildId: string, userId: string): Account {
  if (!accounts.has(guildId)) accounts.set(guildId, new Map());
  const guildMap = accounts.get(guildId)!;

  if (!guildMap.has(userId)) {
    guildMap.set(userId, {
      equityUSD: 100_000,
      orderAmountUSD: 100,
      leverage: 5,
      currency: 'USD',
      enabled: false,
      positions: new Map(),
      openedAt: Date.now(),
      realizedPnl: 0,
    });
  }
  return guildMap.get(userId)!;
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
  getAccount(guildId, userId).orderAmountUSD = usd;
}

export function setLeverage(guildId: string, userId: string, lev: number) {
  getAccount(guildId, userId).leverage = lev;
}

export function setCurrency(guildId: string, userId: string, c: 'USD' | 'KRW') {
  getAccount(guildId, userId).currency = c;
}

export function setEnabled(guildId: string, userId: string, e: boolean) {
  getAccount(guildId, userId).enabled = e;
}

export function resetAccount(guildId: string, userId: string) {
  accounts.get(guildId)?.set(userId, {
    equityUSD: 100_000,
    orderAmountUSD: 100,
    leverage: 5,
    currency: 'USD',
    enabled: false,
    positions: new Map(),
    openedAt: Date.now(),
    realizedPnl: 0,
  });
}

/* ===================== 랭킹 기능 ===================== */
export function getRanking(guildId: string) {
  const guildMap = accounts.get(guildId);
  if (!guildMap) return [];

  return Array.from(guildMap.entries())
    .map(([userId, acc]) => {
      const total = acc.equityUSD + acc.realizedPnl;
      const roi = ((total - 100_000) / 100_000) * 100;
      return { userId, total, roi };
    })
    .sort((a, b) => b.total - a.total);
}

/* ===================== 스냅샷 저장/로드 ===================== */
export function saveSnapshot() {
  const plain: Record<string, Record<string, any>> = {};
  for (const [guildId, guildMap] of accounts.entries()) {
    plain[guildId] = {};
    for (const [userId, acc] of guildMap.entries()) {
      plain[guildId][userId] = {
        ...acc,
        positions: Array.from(acc.positions.values()), // Map → Array
      };
    }
  }
  fs.mkdirSync(path.dirname(SAVE_PATH), { recursive: true });
  fs.writeFileSync(SAVE_PATH, JSON.stringify(plain, null, 2));
}

export function loadSnapshot() {
  if (!fs.existsSync(SAVE_PATH)) return;
  const raw = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'));
  for (const [guildId, guildUsers] of Object.entries(raw)) {
    const guildMap = new Map<string, Account>();
    for (const [userId, acc] of Object.entries(guildUsers as any)) {
      guildMap.set(userId, {
        ...acc,
        positions: new Map((acc as any).positions.map((p: Position) => [p.symbol, p])),
      });
    }
    accounts.set(guildId, guildMap);
  }
}

// ⏱️ 주기적 저장
setInterval(saveSnapshot, 30_000);

// 종료 시 저장
process.on('SIGINT', () => {
  saveSnapshot();
  process.exit(0);
});
