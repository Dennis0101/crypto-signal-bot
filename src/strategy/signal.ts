import type { BaseFeatures } from '../indicators/calc.js';
import type { CVDPoint, ProfileNode } from '../indicators/cvd.js';
import { getLLMDecision } from '../clients/openai.js';

export type RuleDecision = { dir:'LONG'|'SHORT'|'NEUTRAL'; conf:number; hint:string };

export function ruleDecision(f: BaseFeatures, cvd?: CVDPoint[]): RuleDecision {
  if (!isFinite(f.e20) || !isFinite(f.e50) || !isFinite(f.rsi)) return { dir:'NEUTRAL', conf:40, hint:'데이터 부족' };
  const cvdUp = (cvd?.length||0) > 2 && cvd!.at(-1)!.cvd > cvd!.at(-2)!.cvd;

  if (f.e20 > f.e50 && f.rsi > 55) return { dir:'LONG', conf:65 + (cvdUp?10:0), hint:`상승 우위(EMA+RSI${cvdUp?'+CVD상방':''})` };
  if (f.e20 < f.e50 && f.rsi < 45) return { dir:'SHORT', conf:65 + (!cvdUp?10:0), hint:`하락 우위(EMA+RSI${!cvdUp?'+CVD하방':''})` };
  return { dir:'NEUTRAL', conf:50, hint:'횡보/혼조' };
}

export async function decide(symbol:string, tf:string, f:BaseFeatures, cvd:CVDPoint[], profile:ProfileNode[]) {
  const rule = ruleDecision(f, cvd);
  const llm = await getLLMDecision({
    symbol, tf, f, rule,
    context: { cvdNow: cvd.at(-1)?.cvd ?? 0, cvdUp: cvd.length>2 && cvd.at(-1)!.cvd > cvd.at(-2)!.cvd, topNodes: profile.slice().sort((a,b)=>b.vol-a.vol).slice(0,3) }
  });

  const dir = (llm?.direction as RuleDecision['dir']) || rule.dir;
  const conf = Math.round(llm?.confidence ?? rule.conf);
  const rationale = llm?.rationale || rule.hint;
  const levels = llm?.levels || {
    entry: f.last,
    stop: f.last * (dir==='LONG'?0.985:dir==='SHORT'?1.015:0.995),
    take_profit: f.last * (dir==='LONG'?1.02:dir==='SHORT'?0.98:1.005)
  };
  const risk = llm?.risk || '변동성에 유의. 손절 필수.';

  return { dir, conf, rationale, levels, risk };
}
