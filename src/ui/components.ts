// src/ui/components.ts
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { CONFIG } from '../config.js';
import {
  top25ByTurnover,
  scalpTop10,
  fetchTicker,      // ✅ 실시간 가격
  type Ticker,
} from '../clients/bitget.js';

/* ====================== 기본 분석 UI ====================== */

export const BTN = {
  ANALYZE: 'analyze',
  LONG: 'long',
  SHORT: 'short',
  REFRESH: 'refresh',
} as const;

export const SEL = {
  SYMBOL: 'sel_symbol',
  TF: 'sel_tf',
  TOP25: 'coin_select_top25',
  SCALP10: 'coin_select_scalp10',
} as const;

/* ---------------- 공통 버튼 ---------------- */
export function rowsButtons() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BTN.ANALYZE).setLabel('Analyze').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(BTN.LONG).setLabel('Long').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(BTN.SHORT).setLabel('Short').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(BTN.REFRESH).setLabel('Refresh').setStyle(ButtonStyle.Secondary),
  );
}

/* ---------------- 고정 셀렉트(설정 기반) ---------------- */
export function rowsSelects(symbol: string, tf: string) {
  const sym = new StringSelectMenuBuilder()
    .setCustomId(SEL.SYMBOL)
    .setPlaceholder(`심볼(${symbol})`)
    .addOptions(
      CONFIG.SYMBOL_CHOICES.map((s: string) =>
        new StringSelectMenuOptionBuilder().setLabel(s).setValue(s).setDefault(s === symbol),
      ),
    );

  const tfs = new StringSelectMenuBuilder()
    .setCustomId(SEL.TF)
    .setPlaceholder(`타임프레임(${tf})`)
    .addOptions(
      CONFIG.TF_CHOICES.map((t: string) =>
        new StringSelectMenuOptionBuilder().setLabel(t).setValue(t).setDefault(t === tf),
      ),
    );

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sym),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(tfs),
  ];
}

/* ---------------- 랭킹 드롭다운(상위25 · 단타10) ---------------- */

function fmt(n: number, d = 4) {
  return Number.isFinite(n) ? n.toFixed(d) : '-';
}
function pct(p: number) {
  if (!Number.isFinite(p)) return '0.00%';
  return (p * 100).toFixed(2) + '%';
}
function labelOf(sym: string) {
  return sym.replace('USDT', '');
}

