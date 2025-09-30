// src/router.ts
import {
  Client, Message, TextChannel, PermissionsBitField, ChannelType,
} from 'discord.js';
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
import { BTN, SEL, rowsButtons, rowsSelects } from './ui/components.js';

// Paper Trading UI & 서비스
import {
  PAPER_BTN, rowPaperButtons, rowPaperMgmt,
} from './ui/components.js';
import { getAccount } from './paper/store.js';
import {
  placePaperOrder, closePaperPosition, flipPaperPosition,
  toggleCurrency, toggleEnabled, resetPaper,
} from './paper/service.js';
import { buildPortfolioEmbed } from './paper/ui.js';

function gidOrDM(guildId?: string | null) {
  return guildId ?? 'dm';
}

export function initRouter(client: Client) {
  /* ========== 텍스트 명령어 ========== */
  client.on('messageCreate', async (msg: Message) => {
    if (msg.author.bot) return;

    // 🧹 채널 메시지 비우기
    if (msg.content.trim() === '!채널메세지비우기') {
      try {
        const member = msg.member;
        if (!member?.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
          await msg.reply('❌ 메세지 관리 권한이 없습니다.');
          return;
        }
        if (msg.channel.type !== ChannelType.GuildText) {
          await msg.reply('❌ 텍스트 채널에서만 사용 가능합니다.');
          return;
        }

        const channel = msg.channel as TextChannel;
        let totalDeleted = 0;
        while (true) {
          const fetched = await channel.messages.fetch({ limit: 100 });
          if (fetched.size === 0) break;
          const deleted = await channel.bulkDelete(fetched, true);
          totalDeleted += deleted.size;
          if (fetched.size < 100) break;
        }
        await channel.send(`✅ ${totalDeleted}개의 메시지를 삭제했습니다. (최근 메시지만 삭제 가능)`);
      } catch (e) {
        console.error('채널메세지비우기 오류:', e);
        if (msg.channel.type === ChannelType.GuildText) {
          await (msg.channel as TextChannel).send('⚠️ 메시지 삭제 중 오류가 발생했습니다.');
        } else {
          await msg.reply('⚠️ 메시지 삭제 중 오류가 발생했습니다.');
        }
      }
      return;
    }

    if (!msg.content.startsWith('!코인')) return;

    const parts = msg.content.trim().split(/\s+/);
    const symbol = parts[1] || CONFIG.DEFAULT_SYMBOL;
    const tf = parts[2] || CONFIG.DEFAULT_TF;

    await handleCoinCommand(msg, symbol, tf);
    await handleCoinRoot(msg);
  });

  /* ========== 상호작용(버튼/셀렉트) ========== */
  client.on('interactionCreate', async (i) => {
    try {
      /* ----- 기본 분석 버튼 ----- */
      if (i.isButton() && (i.customId === BTN.ANALYZE || i.customId === BTN.REFRESH)) {
        const m = i.message.embeds?.[0]?.title?.match(/📊 (.+) · (.+) 신호/);
        const symbol = m?.[1] || CONFIG.DEFAULT_SYMBOL;
        const tf = m?.[2] || CONFIG.DEFAULT_TF;

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

        const decision = await decide(symbol, tf, f, cvdSeries, profile);
        const cvdNow = cvdSeries.at(-1)?.cvd ?? 0;
        const cvdUp = cvdSeries.length > 2 && cvdSeries.at(-1)!.cvd > cvdSeries.at(-2)!.cvd;
        const profileTop = profile
          .slice()
          .sort((a, b) => b.vol - a.vol)
          .slice(0, 3)
          .map((n) => `${n.price.toFixed(2)}(${n.vol.toFixed(0)})`)
          .join(', ');

        const [rowSel1, rowSel2] = rowsSelects(symbol, tf);
        const acc = getAccount(gidOrDM(i.guildId), i.user.id);

        await i.editReply({
          embeds: [buildEmbed(symbol, tf, f, decision, { cvdNow, cvdUp }, profileTop)],
          components: [
            rowsButtons(),
            rowSel1,
            rowSel2,
            rowPaperButtons(acc.enabled),
            rowPaperMgmt(acc.enabled),
          ],
        });
        return;
      }

      /* ----- Paper 버튼 ----- */
      if (i.isButton() && (Object.values(PAPER_BTN) as string[]).includes(i.customId)) {
        const m = i.message.embeds?.[0]?.title?.match(/📊 (.+) · (.+) 신호/);
        const symbol = m?.[1] || CONFIG.DEFAULT_SYMBOL;
        const gid = gidOrDM(i.guildId);
        const uid = i.user.id;

        try {
          switch (i.customId) {
            case PAPER_BTN.TOGGLE: {
              const on = toggleEnabled(gid, uid);
              await i.reply({ content: `🧪 Paper Trading: ${on ? 'ON' : 'OFF'}`, ephemeral: true });
              break;
            }
            case PAPER_BTN.LONG: {
              const { price, qty, lev } = await placePaperOrder(gid, uid, symbol, 'LONG');
              const e = await buildPortfolioEmbed(gid, uid);
              await i.reply({
                content: `✅ LONG 체결 • ${symbol} @ ${price.toFixed(4)} · qty ${qty.toFixed(4)} · ${lev}x`,
                embeds: [e],
                ephemeral: true,
              });
              break;
            }
            case PAPER_BTN.SHORT: {
              const { price, qty, lev } = await placePaperOrder(gid, uid, symbol, 'SHORT');
              const e = await buildPortfolioEmbed(gid, uid);
              await i.reply({
                content: `✅ SHORT 체결 • ${symbol} @ ${price.toFixed(4)} · qty ${qty.toFixed(4)} · ${lev}x`,
                embeds: [e],
                ephemeral: true,
              });
              break;
            }
            case PAPER_BTN.CLOSE: {
              const { price, pnl } = await closePaperPosition(gid, uid, symbol);
              const e = await buildPortfolioEmbed(gid, uid);
              await i.reply({
                content: `🔚 포지션 청산 • ${symbol} @ ${price.toFixed(4)} · PnL ${pnl.toFixed(2)} USD`,
                embeds: [e],
                ephemeral: true,
              });
              break;
            }
            case PAPER_BTN.FLIP: {
              await flipPaperPosition(gid, uid, symbol);
              const e = await buildPortfolioEmbed(gid, uid);
              await i.reply({ content: `🔁 포지션 뒤집기 완료`, embeds: [e], ephemeral: true });
              break;
            }
            case PAPER_BTN.RESET: {
              resetPaper(gid, uid);
              await i.reply({ content: `🧹 가상선물 초기화 완료`, ephemeral: true });
              break;
            }
            case PAPER_BTN.PORT: {
              const e = await buildPortfolioEmbed(gid, uid);
              const acc = getAccount(gid, uid);
              await i.reply({
                embeds: [e],
                components: [rowPaperButtons(acc.enabled), rowPaperMgmt(acc.enabled)],
                ephemeral: true,
              });
              break;
            }
            case PAPER_BTN.CURR: {
              const curr = toggleCurrency(gid, uid);
              await i.reply({ content: `통화: ${curr}`, ephemeral: true });
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
        if (i.customId === SEL.TF) tf = i.values[0];
        if ((SEL as any).TOP25 && i.customId === (SEL as any).TOP25) symbol = i.values[0];
        if ((SEL as any).SCALP10 && i.customId === (SEL as any).SCALP10) symbol = i.values[0];

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
        const decision = await decide(symbol, tf, f, cvdSeries, profile);

        const cvdNow = cvdSeries.at(-1)?.cvd ?? 0;
        const cvdUp = cvdSeries.length > 2 && cvdSeries.at(-1)!.cvd > cvdSeries.at(-2)!.cvd;
        const profileTop = profile
          .slice()
          .sort((a, b) => b.vol - a.vol)
          .slice(0, 3)
          .map((n) => `${n.price.toFixed(2)}(${n.vol.toFixed(0)})`)
          .join(', ');

        const [rowSel1, rowSel2] = rowsSelects(symbol, tf);
        const acc = getAccount(gidOrDM(i.guildId), i.user.id);

        await i.editReply({
          embeds: [buildEmbed(symbol, tf, f, decision, { cvdNow, cvdUp }, profileTop)],
          components: [
            rowsButtons(),
            rowSel1,
            rowSel2,
            rowPaperButtons(acc.enabled),
            rowPaperMgmt(acc.enabled),
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
