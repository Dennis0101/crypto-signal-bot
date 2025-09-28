import { EmbedBuilder } from 'discord.js';
import { getAccount } from './store.js';
import { fmtMoney, positionPnlUSD, marginUsedUSD } from './math.js';
import { fetchTicker } from '../clients/bitget.js';

export async function buildPortfolioEmbed(userId: string) {
  const acc = getAccount(userId);
  const curr = acc.currency;

  // 포지션 요약
  const fields: any[] = [];
  let unrealized = 0;
  for (const p of acc.positions) {
    const t = await fetchTicker(p.symbol);
    const mark = t?.price ?? p.entry;
    const pnl = positionPnlUSD(p, mark);
    unrealized += pnl;
    fields.push({
      name: `${p.symbol} · ${p.side} ${p.leverage}x`,
      value:
        `입장 ${p.entry.toFixed(4)} / 현재 ${mark.toFixed(4)}\n` +
        `수량 ${p.qty.toFixed(4)} · PnL ${fmtMoney(pnl, curr)}\n` +
        `사용 마진 ${fmtMoney(marginUsedUSD(p, mark), curr)}`,
      inline: false
    });
  }

  const e = new EmbedBuilder()
    .setTitle('🧪 가상선물 포트폴리오')
    .setDescription(
      `상태: ${acc.enabled ? 'ON' : 'OFF'}\n` +
      `자본: ${fmtMoney(acc.equityUSD, curr)}\n` +
      `미실현손익: ${fmtMoney(unrealized, curr)}\n` +
      `주문금액: $${acc.orderAmountUSD} · 레버리지: ${acc.leverage}x`
    )
    .setFooter({ text: '투자 조언 아님 · 페이퍼 모드' });

  if (fields.length) e.addFields(fields);
  else e.addFields({ name: '포지션 없음', value: '버튼으로 Long/Short 테스트해보세요.' });

  // 최근 체결 3개
  if (acc.history.length) {
    const last3 = acc.history.slice(0,3).map(h =>
      `• ${h.symbol} ${h.side} ${h.leverage}x | PnL ${h.pnlUSD.toFixed(2)} USD`
    ).join('\n');
    e.addFields({ name: '최근 체결', value: last3 });
  }

  return e;
}
