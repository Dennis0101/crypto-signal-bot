// src/ui/components.ts
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { CONFIG } from '../config.js';
import { top25ByTurnover, scalpTop10, type Ticker } from '../clients/bitget.js';

export const BTN = { ANALYZE: 'analyze', LONG: 'long', SHORT: 'short', REFRESH: 'refresh' } as const;
export const SEL = { SYMBOL: 'sel_symbol', TF: 'sel_tf', TOP25: 'coin_select_top25', SCALP10: 'coin_select_scalp10' } as const;

/** 공통 버튼 행 */
export function rowsButtons() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BTN.ANALYZE).setLabel('Analyze').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(BTN.LONG).setLabel('Long').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(BTN.SHORT).setLabel('Short').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(BTN.REFRESH).setLabel('Refresh').setStyle(ButtonStyle.Secondary),
  );
}

/** 고정 셀렉트 (CONFIG 기반) */
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

/** ====== 자동 랭킹 드롭다운 (상위 25 · 단타 10) ====== */

/** 숫자 포맷 */
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

/** Bitget 랭킹에서 드롭다운 옵션 생성 */
function buildOptionsFromTickers(list: Ticker[], limit: number) {
  return list.slice(0, Math.min(25, limit)).map((t) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(labelOf(t.symbol)) // 예: BTC
      .setDescription(`$${fmt(t.last)} · 24h ${pct(t.change24h)}`)
      .setValue(t.symbol), // 예: BTCUSDT
  );
}

/**
 * 상위 25위(거래대금) + 단타 10(변동성 점수) 드롭다운 2개를 반환
 * - Bitget API 실패 시 CONFIG.SYMBOL_CHOICES로 폴백
 */
export async function coinSelectMenusDual() {
  // 1) Bitget 랭킹 시도
  try {
    const [top, scalp] = await Promise.all([top25ByTurnover(), scalpTop10()]);

    const menuTop = new StringSelectMenuBuilder()
      .setCustomId(SEL.TOP25)
      .setPlaceholder('🏆 상위 25위 (24h 거래대금 기준)')
      .addOptions(buildOptionsFromTickers(top, 25));

    const menuScalp = new StringSelectMenuBuilder()
      .setCustomId(SEL.SCALP10)
      .setPlaceholder('⚡ 단타 추천 10 (변동성 우선)')
      .addOptions(buildOptionsFromTickers(scalp, 10));

    return [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menuTop),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menuScalp),
    ];
  } catch (e) {
    // 2) 폴백: CONFIG.SYMBOL_CHOICES 사용
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
