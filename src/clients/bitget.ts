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

const base = CONFIG.BITGET_BASE;

/** 공통 JSON fetch */
async function fetchJson(url: URL) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status} ${res.statusText} • ${url.pathname} • ${body.slice(
        0,
        120
      )}`
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
  const span =
    Math.max(50, Math.min(1000, limit)) * tfSecs * 1000;
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
