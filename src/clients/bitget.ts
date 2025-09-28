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

/** 내부 유틸: JSON 가져오기(상태/파싱 오류를 사람이 읽을 수 있게) */
async function fetchJson(url: URL) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} • ${url.pathname} • ${body.slice(0,120)}`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error(`JSON parse failed • ${url.pathname}`);
  }
}

/** ===== Candles ===== */
export async function fetchCandles(symbol: string, tf: string, limit = 300): Promise<Candle[]> {
  // 시도 순서: v3 → v2
  const candidates: Array<{ path: string; q: Record<string,string> }> = [
    { path: '/api/v3/market/candles', q: {
        category: CONFIG.CATEGORY, // 'USDT-FUTURES'
        symbol,                    // 'BTCUSDT'
        granularity: tf,           // '1m' | '5m' | '15m' | '1h' | '4h'
        type: 'MARKET',
        limit: String(Math.min(limit, 1000))
      }
    },
    { path: '/api/v2/market/candles', q: {
        category: CONFIG.CATEGORY,
        symbol,
        granularity: tf,
        type: 'MARKET',
        limit: String(Math.min(limit, 1000))
      }
    }
  ];

  let lastErr: unknown = null;

  for (const c of candidates) {
    try {
      const url = new URL(c.path, base);
      Object.entries(c.q).forEach(([k,v]) => url.searchParams.set(k, v));
      const j: any = await fetchJson(url);

      // v2/v3 모두 보통 j.data가 2차원 배열
      const rows: any[] =
        Array.isArray(j?.data) ? j.data :
        Array.isArray(j?.candles) ? j.candles : [];

      const out = rows.map((arr: any[]) => ({
        time:   Number(arr[0]),
        open:   Number(arr[1]),
        high:   Number(arr[2]),
        low:    Number(arr[3]),
        close:  Number(arr[4]),
        volume: Number(arr[5]),
      }))
      .filter(c => Number.isFinite(c.close))
      .reverse();

      if (out.length > 0) return out;
      // 빈 응답이면 다음 후보 시도
      lastErr = new Error(`Empty candles (${c.path})`);
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(`Failed to fetch candles for ${symbol}/${tf}: ${String((lastErr as Error)?.message || lastErr)}`);
}

/** ===== Recent Trades ===== */
export async function fetchRecentTrades(
  symbol: string,
  startMs: number,
  endMs: number,
  limit = 5000
): Promise<Trade[]> {

  const candidates: Array<{ path: string; q: Record<string,string> }> = [
    { path: '/api/v3/market/fills', q: {
        symbol,
        startTime: String(startMs),
        endTime:   String(endMs),
        limit:     String(limit)
      }
    },
    { path: '/api/v2/market/fills', q: {
        symbol,
        startTime: String(startMs),
        endTime:   String(endMs),
        limit:     String(limit)
      }
    }
  ];

  const toSide = (v: any): 'buy' | 'sell' => (String(v ?? '').toLowerCase() === 'buy' ? 'buy' : 'sell');

  let lastErr: unknown = null;

  for (const c of candidates) {
    try {
      const url = new URL(c.path, base);
      Object.entries(c.q).forEach(([k,v]) => url.searchParams.set(k, v));
      const j: any = await fetchJson(url);

      const rows: any[] = Array.isArray(j?.data) ? j.data : [];
      const out = rows.map((t: any) => ({
        time:  Number(t.ts    ?? t.time ?? t[3]),
        price: Number(t.price ?? t[0]),
        size:  Math.abs(Number(t.size  ?? t.qty  ?? t[1])),
        side:  toSide(t.side  ?? t[2]) as 'buy' | 'sell',
      }))
      .filter(x => Number.isFinite(x.price) && Number.isFinite(x.size));

      if (out.length > 0) return out;
      lastErr = new Error(`Empty trades (${c.path})`);
    } catch (e) {
      lastErr = e;
    }
  }

  // trades는 빈 배열 반환해도 애플리케이션이 계속 동작하도록 함
  // (CVD/프로파일은 "데이터 부족"으로만 표시)
  return [];
}
