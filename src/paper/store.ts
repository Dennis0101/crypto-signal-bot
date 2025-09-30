// src/paper/store.ts
import { CONFIG } from '../config.js';
import {
  loadSnapshot, saveSnapshot, makeEmptySnapshot,
  type Snapshot, type SerializableAccount, type SerializablePosition
} from './persist.js';

/* =====================
   타입
===================== */
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
  equityUSD: number;
  currency: 'USD' | 'KRW';
  leverage: number;
  orderAmountUSD: number;
  enabled: boolean;
  positions: Map<string, Position>; // symbol -> pos
};

/* =====================
   설정 / 기본값
===================== */
const PAPER_CFG = (CONFIG as any)?.PAPER ?? {};
const INIT_EQUITY  = Number(PAPER_CFG.DEFAULT_EQUITY_USD ?? 100_000); // 요청: 10만 달러
const INIT_LEV     = Number(PAPER_CFG.DEFAULT_LEVERAGE ?? 50);        // 요청: 50배 기본
const MAX_LEV      = Number(PAPER_CFG.MAX_LEVERAGE ?? 50);
const MIN_ORDER    = Number(PAPER_CFG.MIN_ORDER_USD ?? 100);          // 요청: 최소 $100
const MAX_ORDER    = Number(PAPER_CFG.MAX_ORDER_USD ?? 10_000);       // 요청: 최대 $10,000
const SCOPE: 'global' | 'per_guild' = (PAPER_CFG.SCOPE ?? 'global');  // 필요 시 'per_guild'

/* =====================
   내부 상태
===================== */
const accounts = new Map<string, Account>(); // key -> account

function makeKey(userId: string, guildId?: string | null) {
  if (SCOPE === 'per_guild') return `${guildId ?? 'DM'}:${userId}`;
  return userId; // 글로벌(전 서버 공용)
}

/* =====================
   직렬화/역직렬화
===================== */
function accountToSerializable(acc: Account): SerializableAccount {
  const positions: Record<string, SerializablePosition> = {};
  for (const [sym, p] of acc.positions.entries()) {
    positions[sym] = { ...p };
  }
  return {
    equityUSD: acc.equityUSD,
    currency: acc.currency,
    leverage: acc.leverage,
    orderAmountUSD: acc.orderAmountUSD,
    enabled: acc.enabled,
    positions
  };
}

function serializableToAccount(s: SerializableAccount): Account {
  const map = new Map<string, Position>();
  if (s.positions && typeof s.positions === 'object') {
    for (const [sym, p] of Object.entries(s.positions)) {
      map.set(sym, { ...p });
    }
  }
  return {
    equityUSD: Number.isFinite(s.equityUSD) ? s.equityUSD : INIT_EQUITY,
    currency: (s.currency === 'KRW' ? 'KRW' : 'USD'),
    leverage: clampLev(s.leverage),
    orderAmountUSD: clampOrder(s.orderAmountUSD),
    enabled: !!s.enabled,
    positions: map
  };
}

/* =====================
   퍼시스턴스: 로드/세이브(디바운스)
===================== */
let _saveTimer: NodeJS.Timeout | null = null;

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(doSave, 1000);
}

async function doSave() {
  _saveTimer = null;
  const snap = makeEmptySnapshot();
  for (const [key, acc] of accounts.entries()) {
    snap.accounts[key] = accountToSerializable(acc);
  }
  snap.savedAt = Date.now();
  await saveSnapshot(snap);
}

async function loadAll() {
  const snap = await loadSnapshot();
  if (!snap || !snap.accounts) return; // 없으면 빈 상태
  for (const [key, sacc] of Object.entries(snap.accounts)) {
    accounts.set(key, serializableToAccount(sacc));
  }
}

// 모듈 로드시 자동 로드
await loadAll().catch(e => console.error('[store] load error:', e));

/* =====================
   유틸
===================== */
function clampLev(v: number) {
  const x = Math.max(1, Math.min(Number.isFinite(v) ? v : INIT_LEV, MAX_LEV));
  return Math.floor(x);
}
function clampOrder(v: number) {
  const x = Math.max(MIN_ORDER, Math.min(Number.isFinite(v) ? v : MIN_ORDER, MAX_ORDER));
  return Math.round(x);
}

/* =====================
   public API (service.ts 등에서 사용)
===================== */
export function getAccount(userId: string, guildId?: string | null): Account {
  const key = makeKey(userId, guildId);
  let acc = accounts.get(key);
  if (!acc) {
    acc = {
      equityUSD: INIT_EQUITY,
      currency: 'USD',
      leverage: clampLev(INIT_LEV),
      orderAmountUSD: clampOrder(MIN_ORDER),
      enabled: true,
      positions: new Map()
    };
    accounts.set(key, acc);
    scheduleSave();
  }
  return acc;
}

export function getPosition(userId: string, symbol: string, guildId?: string | null): Position | null {
  const acc = getAccount(userId, guildId);
  return acc.positions.get(symbol) ?? null;
}

export function upsertPosition(userId: string, pos: Position, guildId?: string | null) {
  const acc = getAccount(userId, guildId);
  acc.positions.set(pos.symbol, pos);
  scheduleSave();
}

export function removePosition(userId: string, symbol: string, guildId?: string | null) {
  const acc = getAccount(userId, guildId);
  acc.positions.delete(symbol);
  scheduleSave();
}

export function addEquity(userId: string, deltaUSD: number, guildId?: string | null) {
  const acc = getAccount(userId, guildId);
  acc.equityUSD = Number(acc.equityUSD) + Number(deltaUSD || 0);
  scheduleSave();
}

export function setOrderAmount(userId: string, usd: number, guildId?: string | null) {
  const acc = getAccount(userId, guildId);
  acc.orderAmountUSD = clampOrder(usd);
  scheduleSave();
}

export function setLeverage(userId: string, lev: number, guildId?: string | null) {
  const acc = getAccount(userId, guildId);
  acc.leverage = clampLev(lev);
  scheduleSave();
}

export function setCurrency(userId: string, c: 'USD' | 'KRW', guildId?: string | null) {
  const acc = getAccount(userId, guildId);
  acc.currency = (c === 'KRW' ? 'KRW' : 'USD');
  scheduleSave();
}

export function setEnabled(userId: string, on: boolean, guildId?: string | null) {
  const acc = getAccount(userId, guildId);
  acc.enabled = !!on;
  scheduleSave();
}

export function resetAccount(userId: string, guildId?: string | null) {
  const key = makeKey(userId, guildId);
  const acc: Account = {
    equityUSD: INIT_EQUITY,
    currency: 'USD',
    leverage: clampLev(INIT_LEV),
    orderAmountUSD: clampOrder(MIN_ORDER),
    enabled: true,
    positions: new Map()
  };
  accounts.set(key, acc);
  scheduleSave();
}