/** 간단 동시성 제한으로 API 과호출 방지 */
async function mapWithConcurrency<T, R>(list: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length) as any;
  let idx = 0;
  const workers = new Array(Math.min(limit, list.length)).fill(0).map(async () => {
    while (true) {
      const i = idx++;
      if (i >= list.length) break;
      out[i] = await fn(list[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 실시간 티커로 가격/등락률 보정 */
async function enrichTickers(list: Ticker[], take: number) {
  const base = list.slice(0, take);
  const live = await mapWithConcurrency(
    base.map(t => t.symbol),
    8, // 동시 8개
    async (s) => (await fetchTicker(s)) || null,
  );
  return base.map((t, i) => {
    const rt = live[i];
    return rt ? { ...t, last: rt.price, change24h: rt.change24h } : t;
  });
}

function buildOptions(list: Ticker[]) {
  return list.map((t) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(labelOf(t.symbol))
      .setDescription(`$${fmt(t.last)} · 24h ${pct(t.change24h)}`)
      .setValue(t.symbol),
  );
}

export async function coinSelectMenusDual() {
  try {
    // 1) 랭킹 가져오기
    const [topRaw, scalpRaw] = await Promise.all([top25ByTurnover(), scalpTop10()]);
    // 2) 실시간 가격으로 보정 (0.0000 이슈 해결)
    const [top, scalp] = await Promise.all([
      enrichTickers(topRaw, 25),
      enrichTickers(scalpRaw, 10),
    ]);

    const menuTop = new StringSelectMenuBuilder()
      .setCustomId(SEL.TOP25)
      .setPlaceholder('🏆 상위 25위 (24h 거래대금 기준)')
      .addOptions(buildOptions(top));

    const menuScalp = new StringSelectMenuBuilder()
      .setCustomId(SEL.SCALP10)
      .setPlaceholder('⚡ 단타 추천 10 (변동성 우선)')
      .addOptions(buildOptions(scalp));

    return [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menuTop),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menuScalp),
    ];
  } catch {
    // Bitget 실패 시 폴백: CONFIG 리스트
    const list = (CONFIG.SYMBOL_CHOICES ?? []).slice(0, 25);
    const opts = list.map((s: string) =>
      new StringSelectMenuOptionBuilder().setLabel(labelOf(s)).setDescription(`${s}`).setValue(s),
    );

    const fallback = new StringSelectMenuBuilder()
      .setCustomId(SEL.TOP25)
      .setPlaceholder('심볼 선택 (폴백)')
      .addOptions(opts);

    return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(fallback)];
  }
}

/* ====================== 가상 선물(Paper) UI ====================== */

// --- 추가 상수 ---
export const PAPER_BTN = {
  TOGGLE: 'paper_toggle',  // 활성/비활성
  LONG: 'paper_long',
  SHORT: 'paper_short',
  CLOSE: 'paper_close',
  FLIP: 'paper_flip',
  RESET: 'paper_reset',
  PORT: 'paper_portfolio', // 요약 보기
  CURR: 'paper_currency',  // USD↔KRW 토글
  REFRESH: 'paper_refresh' // 현재가/PNL 새로고침
} as const;

export const PAPER_SEL = {
  AMOUNT: 'paper_amount',  // 주문 금액(USD)
  LEV: 'paper_lev'         // 레버리지
} as const;

// --- 가상선물 버튼행 ---
export function rowPaperButtons(enabled = true) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PAPER_BTN.TOGGLE).setLabel(enabled ? 'Paper: ON' : 'Paper: OFF')
      .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PAPER_BTN.LONG).setLabel('Long').setStyle(ButtonStyle.Primary).setDisabled(!enabled),
    new ButtonBuilder().setCustomId(PAPER_BTN.SHORT).setLabel('Short').setStyle(ButtonStyle.Danger).setDisabled(!enabled),
    new ButtonBuilder().setCustomId(PAPER_BTN.CLOSE).setLabel('Close').setStyle(ButtonStyle.Secondary).setDisabled(!enabled),
    new ButtonBuilder().setCustomId(PAPER_BTN.FLIP).setLabel('Flip').setStyle(ButtonStyle.Secondary).setDisabled(!enabled),
  );
}

export function rowPaperMgmt(enabled = true) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PAPER_BTN.PORT).setLabel('Portfolio').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PAPER_BTN.CURR).setLabel('USD ↔ KRW').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PAPER_BTN.RESET).setLabel('Reset').setStyle(ButtonStyle.Secondary).setDisabled(!enabled),
    new ButtonBuilder().setCustomId(PAPER_BTN.REFRESH).setLabel('Refresh PnL').setStyle(ButtonStyle.Secondary),
  );
}

export function rowPaperSelects(currentAmt = 100, currentLev = 5) {
  const amount = new StringSelectMenuBuilder()
    .setCustomId(PAPER_SEL.AMOUNT)
    .setPlaceholder(`금액(USD) · 현재 ${currentAmt}`)
    .addOptions([25,50,100,250,500,1000,2000].map(v =>
      new StringSelectMenuOptionBuilder().setLabel(`$${v}`).setValue(String(v)).setDefault(v===currentAmt)
    ));

  const lev = new StringSelectMenuBuilder()
    .setCustomId(PAPER_SEL.LEV)
    .setPlaceholder(`레버리지 · 현재 ${currentLev}x`)
    .addOptions([1,2,3,5,10,15,20,30,50].map(v =>
      new StringSelectMenuOptionBuilder().setLabel(`${v}x`).setValue(String(v)).setDefault(v===currentLev)
    ));

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(amount),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(lev),
  ];
}
