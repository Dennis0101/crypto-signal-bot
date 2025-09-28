// src/router.ts
import { Client, Message } from 'discord.js';
import { CONFIG } from './config.js';
import { handleCoinCommand } from './commands/coin.js';
import {
  BTN, SEL, rowsButtons, rowsSelects, coinSelectMenusDual,
  PAPER_BTN, PAPER_SEL, rowPaperButtons, rowPaperMgmt, rowPaperSelects
} from './ui/components.js';
import { fetchCandles, fetchRecentTrades } from './clients/bitget.js';
import { calcBaseFeatures } from './indicators/calc.js';
import { buildCVDandProfile } from './indicators/cvd.js';
import { decide } from './strategy/signal.js';
import { buildEmbed } from './ui/embed.js';
import { handleCoinRoot } from './commands/coin-root.js';

// ===== Paper trading store/services/ui =====
import { getAccount } from './paper/store.js';
import {
  placePaperOrder, closePaperPosition, flipPaperPosition,
  setPaperAmount, setPaperLeverage, toggleCurrency,
  toggleEnabled, resetPaper
} from './paper/service.js';
import { buildPortfolioEmbed } from './paper/ui.js';

export function initRouter(client: Client) {
  /* ===================== 메시지 커맨드 ===================== */
  client.on('messageCreate', async (msg: Message) => {
    if (msg.author.bot) return;
    if (!msg.content.startsWith('!코인')) return;

    const parts = msg.content.trim().split(/\s+/);
    const symbol = parts[1] || CONFIG.DEFAULT_SYMBOL;
    const tf = parts[2] || CONFIG.DEFAULT_TF;

    // 분석 1회 실행
    await handleCoinCommand(msg, symbol, tf);

    // Top25/Scalp10 메뉴 함께 출력
    await handleCoinRoot(msg);
  });

  /* ===================== 상호작용 핸들러 ===================== */
  client.on('interactionCreate', async (i) => {
    try {
      /* ---------- 페이퍼 트레이딩: 버튼 ---------- */
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
              // 메인 분석 임베드도 최신 데이터로 갱신
              const m2 = i.message.embeds?.[0]?.title?.match(/📊 .+ · (.+) 신호/);
              const tf = (m2?.[1] || CONFIG.DEFAULT_TF);
              const candles = await fetchCandles(symbol, tf, 300);
              const f = calcBaseFeatures(candles);
              const tfMin = tf.endsWith('m') ? Number(tf.replace('m',''))
                         : tf.endsWith('h') ? Number(tf.replace('h',''))*60 : 15;
              const end = Date.now(), start = end - Math.max(tfMin, 15) * 60 * 1000;
              const trades = await fetchRecentTrades(symbol, start, end, 5000);
              const { cvdSeries, profile } = buildCVDandProfile(trades, tfMin*60*1000, Math.max(0.5, f.last*0.001));
              const decision = await decide(symbol, tf, f, cvdSeries, profile);

              const cvdNow = cvdSeries.at(-1)?.cvd ?? 0;
              const cvdUp = cvdSeries.length>2 && cvdSeries.at(-1)!.cvd > cvdSeries.at(-2)!.cvd;
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
        return; // 다른 핸들러로 넘어가지 않도록 종료
      }

      /* ---------- 기본 분석: 버튼 ---------- */
      if (i.isButton()) {
        const m = i.message.embeds?.[0]?.title?.match(/📊 (.+) · (.+) 신호/);
        const symbol = m?.[1] || CONFIG.DEFAULT_SYMBOL;
        const tf = m?.[2] || CONFIG.DEFAULT_TF;

        if (i.customId === BTN.ANALYZE || i.customId === BTN.REFRESH) {
          await i.deferUpdate();

          const candles = await fetchCandles(symbol, tf, 300);
          const f = calcBaseFeatures(candles);

          const tfMin = tf.endsWith('m')
            ? Number(tf.replace('m', ''))
            : tf.endsWith('h')
            ? Number(tf.replace('h', '')) * 60
            : 15;

          const end = Date.now();
          const start = end - Math.max(tfMin, 15) * 60 * 1000;

          const trades = await fetchRecentTrades(symbol, start, end, 5000);
          const { cvdSeries, profile } = buildCVDandProfile(
            trades,
            tfMin * 60 * 1000,
            Math.max(0.5, f.last * 0.001),
          );

          const cvdNow = cvdSeries.at(-1)?.cvd ?? 0;
          const cvdUp = cvdSeries.length > 2 && cvdSeries.at(-1)!.cvd > cvdSeries.at(-2)!.cvd;
          const profileTop = profile
            .slice()
            .sort((a, b) => b.vol - a.vol)
            .slice(0, 3)
            .map((n) => `${n.price.toFixed(2)}(${n.vol.toFixed(0)})`)
            .join(', ');

          const decision = await decide(symbol, tf, f, cvdSeries, profile);
          const [rowSel1, rowSel2] = rowsSelects(symbol, tf);
          const menus = await coinSelectMenusDual();

          // 페이퍼 행도 같이 붙이기 (사용자 상태 기반)
          const acc = getAccount(i.user.id);
          const paperRows = [
            rowPaperButtons(acc.enabled),
            rowPaperMgmt(acc.enabled),
            ...rowPaperSelects(acc.orderAmountUSD, acc.leverage),
          ];

          await i.editReply({
            embeds: [buildEmbed(symbol, tf, f, decision, { cvdNow, cvdUp }, profileTop)],
            components: [rowsButtons(), rowSel1, rowSel2, ...menus, ...paperRows],
          });
        } else if (i.customId === BTN.LONG || i.customId === BTN.SHORT) {
          await i.reply({
            content: `⚠️ 본 봇은 실제 주문을 실행하지 않습니다. 선택: **${i.customId.toUpperCase()}**`,
            ephemeral: true,
          });
        }
        return;
      }

      /* ---------- 페이퍼 트레이딩: 셀렉트 ---------- */
      if (i.isStringSelectMenu() && Object.values(PAPER_SEL).includes(i.customId as any)) {
        const userId = i.user.id;
        if (i.customId === PAPER_SEL.AMOUNT) {
          const amt = Number(i.values[0]);
          const v = setPaperAmount(userId, amt);
          await i.reply({ content: `💵 주문 금액: $${v}`, ephemeral:true });
        } else if (i.customId === PAPER_SEL.LEV) {
          const lev = Number(i.values[0]);
          const v = setPaperLeverage(userId, lev);
          await i.reply({ content: `🧮 레버리지: ${v}x`, ephemeral:true });
        }
        return;
      }

      /* ---------- 기본 분석: 셀렉트 ---------- */
      if (i.isStringSelectMenu()) {
        let [symbol, tf] = (() => {
          const m = i.message.embeds?.[0]?.title?.match(/📊 (.+) · (.+) 신호/);
          return [m?.[1] || CONFIG.DEFAULT_SYMBOL, m?.[2] || CONFIG.DEFAULT_TF];
        })();

        if (i.customId === SEL.SYMBOL) symbol = i.values[0];
        if (i.customId === SEL.TF) tf = i.values[0];
        if (i.customId === SEL.TOP25 || i.customId === SEL.SCALP10) symbol = i.values[0];

        await i.deferUpdate();

        const candles = await fetchCandles(symbol, tf, 300);
        const f = calcBaseFeatures(candles);

        const tfMin = tf.endsWith('m')
          ? Number(tf.replace('m', ''))
          : tf.endsWith('h')
          ? Number(tf.replace('h', '')) * 60
          : 15;

        const end = Date.now();
        const start = end - Math.max(tfMin, 15) * 60 * 1000;

        const trades = await fetchRecentTrades(symbol, start, end, 5000);
        const { cvdSeries, profile } = buildCVDandProfile(
          trades,
          tfMin * 60 * 1000,
          Math.max(0.5, f.last * 0.001),
        );

        const cvdNow = cvdSeries.at(-1)?.cvd ?? 0;
        const cvdUp = cvdSeries.length > 2 && cvdSeries.at(-1)!.cvd > cvdSeries.at(-2)!.cvd;
        const profileTop = profile
          .slice()
          .sort((a, b) => b.vol - a.vol)
          .slice(0, 3)
          .map((n) => `${n.price.toFixed(2)}(${n.vol.toFixed(0)})`)
          .join(', ');

        const decision = await decide(symbol, tf, f, cvdSeries, profile);
        const [rowSel1, rowSel2] = rowsSelects(symbol, tf);
        const menus = await coinSelectMenusDual();

        // 페이퍼 행도 같이 갱신
        const acc = getAccount(i.user.id);
        const paperRows = [
          rowPaperButtons(acc.enabled),
          rowPaperMgmt(acc.enabled),
          ...rowPaperSelects(acc.orderAmountUSD, acc.leverage),
        ];

        await i.editReply({
          embeds: [buildEmbed(symbol, tf, f, decision, { cvdNow, cvdUp }, profileTop)],
          components: [rowsButtons(), rowSel1, rowSel2, ...menus, ...paperRows],
        });
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
