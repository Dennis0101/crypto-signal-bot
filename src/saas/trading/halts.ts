import { withRlsUser } from '../db/rls.js';

export async function isUserHalted(userId: string): Promise<{ halted: boolean; reasons: any[] }> {
  return await withRlsUser(userId, async (tx) => {
    const rows = await tx.tradingHalt.findMany({
      where: { clearedAt: null, OR: [{ scope: 'SYSTEM' }, { scope: 'USER', userId }] },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, scope: true, code: true, message: true, metaJson: true, createdAt: true },
    });
    return { halted: rows.length > 0, reasons: rows };
  });
}

export async function createUserHalt(userId: string, code: string, message: string, meta?: any) {
  return await withRlsUser(userId, async (tx) => {
    return await tx.tradingHalt.create({
      data: {
        scope: 'USER',
        userId,
        code,
        message,
        metaJson: meta ? JSON.stringify(meta) : null,
      },
      select: { id: true, code: true, message: true, createdAt: true },
    });
  });
}

