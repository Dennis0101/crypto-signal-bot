// src/paper/ranking.ts
import { EmbedBuilder, type Guild } from 'discord.js';
import { CONFIG } from '../config.js';
import { getAccount } from './store.js';

/**
 * 서버별(길드별) 참여자 인덱스 (메모리)
 * 구조: guildId -> Set<userId>
 */
const guildUsers = new Map<string, Set<string>>();

/** 서버 랭킹에 사용자 등록/업데이트 (어떤 상호작용이든 들어오면 호출) */
export function trackGuildUser(guildId: string | null | undefined, userId: string) {
  if (!guildId) return;
  if (!guildUsers.has(guildId)) guildUsers.set(guildId, new Set<string>());
  guildUsers.get(guildId)!.add(userId);
}

/** 해당 서버의 유저 목록 가져오기 */
export function getGuildUsers(guildId: string): string[] {
  return Array.from(guildUsers.get(guildId) ?? []);
}

/**
 * 서버별 수익률 랭킹 임베드 생성
 * - 기준: CONFIG.PAPER.DEFAULT_EQUITY_USD 대비 현재 equityUSD 변화율
 * - 현재 구조상 equityUSD는 실현 손익이 반영됨(미실현은 제외). 필요하면 향후 uPnL 합산 로직을 여기에 추가 가능.
 */
export function buildRankingEmbed(guild: Guild, topN = 10): EmbedBuilder {
  const defaultEq = CONFIG.PAPER.DEFAULT_EQUITY_USD;
  const users = getGuildUsers(guild.id);

  const rows = users
    .map(uid => {
      const acc = getAccount(uid); // 기존 시그니처 그대로 사용
      const equity = Number(acc?.equityUSD ?? defaultEq);
      const pnlUSD = equity - defaultEq;
      const pnlPct = (pnlUSD / defaultEq) * 100;
      return { uid, equity, pnlUSD, pnlPct };
    })
    .sort((a, b) => b.pnlPct - a.pnlPct);

  const top = rows.slice(0, Math.max(1, topN));

  const lines = top.length
    ? top.map((r, i) =>
        `${i + 1}위 ${r.pnlPct >= 0 ? '📈' : '📉'} <@${r.uid}>  ` +
        `${r.pnlPct.toFixed(2)}%  ·  Equity $${r.equity.toFixed(2)}  ` +
        `(PnL $${r.pnlUSD.toFixed(2)})`
      ).join('\n')
    : '아직 페이퍼 트레이딩 참여자가 없습니다. 먼저 거래를 시작해 주세요!';

  return new EmbedBuilder()
    .setTitle(`🏆 서버 랭킹 · ${guild.name}`)
    .setDescription(
      `기준자본: $${defaultEq.toLocaleString()} · 참가자 수: ${users.length}\n` +
      `정렬: 수익률(%) 내림차순`
    )
    .addFields({ name: '랭킹 Top ' + Math.min(topN, rows.length || 1), value: lines })
    .setColor(0xF59E0B); // amber
}
