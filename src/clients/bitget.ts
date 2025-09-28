import fetch from "node-fetch";
import { CONFIG } from "../config.js";

export type Candle = {
  time: number;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type Trade = {
  time: number;
  price: number;
  size: number;
  side: "buy" | "sell";
};

export type Ticker = {
  symbol: string;       // BTCUSDT
  last: number;         // 최신가
  change24h: number;    // 24h 등락률 (소수: 0.031 = +3.1%)
  turnover24h: number;  // 24h 거래대금(USDT 환산)
  volume24h: number;    // 24h 거래량(기초자산 수량)
};

const base = CONFIG.BITGET_BASE;

/** 공통 JSON fetch */
async function fetchJson(url: URL) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status} ${res.statusText} • ${url.pathname} • ${body.slice(0,120)}`
    );
  }
  return await res.json();
}

/** ===== Helpers ===== */
const TF_TO_SECS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
};
const TF_VALID_STR = new Set(["1m", "5m", "15m", "1h", "4h"]);

function toV2Symbol(sym: string) {
  return sym.replace("_UMCBL", "");
}
function toV1FuturesSymbol(sym: string) {
  return sym.endsWith("_UMCBL") ? sym : `${sym}_UMCBL`;
}

function num(v: any, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** ===== Candles ===== */
export async function fetchCandles(
  symbol: string,
  tf: string,
  limit = 300
): Promise<Candle[]> {
  const tfSecs = TF_TO_SECS[tf] ?? 900;
  const tfStr = TF_VALID_STR.has(tf) ? tf : "15m";

  // 1) v2 mix
  try {
    const url = new URL("/api/v2/mix/market/candles", base);
    url.searchParams.set("symbol", toV2Symbol(symbol));
    url.searchParams.set("productType", "usdt-futures");
    url.searchParams.set("granularity", tfStr);
    url.searchParams.set("limit", String(Math.min(limit, 1000)));
    const j: any = await fetchJson(url);
    const rows: any[] = Array.isArray(j?.data) ? j.data : [];
    const out = rows
      .map((arr: any[]) => ({
        time: Number(arr[0]),
        open: Number(arr[1]),
        high: Number(arr[2]),
        low: Number(arr[3]),
        close: Number(arr[4]),
        volume: Number(arr[5]),
      }))
      .filter((o) => Number.isFinite(o.close))
      .reverse();
    if (out.length) return out;
  } catch {
    // 폴백
  }

  // 2) v1 mix (시간 범위 필수)
  const endMs = Date.now();
  const span = Math.max(50, Math.min(1000, limit)) * tfSecs * 1000;
  const startMs = endMs - span;
  try {
    const url = new URL("/api/mix/v1/market/candles", base);
    url.searchParams.set("symbol", toV1FuturesSymbol(symbol));
    url.searchParams.set("granularity", String(tfSecs));
    url.searchParams.set("startTime", String(Math.floor(startMs)));
    url.searchParams.set("endTime", String(Math.floor(endMs)));
    const j: any = await fetchJson(url);
    const rows: any[] = Array.isArray(j?.data) ? j.data : [];
    const out = rows
      .map((arr: any[]) => ({
        time: Number(arr[0]),
        open: Number(arr[1]),
        high: Number(arr[2]),
        low: Number(arr[3]),
        close: Number(arr[4]),
        volume: Number(arr[5]),
      }))
      .filter((o) => Number.isFinite(o.close))
      .reverse();
    if (out.length) return out;
  } catch {
    // nothing
  }

  throw new Error(`No candles for ${symbol}/${tf}`);
}

/** ===== Recent Trades ===== */
export async function fetchRecentTrades(
  symbol: string,
  startMs: number,
  endMs: number,
  limit = 5000
): Promise<Trade[]> {
  const toSide = (v: any): "buy" | "sell" =>
    String(v ?? "").toLowerCase() === "buy" ? "buy" : "sell";

  // 1) v2 fills-history
  try {
    const urlHist = new URL("/api/v2/mix/market/fills-history", base);
    urlHist.searchParams.set("symbol", toV2Symbol(symbol));
    urlHist.searchParams.set("productType", "usdt-futures");
    urlHist.searchParams.set("startTime", String(Math.floor(startMs)));
    urlHist.searchParams.set("endTime", String(Math.floor(endMs)));
    urlHist.searchParams.set("limit", String(Math.min(1000, limit)));
    const jh: any = await fetchJson(urlHist);
    const rowsH: any[] = Array.isArray(jh?.data) ? jh.data : [];
    const outH = rowsH
      .map((t: any) => ({
        time: Number(t.ts ?? t.time ?? t[3]),
        price: Number(t.price ?? t[0]),
        size: Math.abs(Number(t.size ?? t.qty ?? t[1])),
        side: toSide(t.side ?? t[2]),
      }))
      .filter((x) => Number.isFinite(x.price) && Number.isFinite(x.size));
    if (outH.length) return outH;
  } catch {
    // 폴백
  }

  // 2) v2 recent
  try {
    const urlRecent = new URL("/api/v2/mix/market/fills", base);
    urlRecent.searchParams.set("symbol", toV2Symbol(symbol));
    urlRecent.searchParams.set("productType", "usdt-futures");
    const jr: any = await fetchJson(urlRecent);
    const rowsR: any[] = Array.isArray(jr?.data) ? jr.data : [];
    const outR = rowsR
      .map((t: any) => ({
        time: Number(t.ts ?? t.time ?? t[3]),
        price: Number(t.price ?? t[0]),
        size: Math.abs(Number(t.size ?? t[1] ?? t.qty)),
        side: toSide(t.side ?? t[2]),
      }))
      .filter((x) => Number.isFinite(x.price) && Number.isFinite(x.size));
    if (outR.length) return outR;
  } catch {
    // 폴백
  }

  // 3) v1 mix
  try {
    const url = new URL("/api/mix/v1/market/fills", base);
    url.searchParams.set("symbol", toV1FuturesSymbol(symbol));
    url.searchParams.set("startTime", String(Math.floor(startMs)));
    url.searchParams.set("endTime", String(Math.floor(endMs)));
    url.searchParams.set("limit", String(Math.min(1000, limit)));
    const j: any = await fetchJson(url);
    const rows: any[] = Array.isArray(j?.data) ? j.data : [];
    const out = rows
      .map((t: any) => ({
        time: Number(t.ts ?? t.time ?? t[3]),
        price: Number(t.price ?? t[0]),
        size: Math.abs(Number(t.size ?? t[1] ?? t.qty)),
        side: toSide(t.side ?? t[2]),
      }))
      .filter((x) => Number.isFinite(x.price) && Number.isFinite(x.size));
    if (out.length) return out;
  } catch {
    // nothing
  }

  return [];
}

/** ===== 랭킹/심볼 ===== */

/** 간단 캐시 (API 과호출 방지) */
const TICKER_CACHE_TTL =
  (CONFIG as any)?.CACHE_TTL_MS ? Number((CONFIG as any).CACHE_TTL_MS) : 60_000;
let _tickersCache: { at: number; data: Ticker[] } | null = null;

/** v2 USDT-Futures 티커 전체 */
export async function fetchFuturesTickers(): Promise<Ticker[]> {
  const now = Date.now();
  if (_tickersCache && now - _tickersCache.at < TICKER_CACHE_TTL) {
    return _tickersCache.data;
  }

  const url = new URL("/api/v2/mix/market/tickers", base);
  url.searchParams.set("productType", "usdt-futures");

  const j: any = await fetchJson(url);
  const rows: any[] = Array.isArray(j?.data) ? j.data : [];

  const list: Ticker[] = rows
    .map((r: any) => {
      const sym = String(r.symbol ?? r.instId ?? '').replace('_UMCBL',''); // BTCUSDT
      const last = num(r.last ?? r.close ?? r.lastPrice ?? r.price);
      // 등락률: % 또는 소수로 오는 경우 혼재 → %로 들어오면 /100
      const rawChg = r.change ?? r.changeRatio ?? r.changePct ?? r.changeUtc24h ?? r.pchg;
      const chg = typeof rawChg === 'string' && rawChg.endsWith('%')
        ? num(rawChg.replace('%','')) / 100
        : num(rawChg) / (Math.abs(num(rawChg)) > 1.5 ? 100 : 1);
      const turnover = num(r.usdVolume ?? r.turnover24h ?? r.turnover ?? r.quoteVolume);
      const vol = num(r.baseVolume ?? r.volume24h ?? r.volume);

      return {
        symbol: sym,
        last,
        change24h: chg,
        turnover24h: turnover,
        volume24h: vol,
      } as Ticker;
    })
    .filter(t => t.symbol.endsWith('USDT') && Number.isFinite(t.last));

  _tickersCache = { at: now, data: list };
  return list;
}

/** 거래 가능한 선물 심볼 목록 (BTCUSDT 형식) */
export async function fetchSymbols(): Promise<string[]> {
  const list = await fetchFuturesTickers();
  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const t of list.sort((a,b) => b.turnover24h - a.turnover24h)) {
    if (!seen.has(t.symbol)) {
      seen.add(t.symbol);
      symbols.push(t.symbol);
    }
  }
  return symbols;
}

/** 상위 25: 24h 거래대금(USDT) 내림차순 */
export async function top25ByTurnover(): Promise<Ticker[]> {
  const list = await fetchFuturesTickers();
  return list.slice().sort((a,b)=> b.turnover24h - a.turnover24h).slice(0,25);
}

/** 단타 추천 10: |등락률| × sqrt(거래대금) 점수 */
export async function scalpTop10(): Promise<Ticker[]> {
  const list = await fetchFuturesTickers();
  return list
    .map(t => ({ ...t, _score: Math.abs(t.change24h) * Math.sqrt(Math.max(1, t.turnover24h)) }))
    .sort((a:any,b:any) => b._score - a._score)
    .slice(0,10)
    .map(({ _score, ...rest }: any) => rest as Ticker);
}

/** ===== 단일 심볼 실시간 Ticker =====
 * GET /api/v2/mix/market/ticker?symbol=BTCUSDT&productType=usdt-futures
 */
export async function fetchTicker(symbol: string): Promise<{
  price: number;
  change24h: number;   // 소수 (0.031 = +3.1%)
  high24h?: number;
  low24h?: number;
  vol24h?: number;
} | null> {
  try {
    const url = new URL('/api/v2/mix/market/ticker', base);
    url.searchParams.set('symbol', toV2Symbol(symbol));
    url.searchParams.set('productType', 'usdt-futures');

    const j: any = await fetchJson(url);
    const d = j?.data;
    if (!d) return null;

    const raw = d.changeUtc24h ?? d.change ?? d.changeRatio ?? d.pchg;
    const chg = typeof raw === 'string' && raw.endsWith('%')
      ? Number(raw.replace('%','')) / 100
      : Number(raw);

    return {
      price: Number(d.last ?? d.close ?? d.lastPrice ?? d.price),
      change24h: Number.isFinite(chg)
        ? (Math.abs(chg) > 1.5 ? chg / 100 : chg) // %로 오면 /100
        : 0,
      high24h: Number(d.high24h ?? d.high),
      low24h: Number(d.low24h ?? d.low),
      vol24h: Number(d.baseVolume24h ?? d.baseVol24h ?? d.volume),
    };
  } catch (e) {
    console.error('fetchTicker error', e);
    return null;
  }
}
