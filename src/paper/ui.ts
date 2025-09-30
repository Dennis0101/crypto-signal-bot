// src/paper/ui.ts
import { EmbedBuilder } from 'discord.js';
import { getAccount } from './store.js';
import { usdToKrw, fmtUSD, fmtKRW, unrealizedPnlUSD } from './math.js';
import { getSafeTicker } from './price.js';

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '0.00%';
  return (n * 100).toFixed(2) + '%';
}

function fmtByCurrency(usd: number, currency: 'USD' | 'KRW'): string {
  return currency === 'KRW' ? fmtKRW(usdToKrw(usd)) : fmtUSD(usd);
}

export async function buildPortfolioEmbed(userId: string) {
  const acc = getAccount(userId);

  let upnlUSD = 0;
  let usedMarginUSDTotal = 0;

  const fields: { name: string; value: string; inline?: boolean }[] = [];

  for (const p of acc.positions.values()) {
    // 안전 현재가 (티커 → 1m 중앙값 폴백)
    const t = await getSafeTicker(p.symbol);
    const mark = Number.isFinite(t?.price) ? (t!.price as number) : p.entry;

    // 미실현 손익(USD)
    const pnl = unrealizedPnlUSD(p.side, p.entry, mark, p.qty);
    upnlUSD += pnl;

    // 증거금(사용 마진): 진입가*수량 / 레버리지
    const marginUSD = (p.entry * p.qty) / Math.max(1, p.lev);
    usedMarginUSDTotal += marginUSD;

    // ROI% (증거금 기준)
    const roi = marginUSD > 0 ? pnl / marginUSD : 0;

    const pnlStrUSD = fmtUSD(pnl);
    const pnlStrKRW = fmtKRW(usdToKrw(pnl));
    const marginStr = fmtUSD(marginUSD);

    fields.push({
      name: `${p.symbol} · ${p.side} · ${p.lev}x`,
      value:
        `진입 ${p.entry.toFixed(4)}  ·  현재 ${mark.toFixed(4)}  ·  수량 ${p.qty.toFixed(4)}\n` +
        `증거금 ${marginStr}  ·  미실현PnL ${pnlStrUSD} (${pnlStrKRW})  ·  ROI ${fmtPct(roi)}`,
      inline: false,
    });
  }

  // 총자산/수익률
  const totalUSD = acc.equityUSD + upnlUSD;
  const totalKRW = usdToKrw(totalUSD);
  const totalRoi = usedMarginUSDTotal > 0 ? upnlUSD / usedMarginUSDTotal : 0;

  const equityLine =
    acc.currency === 'KRW'
      ? `현금: ${fmtKRW(usdToKrw(acc.equityUSD))}`
      : `현금: ${fmtUSD(acc.equityUSD)}`;

  const upnlLine =
    acc.currency === 'KRW'
      ? `미실현PnL: ${fmtKRW(usdToKrw(upnlUSD))} (${fmtPct(totalRoi)})`
      : `미실현PnL: ${fmtUSD(upnlUSD)} (${fmtPct(totalRoi)})`;

  const totalLine =
    acc.currency === 'KRW'
      ? `총자산: ${fmtKRW(totalKRW)}`
      : `총자산: ${fmtUSD(totalUSD)} (${fmtKRW(totalKRW)})`;

  const e = new EmbedBuilder()
    .setTitle(`🧪 Paper Portfolio`)
    .setDescription(
      [
        `상태: **${acc.enabled ? 'ON' : 'OFF'}**  ·  통화: **${acc.currency}**`,
        `${equityLine}  ·  ${upnlLine}`,
        `${totalLine}`,
        `주문금액: $${acc.orderAmountUSD}  ·  레버리지: ${acc.leverage}x`,
        `\n🔄 PnL 실시간 갱신: **Refresh PnL** 버튼 사용`,
      ].join('\n'),
    )
    .addFields(fields.length ? fields : [{ name: '포지션', value: '보유 포지션 없음', inline: false }]);

  return e;
}
