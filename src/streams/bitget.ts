import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { CONFIG } from '../config.js';
import { buildCVDandProfile } from '../indicators/cvd.js';
import type { Trade } from '../clients/bitget.js';
import { fetchCandles } from '../clients/bitget.js';
import { calcBaseFeatures } from '../indicators/calc.js';
import { decide } from '../strategy/signal.js';
import { buildEmbed } from '../ui/embed.js';
import { rowsButtons, rowsSelects } from '../ui/components.js';

type SubKey = `${string}:${string}`; // "BTCUSDT:1m"
type Target = { channelId: string; messageId: string; symbol: string; tf: string };

const WS_URL = process.env.BITGET_WS || 'wss://ws.bitget.com/v2/stream';
const IDLE_MS = Number(process.env.WS_IDLE_MS || 10 * 60 * 1000);
const DEBOUNCE_MS = Number(process.env.WS_DEBOUNCE_MS || 7000);

function keyOf(symbol: string, tf: string): SubKey {
  return `${symbol}:${tf}` as const;
}

/** 심볼별 최신 상태 */
const state: Record<SubKey, {
  lastUse: number;
  trades: Trade[];
  curCandle?: { ts: number; open: number; high: number; low: number; close: number };
  targets: Target[];
  timer?: NodeJS.Timeout;
  lastPushTs: number;
}> = {} as any;

let ws: WebSocket | null = null;
let connected = false;
let reconnecting = false;
let wantSubs = new Set<SubKey>();

/** 외부에서 구독 시작 */
export function subscribeStream(target: Target) {
  const k = keyOf(target.symbol, target.tf);
  wantSubs.add(k);
  if (!state[k]) state[k] = { lastUse: Date.now(), trades: [], targets: [], lastPushTs: 0 };
  state[k].lastUse = Date.now();
  // 동일 메시지 중복 추가 방지
  if (!state[k].targets.some(t => t.channelId === target.channelId && t.messageId === target.messageId)) {
    state[k].targets.push(target);
  }
  ensureWS();
}

/** 외부에서 구독 해제(선택) */
export function unsubscribeStream(symbol: string, tf: string, predicate?: (t: Target)=>boolean) {
  const k = keyOf(symbol, tf);
  if (!state[k]) return;
  if (predicate) {
    state[k].targets = state[k].targets.filter(t => !predicate(t));
  } else {
    state[k].targets = [];
  }
  if (state[k].targets.length === 0) {
    wantSubs.delete(k);
  }
}

/** WS 연결을 유지 */
function ensureWS() {
  if (ws && connected) return;
  connectWS();
}

function connectWS() {
  ws?.removeAllListeners();
  ws?.close();

  ws = new WebSocket(WS_URL);
  reconnecting = false;

  ws.on('open', () => {
    connected = true;
    // 현재 원하는 모든 구독 재요청
    resubscribeAll();
  });

  ws.on('message', handleMessage);

  ws.on('close', () => {
    connected = false;
    scheduleReconnect();
  });

  ws.on('error', () => {
    connected = false;
    scheduleReconnect();
  });

  // 유휴 스트림 정리 타이머
  setInterval(cleanIdle, 60_000);
}

function scheduleReconnect() {
  if (reconnecting) return;
  reconnecting = true;
  setTimeout(() => connectWS(), 2000);
}

function resubscribeAll() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (wantSubs.size === 0) return;
  // Bitget 구독 포맷에 맞춰 변경하세요.
  // 예시: topic 예명 'candle' / 'trade' 가정
  const args = Array.from(wantSubs).flatMap((k) => {
    const [symbol, tf] = k.split(':');
    return [
      { channel: 'candle', instId: symbol, granularity: tf },
      { channel: 'trade', instId: symbol }
    ];
  });

  ws.send(JSON.stringify({ op: 'subscribe', args }));
}

function handleMessage(buf: WebSocket.RawData) {
  try {
    const msg = JSON.parse(buf.toString());

    // 핑/퐁 예시
    if (msg.event === 'ping' || msg.op === 'ping') {
      ws?.send(JSON.stringify({ op: 'pong' }));
      return;
    }

    // 트레이드 예시: { topic: 'trade', data: [...] }
    if (msg.topic?.includes('trade') || msg.arg?.channel === 'trade') {
      const symbol: string = msg.arg?.instId || parseSymbolFromTopic(msg.topic);
      const trades = (msg.data || []).map(parseTrade).filter(Boolean) as Trade[];
      onTrades(symbol, trades);
    }

    // 캔들 예시: { topic: 'candle', arg:{instId,granularity}, data:[ [ts,open,high,low,close,...] ] }
    if (msg.topic?.includes('candle') || msg.arg?.channel === 'candle') {
      const symbol: string = msg.arg?.instId || parseSymbolFromTopic(msg.topic);
      const tf: string = msg.arg?.granularity || parseTFfromTopic(msg.topic);
      const c = parseCandle(msg.data?.[0]);
      if (c) onCandle(symbol, tf, c);
    }
  } catch { /* ignore */ }
}

function parseSymbolFromTopic(topic?: string): string {
  // topic 포맷에 맞게 심볼 문자열 파싱
  // 예: "trade:BTCUSDT" → BTCUSDT
  return topic?.split(':')[1] || '';
}
function parseTFfromTopic(topic?: string): string {
  // 예: "candle:BTCUSDT:1m" → 1m
  return topic?.split(':')[2] || '1m';
}

