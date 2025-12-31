// src/ui/components.ts
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, } from 'discord.js';
import { CONFIG } from '../config.js';
import { top25ByTurnover, scalpTop10, fetchTicker, // ✅ 실시간 가격
 } from '../clients/bitget.js';
/* ====================== 기본 분석 UI ====================== */
export const BTN = {
    ANALYZE: 'analyze',
    LONG: 'long',
    SHORT: 'short',
    REFRESH: 'refresh',
};
export const SEL = {
    SYMBOL: 'sel_symbol',
    TF: 'sel_tf',
    TOP25: 'coin_select_top25',
    SCALP10: 'coin_select_scalp10',
};
/* ---------------- 공통 버튼 ---------------- */
export function rowsButtons() {
    return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(BTN.ANALYZE).setLabel('Analyze').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(BTN.LONG).setLabel('Long').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(BTN.SHORT).setLabel('Short').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(BTN.REFRESH).setLabel('Refresh').setStyle(ButtonStyle.Secondary));
}
/* ---------------- 고정 셀렉트(설정 기반) ---------------- */
export function rowsSelects(symbol, tf) {
    const sym = new StringSelectMenuBuilder()
        .setCustomId(SEL.SYMBOL)
        .setPlaceholder(`심볼(${symbol})`)
        .addOptions(CONFIG.SYMBOL_CHOICES.map((s) => new StringSelectMenuOptionBuilder()
        .setLabel(s)
        .setValue(s)
        .setDefault(s === symbol)));
    const tfs = new StringSelectMenuBuilder()
        .setCustomId(SEL.TF)
        .setPlaceholder(`타임프레임(${tf})`)
        .addOptions(CONFIG.TF_CHOICES.map((t) => new StringSelectMenuOptionBuilder()
        .setLabel(t)
        .setValue(t)
        .setDefault(t === tf)));
    return [
        new ActionRowBuilder().addComponents(sym),
        new ActionRowBuilder().addComponents(tfs),
    ];
}
/* ---------------- 랭킹 드롭다운(상위25 · 단타10) ---------------- */
function fmt(n, d = 4) {
    return Number.isFinite(n) ? n.toFixed(d) : '-';
}
function pct(p) {
    if (!Number.isFinite(p))
        return '0.00%';
    return (p * 100).toFixed(2) + '%';
}
function labelOf(sym) {
    return sym.replace('USDT', '');
}
/** 간단 동시성 제한으로 API 과호출 방지 */
async function mapWithConcurrency(list, limit, fn) {
    const out = new Array(list.length);
    let idx = 0;
    const workers = new Array(Math.min(limit, list.length)).fill(0).map(async () => {
        while (true) {
            const i = idx++;
            if (i >= list.length)
                break;
            out[i] = await fn(list[i]);
        }
    });
    await Promise.all(workers);
    return out;
}
/** 실시간 티커로 가격/등락률 보정 */
async function enrichTickers(list, take) {
    const base = list.slice(0, take);
    const live = await mapWithConcurrency(base.map(t => t.symbol), 8, // 동시 8개
    async (s) => (await fetchTicker(s)) || null);
    return base.map((t, i) => {
        const rt = live[i];
        return rt ? { ...t, last: rt.price, change24h: rt.change24h } : t;
    });
}
function buildOptions(list) {
    return list.map((t) => new StringSelectMenuOptionBuilder()
        .setLabel(labelOf(t.symbol))
        .setDescription(`$${fmt(t.last)} · 24h ${pct(t.change24h)}`)
        .setValue(t.symbol));
}
export async function coinSelectMenusDual() {
    try {
        const [topRaw, scalpRaw] = await Promise.all([top25ByTurnover(), scalpTop10()]);
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
            new ActionRowBuilder().addComponents(menuTop),
            new ActionRowBuilder().addComponents(menuScalp),
        ];
    }
    catch {
        const list = (CONFIG.SYMBOL_CHOICES ?? []).slice(0, 25);
        const opts = list.map((s) => new StringSelectMenuOptionBuilder().setLabel(labelOf(s)).setDescription(`${s}`).setValue(s));
        const fallback = new StringSelectMenuBuilder()
            .setCustomId(SEL.TOP25)
            .setPlaceholder('심볼 선택 (폴백)')
            .addOptions(opts);
        return [new ActionRowBuilder().addComponents(fallback)];
    }
}
/* ====================== 가상 선물(Paper) UI ====================== */
export const PAPER_BTN = {
    TOGGLE: 'paper_toggle', // 활성/비활성
    LONG: 'paper_long',
    SHORT: 'paper_short',
    CLOSE: 'paper_close',
    FLIP: 'paper_flip',
    RESET: 'paper_reset',
    PORT: 'paper_portfolio', // 요약 보기
    CURR: 'paper_currency', // USD↔KRW 토글
    REFRESH: 'paper_refresh' // 현재가/PNL 새로고침
};
export const PAPER_SEL = {
    AMOUNT: 'paper_amount', // 주문 금액(USD)
    LEV: 'paper_lev' // 레버리지
};
export function rowPaperButtons(enabled = true) {
    return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(PAPER_BTN.TOGGLE).setLabel(enabled ? '가상선물거래: ON' : '가상선물거래: OFF')
        .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId(PAPER_BTN.LONG).setLabel('롱').setStyle(ButtonStyle.Primary).setDisabled(!enabled), new ButtonBuilder().setCustomId(PAPER_BTN.SHORT).setLabel('숏').setStyle(ButtonStyle.Danger).setDisabled(!enabled), new ButtonBuilder().setCustomId(PAPER_BTN.CLOSE).setLabel('Close').setStyle(ButtonStyle.Secondary).setDisabled(!enabled), new ButtonBuilder().setCustomId(PAPER_BTN.FLIP).setLabel('Flip').setStyle(ButtonStyle.Secondary).setDisabled(!enabled));
}
export function rowPaperMgmt(enabled = true) {
    return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(PAPER_BTN.PORT).setLabel('Portfolio').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(PAPER_BTN.CURR).setLabel('USD ↔ KRW').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(PAPER_BTN.RESET).setLabel('초기화').setStyle(ButtonStyle.Secondary).setDisabled(!enabled), new ButtonBuilder().setCustomId(PAPER_BTN.REFRESH).setLabel('실시간 새로고침').setStyle(ButtonStyle.Secondary));
}
/**
 * 주문 금액/레버리지 셀렉트
 * - 기본 후보: 100, 250, 500, 1,000, 2,000, 5,000, 10,000 USD
 * - CONFIG.PAPER.ORDER.MIN/MAX 가 있으면 그 범위 내로 자동 필터
 * - 현재값이 후보에 없으면 자동 추가하여 "현재값" 체크가 유지됨
 */
