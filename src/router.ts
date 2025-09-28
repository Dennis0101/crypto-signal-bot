import { Client, Message } from 'discord.js';
import { CONFIG } from './config.js';
import { handleCoinCommand } from './commands/coin.js';
import { BTN, SEL, rowsButtons, rowsSelects } from './ui/components.js';
import { fetchCandles, fetchRecentTrades } from './clients/bitget.js';
import { calcBaseFeatures } from './indicators/calc.js';
import { buildCVDandProfile } from './indicators/cvd.js';
import { decide } from './strategy/signal.js';
import { buildEmbed } from './ui/embed.js';

export function initRouter(client: Client) {
  client.on('messageCreate', async (msg: Message) => {
    if (msg.author.bot) return;
    if (!msg.content.startsWith('!코인')) return;
    const parts = msg.content.trim().split(/\s+/);
    const symbol = parts[1];
    const tf = parts[2];
    await handleCoinCommand(msg, symbol, tf);
  });

  client.on('interactionCreate', async (i) => {
    try {
      if (i.isButton()) {
        const m = i.message.embeds?.[0]?.title?.match(/📊 (.+) · (.+) 신호/);
        const symbol = (m?.[1] || CONFIG.DEFAULT_SYMBOL);
        const tf = (m?.[2] || CONFIG.DEFAULT_TF);

        if (i.customId === BTN.ANALYZE || i.customId === BTN.REFRESH) {
          await i.deferUpdate();
          const candles = await fetchCandles(symbol, tf, 300);
          const f = calcBaseFeatures(candles);
          const tfMin = tf.endsWith('m') ? Number(tf.replace('m','')) : tf.endsWith('h') ? Number(tf.replace('h',''))*60 : 15;
          const end = Date.now(), start = end - Math.max(tfMin, 15) * 60 * 1000;
          const trades = await fetchRecentTrades(symbol, start, end, 5000);
          const { cvdSeries, profile } = buildCVDandProfile(trades, tfMin*60*1000, Math.max(0.5, f.last*0.001));
          const cvdNow = cvdSeries.at(-1)?.cvd ?? 0;
          const cvdUp = cvdSeries.length>2 && cvdSeries.at(-1)!.cvd > cvdSeries.at(-2)!.cvd;
          const profileTop = profile.slice().sort((a,b)=>b.vol-a.vol).slice(0,3)
            .map(n => `${n.price.toFixed(2)}(${n.vol.toFixed(0)})`).join(', ');
          const decision = await decide(symbol, tf, f, cvdSeries, profile);
          const [rowSel1, rowSel2] = rowsSelects(symbol, tf);
          await i.editReply({ embeds: [buildEmbed(symbol, tf, f, decision, { cvdNow, cvdUp }, profileTop)], components: [rowsButtons(), rowSel1, rowSel2] });
        } else if (i.customId === BTN.LONG || i.customId === BTN.SHORT) {
          await i.reply({ content: `⚠️ 본 봇은 주문을 실행하지 않습니다. 선택: **${i.customId.toUpperCase()}**`, ephemeral: true });
        }
      } else if (i.isStringSelectMenu()) {
        let [symbol, tf] = (() => {
          const m = i.message.embeds?.[0]?.title?.match(/📊 (.+) · (.+) 신호/);
          return [m?.[1] || CONFIG.DEFAULT_SYMBOL, m?.[2] || CONFIG.DEFAULT_TF];
        })();
        if (i.customId === SEL.SYMBOL) symbol = i.values[0];
        if (i.customId === SEL.TF) tf = i.values[0];

        await i.deferUpdate();
        const candles = await fetchCandles(symbol, tf, 300);
        const f = calcBaseFeatures(candles);
        const tfMin = tf.endsWith('m') ? Number(tf.replace('m','')) : tf.endsWith('h') ? Number(tf.replace('h',''))*60 : 15;
        const end = Date.now(), start = end - Math.max(tfMin, 15) * 60 * 1000;
        const trades = await fetchRecentTrades(symbol, start, end, 5000);
        const { cvdSeries, profile } = buildCVDandProfile(trades, tfMin*60*1000, Math.max(0.5, f.last*0.001));
        const cvdNow = cvdSeries.at(-1)?.cvd ?? 0;
        const cvdUp = cvdSeries.length>2 && cvdSeries.at(-1)!.cvd > cvdSeries.at(-2)!.cvd;
        const profileTop = profile.slice().sort((a,b)=>b.vol-a.vol).slice(0,3)
          .map(n => `${n.price.toFixed(2)}(${n.vol.toFixed(0)})`).join(', ');
        const decision = await decide(symbol, tf, f, cvdSeries, profile);
        const { rowsButtons, rowsSelects } = await import('./ui/components.js');
        const [rowSel1, rowSel2] = rowsSelects(symbol, tf);
        await i.editReply({ embeds: [buildEmbed(symbol, tf, f, decision, { cvdNow, cvdUp }, profileTop)], components: [rowsButtons(), rowSel1, rowSel2] });
      }
    } catch (e) {
      if (i.isRepliable()) {
        if (i.deferred || i.replied) await i.editReply({ content: '오류가 발생했습니다.', components: [] });
        else await i.reply({ content: '오류가 발생했습니다.', ephemeral: true });
      }
    }
  });
}
