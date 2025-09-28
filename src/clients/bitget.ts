import fetch from 'node-fetch';
import { CONFIG } from '../config.js';

export type Candle = { time: number; close: number; open?: number; high?: number; low?: number; volume?: number };
export type Trade = { time: number; price: number; size: number; side: 'buy'|'sell' };

const base = CONFIG.BITGET_BASE;

export async function fetchCandles(symbol: string, tf: string, limit = 300): Promise<Candle[]> {
  const url = new URL('/api/v3/market/candles', base);
  url.searchParams.set('category', CONFIG.CATEGORY);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('granularity', tf);  // 1m/5m/15m/1h/4h
  url.searchParams.set('type', 'MARKET');
  url.searchParams.set('limit', String(Math.min(limit, 1000)));

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Bitget candles ${r.status}`);
  const j: any = await r.json();
  const rows: any[] = Array.isArray(j?.data) ? j.data : [];
  const candles = rows.map((arr: any[]) => ({
    time: Number(arr[0]),
    open: Number(arr[1]),
    high: Number(arr[2]),
    low: Number(arr[3]),
    close: Number(arr[4]),
    volume: Number(arr[5])
  })).filter(x => Number.isFinite(x.close)).reverse();
  return candles;
}

export async function fetchRecentTrades(symbol: string, startMs: number, endMs: number, limit = 5000): Promise<Trade[]> {
  const url = new URL('/api/v3/market/fills', base); // 필요 시 버전/경로 조정
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('startTime', String(startMs));
  url.searchParams.set('endTime', String(endMs));
  url.searchParams.set('limit', String(limit));

  const r = await fetch(url);
  if (!r.ok) return [];
  const j: any = await r.json();
  const rows: any[] = Array.isArray(j?.data) ? j.data : [];
  return rows.map((t: any) => ({
    time: Number(t.ts ?? t.time ?? t[3]),
    price: Number(t.price ?? t[0]),
    size: Math.abs(Number(t.size ?? t.qty ?? t[1])),
    side: String(t.side ?? t[2] ?? '').toLowerCase() === 'buy' ? 'buy' : 'sell'
  })).filter(x => Number.isFinite(x.price) && Number.isFinite(x.size));
}
