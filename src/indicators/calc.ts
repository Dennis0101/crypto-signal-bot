import { RSI, EMA } from 'technicalindicators';
import type { Candle } from '../clients/bitget.js';

export type BaseFeatures = {
  last: number; e20: number; e50: number; rsi: number; volatility: number;
};

export function calcBaseFeatures(series: Candle[]): BaseFeatures {
  const values = series.map(s => s.close);
  if (values.length < 60) throw new Error('캔들 데이터 부족(>=60)');
  const ema20 = EMA.calculate({ period: 20, values });
  const ema50 = EMA.calculate({ period: 50, values });
  const rsi = RSI.calculate({ period: 14, values });
  const last = values.at(-1)!;

  const returns = values.slice(1).map((v,i) => Math.abs((v - values[i]) / values[i]));
  const volatility = returns.slice(-50).reduce((a,b)=>a+b,0) / Math.max(1, Math.min(50, returns.length));

  return { last, e20: ema20.at(-1)!, e50: ema50.at(-1)!, rsi: rsi.at(-1)!, volatility };
}
