import OpenAI from 'openai';
import { CONFIG } from '../config.js';

const client = CONFIG.OPENAI.KEY ? new OpenAI({ apiKey: CONFIG.OPENAI.KEY }) : null;

export async function getLLMDecision(payload: any): Promise<any|null> {
  if (!client) return null;
  const { symbol, tf, f, rule, context } = payload;
  const prompt = `
시점: ${new Date().toISOString()}
종목: ${symbol}, 타임프레임: ${tf}
지표: EMA20=${f.e20?.toFixed(4)}, EMA50=${f.e50?.toFixed(4)}, RSI=${f.rsi?.toFixed(1)}, 변동성=${(f.volatility*100)?.toFixed(2)}%
룰 판단: ${rule.dir} (conf=${rule.conf}, ${rule.hint})
CVD: now=${context.cvdNow} (${context.cvdUp?'상방':'하방/중립'})
볼륨 상위: ${context.topNodes.map((n:any)=>`${n.price.toFixed(2)}(${n.vol.toFixed(0)})`).join(', ')}
JSON으로만 답:
{"direction":"LONG|SHORT|NEUTRAL","confidence":0-100,"rationale":"2~4줄","levels":{"entry":number,"stop":number,"take_profit":number},"risk":"1~2줄"}
현재가: ${f.last?.toFixed(4)}
  `.trim();

  try {
    const res = await client.chat.completions.create({
      model: CONFIG.OPENAI.MODEL, temperature: 0.2,
      messages: [{ role: 'user', content: prompt }]
    });
    const text = res.choices[0].message.content || '';
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}
