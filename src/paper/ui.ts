// src/paper/ui.ts
import { EmbedBuilder } from 'discord.js';
import { getAccount } from './store.js';
import { fetchTicker } from '../clients/bitget.js';
import { usdToKrw, fmtUSD, fmtKRW, unrealizedPnlUSD } from './math.js';

export async function buildPortfolioEmbed(guildId: string, userId: string) {
  const acc = getAccount(guildId, userId);

  if (!acc) {
    return new EmbedBuilder()
      .setTitle(`🧪 Paper Portfolio`)
      .setDescription('⚠️ 계정 정보가 없습니다. 먼저 Paper Trading을 활성화하세요.')
      .setColor(0xEF4444);
  }

  let upnl = 0;
  const fields: { name: string; value: string; inline?: boolean }[] = [];

  for (const p of acc.positions.values()) {
    const t = await fetchTicker(p.symbol);
    const mark = t?.price ?? p.entry;
    const pnl = unrealizedPnlUSD(p.side, p.entry, mark, p.qty);
    upnl += pnl;

    fields.push({
      name: `${p.symbol} · ${p.side} · ${p.lev}x`,
      value:
        `진입: ${p.entry.toFixed(4)} / 수량: ${p.qty.toFixed(4)}\n` +
        `현재가: ${mark.toFixed(4)} · 미실현PnL: ${fmtUSD(pnl)}`,
      inline: false,
    });
  }

  const totalUSD = acc.equityUSD + upnl;
  const totalKRW = usdToKrw(totalUSD);

  const e = new EmbedBuilder()
    .setTitle(`🧪 Paper Portfolio`)
    .setDescription(
      `상태: **${acc.enabled ? 'ON' : 'OFF'}**, 통화: **${acc.currency}**\n` +
      `현금(USD): ${fmtUSD(acc.equityUSD)}  ·  미실현PnL: ${fmtUSD(upnl)}\n` +
      `총자산: ${fmtUSD(totalUSD)} (${fmtKRW(totalKRW)})\n` +
      `주문금액: $${acc.orderAmountUSD}  ·  레버리지: ${acc.leverage}x`
    )
    .addFields(fields.length ? fields : [{ name: '포지션', value: '보유 포지션 없음', inline: false }])
    .setColor(0x3B82F6); // 파란색 기본

  return e;
}