function parseTrade(row: any): Trade | null {
  // 거래소 응답 필드에 맞게 매핑 필요
  // 예시: [ts, price, size, side]
  const ts = Number(row[0] ?? row.ts);
  const price = Number(row[1] ?? row.price);
  const size = Math.abs(Number(row[2] ?? row.size));
  const side = String(row[3] ?? row.side).toLowerCase() === 'buy' ? 'buy' : 'sell';
  if (!isFinite(ts) || !isFinite(price) || !isFinite(size)) return null;
  return { time: ts, price, size, side };
}

function parseCandle(row: any): { ts:number; open:number; high:number; low:number; close:number } | null {
  // 거래소 응답 필드에 맞게 매핑 필요
  // 예시: [ts, open, high, low, close]
  const ts = Number(row?.[0] ?? row?.ts);
  const open = Number(row?.[1] ?? row?.open);
  const high = Number(row?.[2] ?? row?.high);
  const low  = Number(row?.[3] ?? row?.low);
  const close= Number(row?.[4] ?? row?.close);
  if (![ts,open,high,low,close].every(isFinite)) return null;
  return { ts, open, high, low, close };
}

function onTrades(symbol: string, trades: Trade[]) {
  for (const tf of ['1m','5m','15m','1h','4h']) {
    const k = keyOf(symbol, tf);
    const s = state[k];
    if (!s) continue;
    s.lastUse = Date.now();
    s.trades.push(...trades);
    // 디바운스: 너무 자주 편집하지 않도록
    if (!s.timer) {
      s.timer = setTimeout(() => {
        s.timer = undefined;
        pushIfNeeded(symbol, tf);
      }, DEBOUNCE_MS);
    }
  }
}

function onCandle(symbol: string, tf: string, c: { ts:number; open:number; high:number; low:number; close:number }) {
  const k = keyOf(symbol, tf);
  const s = state[k];
  if (!s) return;
  s.lastUse = Date.now();
  // 새로운 캔들로 넘어갔다면 강제 재분석 트리거
  const prevTs = s.curCandle?.ts;
  s.curCandle = c;

  if (prevTs && prevTs !== c.ts) {
    // 캔들 마감 이벤트로 간주 → 즉시 분석
    pushIfNeeded(symbol, tf, true);
  } else {
    // 진행 중이면 디바운스
    if (!s.timer) {
      s.timer = setTimeout(() => {
        s.timer = undefined;
        pushIfNeeded(symbol, tf);
      }, DEBOUNCE_MS);
    }
  }
}

async function pushIfNeeded(symbol: string, tf: string, force = false) {
  const k = keyOf(symbol, tf);
  const s = state[k];
  if (!s) return;
  const now = Date.now();
  if (!force && now - s.lastPushTs < DEBOUNCE_MS) return;

  // 분석 파이프라인
  // 1) 최신 300캔들은 REST로(정확한 EMA/RSI 계산용) — WS만으로 유지하려면 내부 버퍼 로직을 확장
  const candles = await fetchCandles(symbol, tf, 300);
  const f = calcBaseFeatures(candles);

  // 2) 모인 트레이드로 CVD/프로파일
  const tfMin = tf.endsWith('m') ? Number(tf.replace('m','')) : tf.endsWith('h') ? Number(tf.replace('h',''))*60 : 15;
  const { cvdSeries, profile } = buildCVDandProfile(s.trades.slice(-15_000), tfMin*60*1000, Math.max(0.5, f.last*0.001));
  const cvdNow = cvdSeries.at(-1)?.cvd ?? 0;
  const cvdUp = cvdSeries.length>2 && cvdSeries.at(-1)!.cvd > cvdSeries.at(-2)!.cvd;
  const profileTop = profile.slice().sort((a,b)=>b.vol-a.vol).slice(0,3)
    .map(n => `${n.price.toFixed(2)}(${n.vol.toFixed(0)})`).join(', ');

  // 3) 결정
  const decision = await decide(symbol, tf, f, cvdSeries, profile);

  // 4) 대상 메시지들 업데이트(편집)
  for (const t of s.targets) {
    try {
      const guild = await globalDiscordClient.guilds.fetch(); // 전역 클라이언트 참조는 index.ts에서 셋업
      const channel = await globalDiscordClient.channels.fetch(t.channelId);
      if (!channel?.isTextBased?.()) continue;
      const msg = await channel.messages.fetch(t.messageId);
      const [rowSel1, rowSel2] = rowsSelects(symbol, tf);
      await msg.edit({
        embeds: [buildEmbed(symbol, tf, f, decision, { cvdNow, cvdUp }, profileTop)],
        components: [rowsButtons(), rowSel1, rowSel2]
      });
    } catch { /* 실패는 무시(메시지 삭제 등) */ }
  }

  s.lastPushTs = now;
}

/** 유휴 구독 자동 해제 */
function cleanIdle() {
  const now = Date.now();
  for (const k of Object.keys(state) as SubKey[]) {
    if (now - state[k].lastUse > IDLE_MS) {
      wantSubs.delete(k);
      delete state[k];
    }
  }
  // 필요시 서버 구독 재동기화
  if (connected) resubscribeAll();
}

// ---- 전역 디스코드 클라이언트 주입 ----
let globalDiscordClient: any = null;
export function setDiscordClient(c: any) { globalDiscordClient = c; }
