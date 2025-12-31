// src/paper/ranking.ts
import { EmbedBuilder } from 'discord.js';
import { CONFIG } from '../config.js';
import { getAccount } from './store.js';
/**
 * 서버별(길드별) 참여자 인덱스 (메모리)
 * 구조: guildId -> Set<userId>
 */
const guildUsers = new Map();
/** 서버 랭킹에 사용자 등록/업데이트 (어떤 상호작용이든 들어오면 호출) */
export function trackGuildUser(guildId, userId) {
    if (!guildId)
        return;
    if (!guildUsers.has(guildId))
        guildUsers.set(guildId, new Set());
    guildUsers.get(guildId).add(userId);
}
/** 해당 서버의 유저 목록 가져오기 */
export function getGuildUsers(guildId) {
    return Array.from(guildUsers.get(guildId) ?? []);
}
/**
 * 서버별 수익률 랭킹 임베드 생성
 * - 기준: CONFIG.PAPER.DEFAULT_EQUITY_USD 대비 현재 equityUSD 변화율
 * - 현재는 실현 손익 기준(equityUSD)으로만 랭킹을 만듭니다. (uPnL 포함이 필요하면 추후 확장)
 */
export function buildRankingEmbed(guild, topN = 10) {
    const defaultEq = CONFIG.PAPER.DEFAULT_EQUITY_USD;
    const users = getGuildUsers(guild.id);
    // 참가자 없으면 안내
    if (!users.length) {
        return new EmbedBuilder()
            .setTitle(`🏆 서버 랭킹 · ${guild.name}`)
            .setDescription(`기준자본: $${defaultEq.toLocaleString()} · 참가자 수: 0\n` +
            `아직 페이퍼 트레이딩 참여자가 없습니다. 먼저 거래를 시작해 주세요!`)
            .setColor(0xF59E0B);
    }
    const rows = users
        .map((uid) => {
        // 🔧 변경: 서버별 저장소 기준이므로 guild.id와 uid를 함께 전달
        const acc = getAccount(guild.id, uid);
        const equity = Number(acc?.equityUSD ?? defaultEq);
        const pnlUSD = equity - defaultEq;
        const pnlPct = (pnlUSD / defaultEq) * 100;
        return { uid, equity, pnlUSD, pnlPct };
    })
        .sort((a, b) => b.pnlPct - a.pnlPct);
    const top = rows.slice(0, Math.max(1, topN));
    const lines = top
        .map((r, i) => `${i + 1}위 ${r.pnlPct >= 0 ? '📈' : '📉'} <@${r.uid}>  ` +
        `${r.pnlPct.toFixed(2)}%  ·  Equity $${r.equity.toFixed(2)}  ` +
        `(PnL $${r.pnlUSD.toFixed(2)})`)
        .join('\n');
    return new EmbedBuilder()
        .setTitle(`🏆 서버 랭킹 · ${guild.name}`)
        .setDescription(`기준자본: $${defaultEq.toLocaleString()} · 참가자 수: ${users.length}\n` +
        `정렬: 수익률(%) 내림차순`)
        .addFields({
        name: `랭킹 Top ${Math.min(topN, rows.length)}`,
        value: lines || '데이터가 없습니다.',
    })
        .setColor(0xF59E0B);
}
