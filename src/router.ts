// src/router.ts
import { Client, Message } from 'discord.js';
import { CONFIG } from './config.js';

// 분석 파이프라인
import { handleCoinCommand } from './commands/coin.js';
import { handleCoinRoot } from './commands/coin-root.js';
import { fetchCandles, fetchRecentTrades } from './clients/bitget.js';
import { calcBaseFeatures } from './indicators/calc.js';
import { buildCVDandProfile } from './indicators/cvd.js';
import { decide } from './strategy/signal.js';
import { buildEmbed } from './ui/embed.js';

// 기본 UI
import { BTN, SEL, rowsButtons, rowsSelects, coinSelectMenusDual } from './ui/components.js';

// Paper Trading UI & 서비스
import {
  PAPER_BTN, PAPER_SEL,
  rowPaperButtons, rowPaperMgmt, rowPaperSelects
} from './ui/components.js';
import {
  getAccount
} from './paper/store.js';
import {
  placePaperOrder, closePaperPosition, flipPaperPosition,
  setPaperAmount, setPaperLeverage, toggleCurrency,
  toggleEnabled, resetPaper
} from './paper/service.js';
import { buildPortfolioEmbed } from './paper/ui.js';

export function initRouter(client: Client) {
  /* ========== 텍스트 명령어 ========== */
  client.on('messageCreate', async (msg: Message) => {
    if (msg.author.bot) return;
    if (!msg.content.startsWith('!코인')) return;

    const parts = msg.content.trim().split(/\s+/);
    const symbol = parts[1] || CONFIG.DEFAULT_SYMBOL;
    const tf     = parts[2] || CONFIG.DEFAULT_TF;

    // 1) 기본 분석 메시지
    await handleCoinCommand(msg, symbol, tf);

    // 2) 상위25/단타10 드롭다운(보조 메시지)
    await handleCoinRoot(msg);
  });

  /* ========== 상호작용(버튼/셀렉트) ========== */
  client.on('interactionCreate', async (i) => {
    try {
      /* ----- 기본 분석 버튼 ----- */
      if (i.isButton() && (i.customId === BTN.ANALYZE || i.customId === BTN.REFRESH)) {
        const m = i.message.embeds?.[0]?.title?.match(/📊 (.+) · (.+) 신호/);
        const symbol = (m?.[1] || CONFIG.DEFAULT_SYMBOL);
        const tf     = (m?.[2] || CONFIG.DEFAULT_TF);

        await i.deferUpdate();

        const candles = await fetchCandles(symbol, tf, 300);
        const f = calcBaseFeatures(candles);

        const tfMin = tf.endsWith('m') ? Number(tf.replace('m',''))
                    : tf.endsWith('h') ? Number(tf.replace('h',''))*60 : 15;
        const end = Date.now();
        const start = end - Math.max(tfMin, 15) * 60 * 1000;
        const trades = await fetchRecentTrades(symbol, start, end, 5000);

        const { cvdSeries, profile } =
          buildCVDandProfile(trades, tfMin*60*1000, Math.max(0.5, f.last*0.001));

        const decision = await decide(symbol, tf, f, cvdSeries, profile);
        const cvdNow = cvdSeries.at(-1)?.cvd ?? 0;
        const cvdUp  = cvdSeries.length>2 && cvdSeries.at(-1)!.cvd > cvdSeries.at(-2)!.cvd;
        const profileTop = profile.slice().sort((a,b)=>b.vol-a.vol).slice(0,3)
          .map(n => `${n.price.toFixed(2)}(${n.vol.toFixed(0)})`).join(', ');

        const [rowSel1, rowSel2] = rowsSelects(symbol, tf);
        const menus = await coinSelectMenusDual();

        // ✅ 여기에 Paper UI를 함께 붙인다
        const acc = getAccount(i.user.id);

        await i.editReply({
          embeds: [buildEmbed(symbol, tf, f, decision, { cvdNow, cvdUp }, profileTop)],
          components: [
            rowsButtons(),
            rowSel1, rowSel2,
            ...menus,
            rowPaperButtons(acc.enabled),
            rowPaperMgmt(acc.enabled),
            ...rowPaperSelects(acc.orderAmountUSD, acc.leverage),
          ],
        });
        return;
      }

      /* ----- Paper 버튼 ----- */
      if (i.isButton() && Object.values(PAPER_BTN).includes(i.customId as any)) {
        const m = i.message.embeds?.[0]?.title?.match(/📊 (.+) · (.+) 신호/);
        const symbol = (m?.[1] || CONFIG.DEFAULT_SYMBOL);
        const userId = i.user.id;

        try {
          switch (i.customId) {
            case PAPER_BTN.TOGGLE: {
              const on = toggleEnabled(userId);
              await i.reply({ content: `🧪 Paper Trading: ${on ? 'ON' : 'OFF'}`, ephemeral: true });
              break;
            }
            case PAPER_BTN.LONG: {
              const { price, qty, lev } = await placePaperOrder(userId, symbol, 'LONG');
              await i.reply({ content: `✅ LONG 체결 • ${symbol} @ ${price.toFixed(4)} · qty ${qty.toFixed(4)} · ${lev}x`, ephemeral:true });
              break;
            }
            case PAPER_BTN.SHORT: {
              const { price, qty, lev } = await placePaperOrder(userId, symbol, 'SHORT');
              await i.reply({ content: `✅ SHORT 체결 • ${symbol} @ ${price.toFixed(4)} · qty ${qty.toFixed(4)} · ${lev}x`, ephemeral:true });
              break;
            }
            case PAPER_BTN.CLOSE: {
              const { price, pnl } = await closePaperPosition(userId, symbol);
              await i.reply({ content: `🔚 포지션 청산 • ${symbol} @ ${price.toFixed(4)} · PnL ${pnl.toFixed(2)} USD`, ephemeral:true });
              break;
            }
            case PAPER_BTN.FLIP: {
              await flipPaperPosition(userId, symbol);
              await i.reply({ content: `🔁 포지션 뒤집기 완료`, ephemeral:true });
              break;
            }
            case PAPER_BTN.RESET: {
              resetPaper(userId);
              await i.reply({ content: `🧹 가상선물 초기화 완료`, ephemeral:true });
              break;
            }
            case PAPER_BTN.PORT: {
              const e = await buildPortfolioEmbed(userId);
              const acc = getAccount(userId);
              const rows = [
                rowPaperButtons(acc.enabled),
                rowPaperMgmt(acc.enabled),
                ...rowPaperSelects(acc.orderAmountUSD, acc.leverage),
              ];
              await i.reply({ embeds: [e], components: rows, ephemeral: true });
              break;
            }
            case PAPER_BTN.CURR: {
              const curr = toggleCurrency(userId);
              await i.reply({ content: `통화: ${curr}`, ephemeral:true });
              break;
            }
            case PAPER_BTN.REFRESH: {
              // 메인 임베드 재계산(선택)
              const tfMatch = i.message.embeds?.[0]?.title?.match(/📊 .+ · (.+) 신호/);
              const tf = (tfMatch?.[1] || CONFIG.DEFAULT_TF);

              const candles = await fetchCandles(symbol, tf, 300);
              const f = calcBaseFeatures(candles);
              const tfMin = tf.endsWith('m') ? Number(tf.replace('m',''))
                         : tf.endsWith('h') ? Number(tf.replace('h',''))*60 : 15;
              const end = Date.now(), start = end - Math.max(tfMin, 15) * 60 * 1000;
              const trades = await fetchRecentTrades(symbol, start, end, 5000);
              const { cvdSeries, profile } =
                buildCVDandProfile(trades, tfMin*60*1000, Math.max(0.5, f.last*0.001));
              const decision = await decide(symbol, tf, f, cvdSeries, profile);

              const cvdNow = cvdSeries.at(-1)?.cvd ?? 0;
              const cvdUp  = cvdSeries.length>2 && cvdSeries.at(-1)!.cvd > cvdSeries.at(-2)!.cvd;
              const profileTop = profile.slice().sort((a,b)=>b.vol-a.vol).slice(0,3)
                .map(n => `${n.price.toFixed(2)}(${n.vol.toFixed(0)})`).join(', ');

              await i.update({
                embeds: [buildEmbed(symbol, tf, f, decision, { cvdNow, cvdUp }, profileTop)],
                components: i.message.components // 기존 버튼 유지
              });
              break;
            }
          }
        } catch (e: any) {
          await i.reply({ content: `⚠️ ${e?.message || '오류'}`, ephemeral: true });
        }
        return;
      }

      /* ----- 셀렉트(심볼/TF/랭킹) ----- */
      if (i.isStringSelectMenu()) {
        let [symbol, tf] = (() => {
          const m = i.message.embeds?.[0]?.title?.match(/📊 (.+) · (.+) 신호/);
          return [m?.[1] || CONFIG.DEFAULT_SYMBOL, m?.[2] || CONFIG.DEFAULT_TF];
        })();

        if (i.customId === SEL.SYMBOL) symbol = i.values[0];
        if (i.customId === SEL.TF)     tf     = i.values[0];
        if (i.customId === SEL.TOP25 || i.customId === SEL.SCALP10) {
          symbol = i.values[0];
        }

        await i.deferUpdate();

        const candles = await fetchCandles(symbol, tf, 300);
        const f = calcBaseFeatures(candles);

        const tfMin = tf.endsWith('m') ? Number(tf.replace('m',''))
                    : tf.endsWith('h') ? Number(tf.replace('h',''))*60 : 15;
        const end = Date.now();
        const start = end - Math.max(tfMin, 15) * 60 * 1000;
        const trades = await fetchRecentTrades(symbol, start, end, 5000);

        const { cvdSeries, profile } =
          buildCVDandProfile(trades, tfMin*60*1000, Math.max(0.5, f.last*0.001));
        const decision = await decide(symbol, tf, f, cvdSeries, profile);

        const cvdNow = cvdSeries.at(-1)?.cvd ?? 0;
        const cvdUp  = cvdSeries.length>2 && cvdSeries.at(-1)!.cvd > cvdSeries.at(-2)!.cvd;
        const profileTop = profile.slice().sort((a,b)=>b.vol-a.vol).slice(0,3)
          .map(n => `${n.price.toFixed(2)}(${n.vol.toFixed(0)})`).join(', ');

        const [rowSel1, rowSel2] = rowsSelects(symbol, tf);
        const menus = await coinSelectMenusDual();

        const acc = getAccount(i.user.id);

        await i.editReply({
          embeds: [buildEmbed(symbol, tf, f, decision, { cvdNow, cvdUp }, profileTop)],
          components: [
            rowsButtons(),
            rowSel1, rowSel2,
            ...menus,
            rowPaperButtons(acc.enabled),
            rowPaperMgmt(acc.enabled),
            ...rowPaperSelects(acc.orderAmountUSD, acc.leverage),
          ],
        });
        return;
      }

    } catch (e) {
      console.error('Router error:', e);
      if (i.isRepliable()) {
        if (i.deferred || i.replied) {
          await i.editReply({ content: '오류가 발생했습니다.', components: [] });
        } else {
          await i.reply({ content: '오류가 발생했습니다.', ephemeral: true });
        }
      }
    }
  });
}
