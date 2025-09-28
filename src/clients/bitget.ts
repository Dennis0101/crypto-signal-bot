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
    throw new Error(`HTTP ${res.status} ${res.statusText} • ${url.pathname} • ${body.slice(0, 120)}`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error(`JSON parse failed • ${url.pathname}`);
  }
}

/** ===== Candles (적응형 폴백) ===== */
export async function fetchCandles(symbol: string, tf: string, limit = 300): Promise<Candle[]> {
  // 문자↔초 매핑
  const tfToSecs: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 };
  const tfSecs = tfToSecs[tf] ?? 900;

  // 선물(Mix v2) 심볼 후보 (_UMCBL = USDT Perp)
  const futuresSym = symbol.endsWith('_UMCBL') ? symbol : `${symbol}_UMCBL`;

  const productType = process.env.BITGET_PRODUCT_TYPE || CONFIG.CATEGORY || 'USDT-FUTURES';

  const candidates: Array<{ path: string; q: Record<string, string>; parse: (j: any) => any[] }> = [
    // v3 UTA – productType 사용, granularity는 '1m' 등 문자열
    {
      path: '/api/v3/market/candles',
      q: {
        productType,                 // 'USDT-FUTURES'
        symbol,                      // 'BTCUSDT'
        granularity: tf,             // '1m' | '5m' ...
        type: 'MARKET',
        limit: String(Math.min(limit, 1000))
      },
      parse: (j) => (Array.isArray(j?.data) ? j.data : [])
    },
    // v3 UTA – 일부 환경은 category 키만 허용
    {
      path: '/api/v3/market/candles',
      q: {
        category: productType,
        symbol,
        granularity: tf,
        type: 'MARKET',
        limit: String(Math.min(limit, 1000))
      },
      parse: (j) => (Array.isArray(j?.data) ? j.data : [])
    },
    // v2 Mix 선물 – 심볼에 _UMCBL 필요, granularity는 초 단위
    {
      path: '/api/mix/v1/market/candles',
      q: {
        symbol: futuresSym,          // 'BTCUSDT_UMCBL'
        granularity: String(tfSecs), // 60/300/...
        limit: String(Math.min(limit, 1000))
      },
      parse: (j) => (Array.isArray(j?.data) ? j.data : [])
    },
    // v2 Spot – 최후 폴백
    {
      path: '/api/spot/v1/market/candles',
      q: {
        symbol,
        granularity: String(tfSecs),
        limit: String(Math.min(limit, 1000))
      },
      parse: (j) => (Array.isArray(j?.data) ? j.data : [])
    }
  ];

  let lastErr: unknown = null;

  for (const c of candidates) {
    try {
      const url = new URL(c.path, base);
      Object.entries(c.q).forEach(([k, v]) => url.searchParams.set(k, v));
      const j: any = await fetchJson(url);
      const rows = c.parse(j);

      const out = rows
        .map((arr: any[]) => ({
          time: Number(arr[0]),
          open: Number(arr[1]),
          high: Number(arr[2]),
          low: Number(arr[3]),
          close: Number(arr[4]),
          volume: Number(arr[5])
        }))
        .filter((o) => Number.isFinite(o.close))
        .reverse();

      if (out.length > 0) return out;
      lastErr = new Error(`Empty candles @ ${c.path}`);
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(`Candles fetch failed for ${symbol}/${tf}: ${String((lastErr as Error)?.message || lastErr)}`);
}

/** ===== Recent Trades (적응형 폴백) ===== */
export async function fetchRecentTrades(
  symbol: string,
  startMs: number,
  endMs: number,
  limit = 5000
): Promise<Trade[]> {
  const futuresSym = symbol.endsWith('_UMCBL') ? symbol : `${symbol}_UMCBL`;

  const candidates: Array<{ path: string; q: Record<string, string> }> = [
    // v3 공통 fills
    {
      path: '/api/v3/market/fills',
      q: { symbol, startTime: String(startMs), endTime: String(endMs), limit: String(limit) }
    },
    // v2 Mix 선물 fills
    {
      path: '/api/mix/v1/market/fills',
      q: { symbol: futuresSym, startTime: String(startMs), endTime: String(endMs), limit: String(limit) }
    },
    // v2 Spot fills (최후)
    {
      path: '/api/spot/v1/market/fills',
      q: { symbol, startTime: String(startMs), endTime: String(endMs), limit: String(limit) }
    }
  ];

  const toSide = (v: any): 'buy' | 'sell' => (String(v ?? '').toLowerCase() === 'buy' ? 'buy' : 'sell');

  for (const c of candidates) {
    try {
      const url = new URL(c.path, base);
      Object.entries(c.q).forEach(([k, v]) => url.searchParams.set(k, v));
      const j: any = await fetchJson(url);

      const rows: any[] = Array.isArray(j?.data) ? j.data : [];
      const out = rows
        .map((t: any) => ({
          time: Number(t.ts ?? t.time ?? t[3]),
          price: Number(t.price ?? t[0]),
          size: Math.abs(Number(t.size ?? t.qty ?? t[1])),
          side: toSide(t.side ?? t[2]) as 'buy' | 'sell'
        }))
        .filter((x) => Number.isFinite(x.price) && Number.isFinite(x.size));

      if (out.length > 0) return out;
    } catch {
      // 다음 후보로 폴백
    }
  }

  // 체결은 빈 배열이어도 앱은 계속 동작(“데이터 부족” 표시)
  return [];
}
