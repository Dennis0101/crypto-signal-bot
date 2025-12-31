// src/router.ts
import { PermissionsBitField, ChannelType, } from 'discord.js';
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
import { PAPER_BTN, PAPER_SEL, rowPaperButtons, rowPaperMgmt, rowPaperSelects } from './ui/components.js';
import { getAccount } from './paper/store.js';
import { placePaperOrder, closePaperPosition, flipPaperPosition, setPaperAmount, setPaperLeverage, toggleCurrency, toggleEnabled, resetPaper } from './paper/service.js';
import { buildPortfolioEmbed } from './paper/ui.js';
// 🏆 랭킹
import { buildRankingEmbed, trackGuildUser } from './paper/ranking.js';
export function initRouter(client) {
    /* ========== 텍스트 명령어 ========== */
    client.on('messageCreate', async (msg) => {
        if (msg.author.bot)
            return;
        // 🏆 서버 랭킹
        if (msg.content.trim() === '!랭킹') {
            if (!msg.guild) {
                await msg.reply('❌ 서버(길드) 내에서만 사용할 수 있습니다.');
                return;
            }
            trackGuildUser(msg.guild.id, msg.author.id);
            const embed = buildRankingEmbed(msg.guild, 10);
            await msg.reply({ embeds: [embed] });
            return;
        }
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
                const channel = msg.channel;
                let totalDeleted = 0;
                while (true) {
                    const fetched = await channel.messages.fetch({ limit: 100 });
                    if (fetched.size === 0)
                        break;
                    const deleted = await channel.bulkDelete(fetched, true);
                    totalDeleted += deleted.size;
                    if (fetched.size < 100)
                        break;
                }
                await channel.send(`✅ ${totalDeleted}개의 메시지를 삭제했습니다. (최근 메시지만 삭제 가능)`);
            }
            catch (e) {
                console.error('채널메세지비우기 오류:', e);
                if (msg.channel.type === ChannelType.GuildText) {
                    await msg.channel.send('⚠️ 메시지 삭제 중 오류가 발생했습니다.');
                }
                else {
                    await msg.reply('⚠️ 메시지 삭제 중 오류가 발생했습니다.');
                }
            }
            return;
        }
        // !코인
        if (!msg.content.startsWith('!코인'))
            return;
        if (msg.guild)
            trackGuildUser(msg.guild.id, msg.author.id);
        const parts = msg.content.trim().split(/\s+/);
        const symbol = parts[1] || CONFIG.DEFAULT_SYMBOL;
        const tf = parts[2] || CONFIG.DEFAULT_TF;
        await handleCoinCommand(msg, symbol, tf); // 메인 메시지(5행 제한 내)
        await handleCoinRoot(msg); // 랭킹 드롭다운 보조 메시지
    });
    /* ========== 상호작용(버튼/셀렉트) ========== */
    client.on('interactionCreate', async (i) => {
        try {
            // 모든 상호작용 → 서버 참여자 기록
            if (i.guildId && i.user?.id)
                trackGuildUser(i.guildId, i.user.id);
            /* ----- 기본 분석 버튼 ----- */
            if (i.isButton() && (i.customId === BTN.ANALYZE || i.customId === BTN.REFRESH)) {
                const m = i.message.embeds?.[0]?.title?.match(/📊 (.+) · (.+) 신호/);
                const symbol = (m?.[1] || CONFIG.DEFAULT_SYMBOL);
                const tf = (m?.[2] || CONFIG.DEFAULT_TF);
                await i.deferUpdate();
                const candles = await fetchCandles(symbol, tf, 300);
                const f = calcBaseFeatures(candles);
                const tfMin = tf.endsWith('m') ? Number(tf.replace('m', ''))
                    : tf.endsWith('h') ? Number(tf.replace('h', '')) * 60 : 15;
                const end = Date.now();
                const start = end - Math.max(tfMin, 15) * 60 * 1000;
                const trades = await fetchRecentTrades(symbol, start, end, 5000);
                const { cvdSeries, profile } = buildCVDandProfile(trades, tfMin * 60 * 1000, Math.max(0.5, f.last * 0.001));
                const decision = await decide(symbol, tf, f, cvdSeries, profile);
                const cvdNow = cvdSeries.at(-1)?.cvd ?? 0;
                const cvdUp = cvdSeries.length > 2 && cvdSeries.at(-1).cvd > cvdSeries.at(-2).cvd;
                const profileTop = profile.slice().sort((a, b) => b.vol - a.vol).slice(0, 3)
                    .map(n => `${n.price.toFixed(2)}(${n.vol.toFixed(0)})`).join(', ');
                const [rowSel1, rowSel2] = rowsSelects(symbol, tf);
                const acc = getAccount(i.guildId ?? 'global', i.user.id);
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
            if (i.isButton() && Object.values(PAPER_BTN).includes(i.customId)) {
                const m = i.message.embeds?.[0]?.title?.match(/📊 (.+) · (.+) 신호/);
                const symbol = (m?.[1] || CONFIG.DEFAULT_SYMBOL);
                const userId = i.user.id;
                const guildId = i.guildId ?? 'global';
                try {
                    switch (i.customId) {
                        case PAPER_BTN.TOGGLE: {
                            // 상태 토글
                            const on = toggleEnabled(guildId, userId);
                            // 현재 심볼/TF 파싱해서 선택행 복구
                            const { symbol: sym, tf } = (() => {
                                const mm = i.message.embeds?.[0]?.title?.match(/📊 (.+) · (.+) 신호/);
                                return {
                                    symbol: (mm?.[1] || CONFIG.DEFAULT_SYMBOL),
                                    tf: (mm?.[2] || CONFIG.DEFAULT_TF),
                                };
                            })();
                            const [rowSel1, rowSel2] = rowsSelects(sym, tf);
                            // ✅ 원본 메시지 버튼행 즉시 교체
                            await i.update({
                                components: [
                                    rowsButtons(),
                                    rowSel1,
                                    rowSel2,
                                    rowPaperButtons(on),
                                    rowPaperMgmt(on),
                                ],
                            });
                            // 안내는 에페메럴로
                            await i.followUp({
                                content: `🧪 Paper Trading: ${on ? 'ON' : 'OFF'}`,
                                ephemeral: true,
                            });
                            break;
                        }
                        case PAPER_BTN.LONG: {
                            const { price, qty, lev } = await placePaperOrder(guildId, userId, symbol, 'LONG');
                            const e = await buildPortfolioEmbed(guildId, userId);
                            await i.reply({
                                content: `✅ LONG 체결 • ${symbol} @ ${price.toFixed(4)} · qty ${qty.toFixed(4)} · ${lev}x`,
                                embeds: [e], ephemeral: true
                            });
                            break;
                        }
                        case PAPER_BTN.SHORT: {
                            const { price, qty, lev } = await placePaperOrder(guildId, userId, symbol, 'SHORT');
                            const e = await buildPortfolioEmbed(guildId, userId);
                            await i.reply({
                                content: `✅ SHORT 체결 • ${symbol} @ ${price.toFixed(4)} · qty ${qty.toFixed(4)} · ${lev}x`,
                                embeds: [e], ephemeral: true
                            });
                            break;
                        }
                        case PAPER_BTN.CLOSE: {
                            const { price, pnl } = await closePaperPosition(guildId, userId, symbol);
                            const e = await buildPortfolioEmbed(guildId, userId);
                            await i.reply({
                                content: `🔚 포지션 청산 • ${symbol} @ ${price.toFixed(4)} · PnL ${pnl.toFixed(2)} USD`,
                                embeds: [e], ephemeral: true
                            });
                            break;
                        }
                        case PAPER_BTN.FLIP: {
                            await flipPaperPosition(guildId, userId, symbol);
                            const e = await buildPortfolioEmbed(guildId, userId);
                            await i.reply({ content: `🔁 포지션 뒤집기 완료`, embeds: [e], ephemeral: true });
                            break;
                        }
                        case PAPER_BTN.RESET: {
                            resetPaper(guildId, userId);
                            await i.reply({ content: `🧹 가상선물 초기화 완료`, ephemeral: true });
                            break;
                        }
                        case PAPER_BTN.PORT: {
                            const e = await buildPortfolioEmbed(guildId, userId);
                            const acc = getAccount(guildId, userId);
                            await i.reply({
                                embeds: [e],
                                components: [
                                    rowPaperButtons(acc.enabled),
                                    rowPaperMgmt(acc.enabled),
                                    ...rowPaperSelects(acc.orderAmountUSD, acc.leverage), // 금액/레버리지 조정
                                ],
                                ephemeral: true,
                            });
                            break;
                        }
                        case PAPER_BTN.CURR: {
                            const curr = toggleCurrency(guildId, userId);
                            await i.reply({ content: `통화: ${curr}`, ephemeral: true });
                            break;
                        }
                    }
                }
                catch (e) {
                    await i.reply({ content: `⚠️ ${e?.message || '오류'}`, ephemeral: true });
                }
                return;
            }
            /* ----- 셀렉트(심볼/TF/랭킹/페이퍼설정) ----- */
            if (i.isStringSelectMenu()) {
                // 페이퍼 설정(금액/레버리지) 셀렉트는 에페메럴로 처리
                if (i.customId === PAPER_SEL.AMOUNT || i.customId === PAPER_SEL.LEV) {
                    const guildId = i.guildId ?? 'global';
                    const userId = i.user.id;
                    try {
                        if (i.customId === PAPER_SEL.AMOUNT) {
                            const v = Number(i.values[0]);
                            setPaperAmount(guildId, userId, v);
                        }
                        else {
                            const v = Number(i.values[0]);
                            setPaperLeverage(guildId, userId, v);
                        }
                        const acc = getAccount(guildId, userId);
                        const e = await buildPortfolioEmbed(guildId, userId);
                        await i.reply({
                            content: `✅ 설정 반영됨`,
                            embeds: [e],
                            components: [
                                rowPaperButtons(acc.enabled),
                                rowPaperMgmt(acc.enabled),
                                ...rowPaperSelects(acc.orderAmountUSD, acc.leverage),
                            ],
                            ephemeral: true,
                        });
                    }
                    catch (e) {
                        await i.reply({ content: `⚠️ ${e?.message || '오류'}`, ephemeral: true });
                    }
                    return;
                }
                // 메인 분석 심볼/TF/랭킹 셀렉트
                let [symbol, tf] = (() => {
                    const m = i.message.embeds?.[0]?.title?.match(/📊 (.+) · (.+) 신호/);
                    return [m?.[1] || CONFIG.DEFAULT_SYMBOL, m?.[2] || CONFIG.DEFAULT_TF];
                })();
                if (i.customId === SEL.SYMBOL)
                    symbol = i.values[0];
                if (i.customId === SEL.TF)
                    tf = i.values[0];
                if (SEL.TOP25 && i.customId === SEL.TOP25)
                    symbol = i.values[0];
                if (SEL.SCALP10 && i.customId === SEL.SCALP10)
                    symbol = i.values[0];
                await i.deferUpdate();
                const candles = await fetchCandles(symbol, tf, 300);
                const f = calcBaseFeatures(candles);
                const tfMin = tf.endsWith('m') ? Number(tf.replace('m', ''))
                    : tf.endsWith('h') ? Number(tf.replace('h', '')) * 60 : 15;
                const end = Date.now();
                const start = end - Math.max(tfMin, 15) * 60 * 1000;
                const trades = await fetchRecentTrades(symbol, start, end, 5000);
                const { cvdSeries, profile } = buildCVDandProfile(trades, tfMin * 60 * 1000, Math.max(0.5, f.last * 0.001));
                const decision = await decide(symbol, tf, f, cvdSeries, profile);
                const cvdNow = cvdSeries.at(-1)?.cvd ?? 0;
                const cvdUp = cvdSeries.length > 2 && cvdSeries.at(-1).cvd > cvdSeries.at(-2).cvd;
                const profileTop = profile.slice().sort((a, b) => b.vol - a.vol).slice(0, 3)
                    .map(n => `${n.price.toFixed(2)}(${n.vol.toFixed(0)})`).join(', ');
                const [rowSel1, rowSel2] = rowsSelects(symbol, tf);
                const acc = getAccount(i.guildId ?? 'global', i.user.id);
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
        }
        catch (e) {
            console.error('Router error:', e);
            if (i.isRepliable()) {
                if (i.deferred || i.replied) {
                    await i.editReply({ content: '오류가 발생했습니다.', components: [] });
                }
                else {
                    await i.reply({ content: '오류가 발생했습니다.', ephemeral: true });
                }
            }
        }
    });
}
