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

/** TF 매핑 */
const TF_TO_SECS: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
};
const TF_VALID_STR = new Set(['1m','5m','15m','1h','4h']);

/** 내부 유틸: 심볼 포맷 */
function toV2Symbol(sym: string) {
  // v2 선물은 'BTCUSDT' 포맷
  return sym.replace('_UMCBL', '');
}
function toV1FuturesSymbol(sym: string) {
  // v1 mix 선물은 'BTCUSDT_UMCBL' 포맷
  return sym.endsWith('_UMCBL') ? sym : `${sym}_UMCBL`;
}

/** ===== Candles: v2 선물 → v1 선물(시간 범위) 폴백 ===== */
export async function fetchCandles(
  symbol: string,
  tf: string,
  limit = 300
): Promise<Candle[]> {
  // 안전한 기본값
  const tfSecs = TF_TO_SECS[tf] ?? 900;
  const tfStr  = TF_VALID_STR.has(tf) ? tf : '15m';

  // 1) v2 선물 (간단, 파라미터 검증 엄격 X)
  try {
    const url = new URL('/api/v2/mix/market/candles', base);
    url.searchParams.set('symbol', toV2Symbol(symbol));   // BTCUSDT
    url.searchParams.set('productType', 'usdt-futures');
    url.searchParams.set('granularity', tfStr);           // '1m' | '5m' | ...
    url.searchParams.set('limit', String(Math.min(limit, 1000)));
    const j: any = await fetchJson(url);
    const rows: any[] = Array.isArray(j?.data) ? j.data : [];

    const out = rows.map((arr: any[]) => ({
      time:   Number(arr[0]),
      open:   Number(arr[1]),
      high:   Number(arr[2]),
      low:    Number(arr[3]),
      close:  Number(arr[4]),
      volume: Number(arr[5]),
    })).filter(o => Number.isFinite(o.close)).reverse();

    if (out.length) return out;
  } catch (_e) {
    // 폴백 진행
  }

  // 2) v1 mix 선물 (여기는 startTime/endTime 없으면 400172 나올 수 있음 → 반드시 포함!)
  //    limit 파라미터는 엔드포인트 버전에 따라 검증 실패를 일으킬 수 있으므로 **전송하지 않는다.**
  {
    const endMs   = Date.now();
    const span    = Math.max(50, Math.min(1000, limit)) * tfSecs * 1000; // 요청 범위
    const startMs = endMs - span;

    const url = new URL('/api/mix/v1/market/candles', base);
    url.searchParams.set('symbol', toV1FuturesSymbol(symbol));  // BTCUSDT_UMCBL
    url.searchParams.set('granularity', String(tfSecs));        // 초 단위
    url.searchParams.set('startTime', String(Math.floor(startMs)));
    url.searchParams.set('endTime',   String(Math.floor(endMs)));
    // url.searchParams.set('limit', ...)  // ❌ 넣지 않음 (400172 방지)

    const j: any = await fetchJson(url);
    const rows: any[] = Array.isArray(j?.data) ? j.data : [];

    const out = rows.map((arr: any[]) => ({
      time:   Number(arr[0]),
      open:   Number(arr[1]),
      high:   Number(arr[2]),
      low:    Number(arr[3]),
      close:  Number(arr[4]),
      volume: Number(arr[5]),
    })).filter(o => Number.isFinite(o.close)).reverse();

    if (out.length) return out;
  }

  throw new Error(`No candles for ${symbol}/${tf} (v2+v1 both empty)`);
}

/** ===== Recent Trades: v2 선물(기간) → v2 최근 → v1 선물(기간) 폴백 ===== */
export async function fetchRecentTrades(
  symbol: string,
  startMs: number,
  endMs: number,
  limit = 5000
): Promise[Trade[]> {
  const toSide = (v: any): 'buy'|'sell' =>
    String(v ?? '').toLowerCase() === 'buy' ? 'buy' : 'sell';

  // 1) v2 선물: 기간 지정 (fills-history)
  try {
    const urlHist = new URL('/api/v2/mix/market/fills-history', base);
    urlHist.searchParams.set('symbol', toV2Symbol(symbol));
    urlHist.searchParams.set('productType', 'usdt-futures');
    urlHist.searchParams.set('startTime', String(Math.floor(startMs)));
    urlHist.searchParams.set('endTime',   String(Math.floor(endMs)));
    urlHist.searchParams.set('limit',     String(Math.min(1000, limit)));
    const jh: any = await fetchJson(urlHist);
    const rowsH: any[] = Array.isArray(jh?.data) ? jh.data : [];
    const outH = rowsH.map((t:any) => ({
      time:  Number(t.ts ?? t.time ?? t[3]),
      price: Number(t.price ?? t[0]),
      size:  Math.abs(Number(t.size ?? t.qty ?? t[1])),
      side:  toSide(t.side ?? t[2]),
    })).filter(x => Number.isFinite(x.price) && Number.isFinite(x.size));
    if (outH.length) return outH;
  } catch (_e) {
    // 폴백
  }

  // 2) v2 선물: 최근 (시간 파라미터 없이)
  try {
    const urlRecent = new URL('/api/v2/mix/market/fills', base);
    urlRecent.searchParams.set('symbol', toV2Symbol(symbol));
    urlRecent.searchParams.set('productType', 'usdt-futures');
    const jr: any = await fetchJson(urlRecent);
    const rowsR: any[] = Array.isArray(jr?.data) ? jr.data : [];
    const outR = rowsR.map((t:any) => ({
      time:  Number(t.ts ?? t.time ?? t[3]),
      price: Number(t.price ?? t[0]),
      size:  Math.abs(Number(t.size ?? t[1] ?? t.qty)),
      side:  toSide(t.side ?? t[2]),
    })).filter(x => Number.isFinite(x.price) && Number.isFinite(x.size));
    if (outR.length) return outR;
  } catch (_e) {
    // 폴백
  }

  // 3) v1 mix 선물: 기간 지정
  try {
    const url = new URL('/api/mix/v1/market/fills', base);
    url.searchParams.set('symbol', toV1FuturesSymbol(symbol));
    url.searchParams.set('startTime', String(Math.floor(startMs)));
    url.searchParams.set('endTime',   String(Math.floor(endMs)));
    url.searchParams.set('limit',     String(Math.min(1000, limit)));
    const j: any = await fetchJson(url);
    const rows: any[] = Array.isArray(j?.data) ? j.data : [];
    const out = rows.map((t:any) => ({
      time:  Number(t.ts ?? t.time ?? t[3]),
      price: Number(t.price ?? t[0]),
      size:  Math.abs(Number(t.size ?? t[1] ?? t.qty)),
      side:  toSide(t.side ?? t[2]),
    })).filter(x => Number.isFinite(x.price) && Number.isFinite(x.size));
    if (out.length) return out;
  } catch (_e) {
    // 마지막 폴백 실패 → 빈 배열
  }

  return [];
}
