import { prisma } from '../db/rls.js';

export type Tier = 'BASIC' | 'PRO' | 'VIP';

type CacheEntry = { tier: Tier; at: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 30_000;

export async function getUserTier(userId: string): Promise<Tier> {
  const now = Date.now();
  const c = cache.get(userId);
  if (c && now - c.at < TTL_MS) return c.tier;

  const u = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } });
  const tier = (u?.tier as Tier) || 'BASIC';
  cache.set(userId, { tier, at: now });
  return tier;
}

export function tierRank(t: Tier): number {
  switch (t) {
    case 'VIP':
      return 3;
    case 'PRO':
      return 2;
    default:
      return 1;
  }
}

export function requireTier(current: Tier, required: Tier): { ok: true } | { ok: false; message: string } {
  if (tierRank(current) >= tierRank(required)) return { ok: true };
  return { ok: false, message: `Requires ${required} plan.` };
}

