// src/ui/embed.ts
import { EmbedBuilder } from 'discord.js';
import type { BaseFeatures } from '../indicators/calc.js';

type FinalDecision = {
  recommend: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number; // 0 ~ 1
  reasons: string[];
  rationale: string;
  levels: { entry: number; stop: number; take_profit: number };
  risk: string;
  source?: 'LLM' | 'RULE' | 'HYBRID';
  // 🔥 옵션: 실시간 평가 데이터 추가
  pnlUSD?: number;   // 현재 포지션 기준 수익/손실
  roiPct?: number;   // 수익률 %
};

function fmt(n: unknown, d = 4) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(d) : '-';
}
function pct(n: number | undefined) {
  return Number.isFinite(n ?? NaN) ? `${(n! * 100).toFixed(2)}%` : '-';
}

function colorFor(rec: FinalDecision['recommend']) {
  switch (rec) {
    case 'LONG': return 0x22c55e;   // green
    case 'SHORT': return 0xef4444;  // red
    default: return 0x64748b;       // slate/neutral
  }
}

export function buildEmbed(
  symbol: string,
  tf: string,
  f: BaseFeatures,
  decision: FinalDecision,
  cvdInfo: { cvdNow: number; cvdUp: boolean },
  profileTop: string
) {
  const rec = decision.recommend;
  const conf = decision.confidence;
  const reasons =
    decision.reasons?.length
      ? decision.reasons.map(r => `• ${r}`).join('\n')
      : '규칙/데이터 기준으로 특이 신호 없음';

  const descLines = [
    `**추천**: ${rec} | **신뢰도**: ${(conf * 100).toFixed(1)}%`,
    decision.rationale?.trim() ? decision.rationale.trim() : '',
    decision.source ? `(_source: ${decision.source}_)` : ''
  ].filter(Boolean);

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${symbol} · ${tf} 신호`)
    .setColor(colorFor(rec))
    .setDescription(descLines.join('\n'))
    .addFields(
      {
        name: '📈 가격/지표',
        value:
          `현재가: ${fmt(f.last)}\n` +
          `EMA20 / EMA50: ${fmt(f.e20)} / ${fmt(f.e50)}\n` +
          `RSI: ${fmt(f.rsi, 1)}  ·  변동성: ${fmt((f.volatility ?? 0) * 100, 2)}%`,
        inline: false
      },
      {
        name: '🎯 레벨(참고)',
        value:
          `진입: ${fmt(decision.levels?.entry)}\n` +
          `손절: ${fmt(decision.levels?.stop)}\n` +
          `익절: ${fmt(decision.levels?.take_profit)}`,
        inline: true
      },
      {
        name: '📊 CVD 요약',
        value: `최근 CVD: ${fmt(cvdInfo.cvdNow, 0)} (${cvdInfo.cvdUp ? '상방' : '하방/중립'})`,
        inline: true
      },
      {
        name: '🏦 볼륨 상위',
        value: profileTop || '데이터 부족',
        inline: false
      },
      {
        name: '📝 추천 이유',
        value: reasons,
        inline: false
      }
    );

  // 🔥 수익률/손익 표시 추가
  if (decision.pnlUSD !== undefined || decision.roiPct !== undefined) {
    embed.addFields({
      name: '💰 실시간 성과',
      value:
        `PnL: ${decision.pnlUSD ? `$${decision.pnlUSD.toFixed(2)}` : '-'}\n` +
        `ROI: ${decision.roiPct ? pct(decision.roiPct) : '-'}`,
      inline: false
    });
  }

  embed.setFooter({
    text: `📉코인 선물거래 AI봇 · 리스크: ${decision.risk || 'N/A'} · 개발자: LEE GUN`
  });

  return embed;
}
