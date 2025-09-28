import fetch from 'node-fetch';
import { CONFIG } from '../config.js';

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
  side: 'buy' | 'sell';
};

const base = CONFIG.BITGET_BASE;

/** 공통 JSON fetch (상세 오류 포함) */
async function fetchJson(url: URL) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `HTTP ${res.status} ${res.statusText} • ${url.pathname} • ${body.slice(0,120)}`
    );
  }
  try {
    return await res.json();
  } catch {
    throw new Error(`JSON parse failed • ${url.pathname}`);
  }
}

/** ===== Candles (선물 전용: Mix v1) ===== */
export async function fetchCandles(
  symbol: string,
  tf: string,
  limit = 300
): Promise<Candle[]> {
  const tfToSecs: Record<string, number> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1h': 3600,
    '4h': 14400,
  };
  const tfSecs = tfToSecs[tf] ?? 900;

  // 무조건 선물 심볼(_UMCBL 붙이기)
  const futuresSym = symbol.endsWith('_UMCBL') ? symbol : `${symbol}_UMCBL`;

  const url = new URL('/api/mix/v1/market/candles', base);
  url.searchParams.set('symbol', futuresSym);
  url.searchParams.set('granularity', String(tfSecs)); // 초 단위
  url.searchParams.set('limit', String(Math.min(limit, 1000)));

  const j: any = await fetchJson(url);
  const rows: any[] = Array.isArray(j?.data) ? j.data : [];

  return rows
    .map((arr: any[]) => ({
      time: Number(arr[0]),
      open: Number(arr[1]),
      high: Number(arr[2]),
      low: Number(arr[3]),
      close: Number(arr[4]),
      volume: Number(arr[5]),
    }))
    .filter((c) => Number.isFinite(c.close))
    .reverse();
}

/** ===== Recent Trades (선물 전용: Mix v1) ===== */
export async function fetchRecentTrades(
  symbol: string,
  startMs: number,
  endMs: number,
  limit = 5000
): Promise<Trade[]> {
  const futuresSym = symbol.endsWith('_UMCBL') ? symbol : `${symbol}_UMCBL`;

  const url = new URL('/api/mix/v1/market/fills', base);
  url.searchParams.set('symbol', futuresSym);
  url.searchParams.set('startTime', String(startMs));
  url.searchParams.set('endTime', String(endMs));
  url.searchParams.set('limit', String(limit));

  try {
    const j: any = await fetchJson(url);
    const rows: any[] = Array.isArray(j?.data) ? j.data : [];

    const toSide = (v: any): 'buy' | 'sell' =>
      String(v ?? '').toLowerCase() === 'buy' ? 'buy' : 'sell';

    return rows
      .map((t: any) => ({
        time: Number(t.ts ?? t.time ?? t[3]),
        price: Number(t.price ?? t[0]),
        size: Math.abs(Number(t.size ?? t.qty ?? t[1])),
        side: toSide(t.side ?? t[2]) as 'buy' | 'sell',
      }))
      .filter((x) => Number.isFinite(x.price) && Number.isFinite(x.size));
  } catch (e) {
    // 실패하면 빈 배열 반환 (앱은 계속 동작)
    return [];
  }
}
