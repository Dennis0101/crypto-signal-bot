import { Message } from 'discord.js';
import { CONFIG } from '../config.js';
import { fetchCandles, fetchRecentTrades } from '../clients/bitget.js';
import { calcBaseFeatures } from '../indicators/calc.js';
import { buildCVDandProfile } from '../indicators/cvd.js';
import { decide } from '../strategy/signal.js';
import { buildEmbed } from '../ui/embed.js';
import { rowsButtons, rowsSelects } from '../ui/components.js';
import { TTLCache } from '../utils/cache.js';

const cache = new TTLCache<string, any>(CONFIG.CACHE_TTL_MS);
const cooldown = new Map<string, number>();

export async function handleCoinCommand(msg: Message, symbolArg?: string, tfArg?: string) {
  const now = Date.now();
  const last = cooldown.get(msg.channelId) || 0;
  if (now - last < CONFIG.COOLDOWN_MS) {
    await msg.reply('⏳ 잠시 후 다시 시도해주세요.(쿨다운)');
    return;
  }
  cooldown.set(msg.channelId, now);

  const symbol = (symbolArg || CONFIG.DEFAULT_SYMBOL).toUpperCase();
  const tf = (tfArg || CONFIG.DEFAULT_TF);

  await msg.channel.send({ content: `⏳ 분석 중... (${symbol} · ${tf})` });

  // 캔들
  const key = `${symbol}:${tf}:candles`;
  const candles = cache.get(key) || await fetchCandles(symbol, tf, 300);
  cache.set(key, candles);
  const f = calcBaseFeatures(candles);

  // 체결 → CVD/프로파일
  const tfMin = tf.endsWith('m') ? Number(tf.replace('m','')) : tf.endsWith('h') ? Number(tf.replace('h',''))*60 : 15;
  const end = Date.now();
  const start = end - Math.max(tfMin, 15) * 60 * 1000;
  const trades = await fetchRecentTrades(symbol, start, end, 5000);
  const { cvdSeries, profile } = buildCVDandProfile(trades, tfMin*60*1000, Math.max(0.5, f.last*0.001));
  const cvdNow = cvdSeries.at(-1)?.cvd ?? 0;
  const cvdUp = cvdSeries.length>2 && cvdSeries.at(-1)!.cvd > cvdSeries.at(-2)!.cvd;
  const profileTop = profile.slice().sort((a,b)=>b.vol-a.vol).slice(0,3)
    .map(n => `${n.price.toFixed(2)}(${n.vol.toFixed(0)})`).join(', ');

  // 결정
  const decision = await decide(symbol, tf, f, cvdSeries, profile);

  // UI
  const [rowSel1, rowSel2] = rowsSelects(symbol, tf);
  await msg.channel.send({
    embeds: [buildEmbed(symbol, tf, f, decision, { cvdNow, cvdUp }, profileTop)],
    components: [rowsButtons(), rowSel1, rowSel2]
  });
}