export function rowPaperSelects(currentAmt = 100, currentLev = 5) {
    const orderCfg = CONFIG?.PAPER?.ORDER ?? { MIN: 100, MAX: 10_000 };
    // 후보 생성 및 범위 필터
    const baseCandidates = [100, 250, 500, 1_000, 2_000, 5_000, 10_000];
    let candidates = baseCandidates.filter(v => v >= orderCfg.MIN && v <= orderCfg.MAX);
    // 현재값 보존
    if (!candidates.includes(currentAmt)) {
        candidates.push(currentAmt);
        candidates = candidates.sort((a, b) => a - b);
    }
    const amount = new StringSelectMenuBuilder()
        .setCustomId(PAPER_SEL.AMOUNT)
        .setPlaceholder(`금액(USD) · 현재 ${currentAmt.toLocaleString()}`)
        .addOptions(candidates.map(v => new StringSelectMenuOptionBuilder()
        .setLabel(`$${v.toLocaleString()}`)
        .setValue(String(v))
        .setDefault(v === currentAmt)));
    const lev = new StringSelectMenuBuilder()
        .setCustomId(PAPER_SEL.LEV)
        .setPlaceholder(`레버리지 · 현재 ${currentLev}x`)
        .addOptions([1, 2, 3, 5, 10, 15, 20, 30, 50].map(v => new StringSelectMenuOptionBuilder()
        .setLabel(`${v}x`)
        .setValue(String(v))
        .setDefault(v === currentLev)));
    return [
        new ActionRowBuilder().addComponents(amount),
        new ActionRowBuilder().addComponents(lev),
    ];
}
