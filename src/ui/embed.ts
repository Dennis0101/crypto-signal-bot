// embed.ts
import { EmbedBuilder } from 'discord.js';
import type { BaseFeatures } from '../indicators/calc.js';

export function buildEmbed(symbol:string, tf:string, f:BaseFeatures, decision:any, cvdInfo:{cvdNow:number, cvdUp:boolean}, profileTop:string) {
  const { dir, conf, rationale, levels, risk } = decision;
  return new EmbedBuilder()
    .setTitle(`📊 ${symbol} · ${tf} 신호`)
    .setDescription(`**추천**: ${dir} | **신뢰도**: ${conf}\n${rationale}`)
    .addFields(
      { name:'가격/지표', value:`현재가: ${f.last.toFixed(4)}\nEMA20: ${f.e20.toFixed(4)} / EMA50: ${f.e50.toFixed(4)}\nRSI: ${f.rsi.toFixed(1)}  변동성: ${(f.volatility*100).toFixed(2)}%` },
      { name:'레벨(참고)', value:`진입: ${levels.entry?.toFixed(4)}\n손절: ${levels.stop?.toFixed(4)}\n익절: ${levels.take_profit?.toFixed(4)}` },
      { name:'CVD 요약', value:`최근 CVD: ${cvdInfo.cvdNow.toFixed(0)} (${cvdInfo.cvdUp?'상방':'하방/중립'})` },
      { name:'볼륨 상위', value: profileTop || '데이터 부족' }
    )
    .setFooter({ text:'투자 조언 아님 · 주문 비활성(기본)' });
}
