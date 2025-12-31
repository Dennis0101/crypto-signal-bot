import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../http/middleware.js';
import { prisma, withRlsUser } from '../db/rls.js';

const UpdateRiskSchema = z.object({
  maxDailyLossUsd: z.coerce.number().min(0).max(1_000_000).optional(),
  maxOpenExposureUsd: z.coerce.number().min(0).max(10_000_000).optional(),
  maxConcurrentPositions: z.coerce.number().int().min(0).max(50).optional(),
});

const TradingEnabledSchema = z.object({
  tradingEnabled: z.coerce.boolean(),
});

export function createRouter() {
  const r = Router();
  r.use(requireAuth);

  r.get('/', async (req: AuthedRequest, res) => {
    const userId = req.userId!;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, tier: true, tierUntil: true, email: true, name: true, avatarUrl: true },
    });

    const risk = await withRlsUser(userId, async (tx) => {
      const existing = await tx.riskLimit.findUnique({ where: { userId } });
      if (existing) return existing;
      return await tx.riskLimit.create({ data: { userId } });
    });

    const keys = await withRlsUser(userId, (tx) =>
      tx.exchangeKey.findMany({
        orderBy: { createdAt: 'desc' },
        select: { id: true, exchange: true, label: true, apiKeyLast4: true, createdAt: true, lastUsedAt: true },
      })
    );

    res.json({
      user,
      risk: {
        tradingEnabled: risk.tradingEnabled,
        maxDailyLossUsd: risk.maxDailyLossUsd,
        maxOpenExposureUsd: risk.maxOpenExposureUsd,
        maxConcurrentPositions: risk.maxConcurrentPositions,
      },
      keys,
    });
  });

  r.put('/risk', async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const patch = UpdateRiskSchema.parse(req.body ?? {});

    const updated = await withRlsUser(userId, async (tx) => {
      const existing = await tx.riskLimit.findUnique({ where: { userId } });
      if (!existing) {
        return await tx.riskLimit.create({ data: { userId, ...patch } });
      }
      return await tx.riskLimit.update({ where: { userId }, data: patch });
    });

    res.json({
      risk: {
        tradingEnabled: updated.tradingEnabled,
        maxDailyLossUsd: updated.maxDailyLossUsd,
        maxOpenExposureUsd: updated.maxOpenExposureUsd,
        maxConcurrentPositions: updated.maxConcurrentPositions,
      },
    });
  });

  r.put('/trading', async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const body = TradingEnabledSchema.parse(req.body ?? {});

    if (body.tradingEnabled) {
      const keyCount = await withRlsUser(userId, (tx) => tx.exchangeKey.count());
      if (keyCount < 1) {
        return res.status(400).json({
          error: { code: 'MISSING_KEYS', message: 'Add an exchange key before enabling trading.' },
        });
      }
    }

    const updated = await withRlsUser(userId, async (tx) => {
      const existing = await tx.riskLimit.findUnique({ where: { userId } });
      if (!existing) {
        return await tx.riskLimit.create({ data: { userId, tradingEnabled: body.tradingEnabled } });
      }
      return await tx.riskLimit.update({ where: { userId }, data: { tradingEnabled: body.tradingEnabled } });
    });

    res.json({ tradingEnabled: updated.tradingEnabled });
  });

  return r;
}

