import { prisma } from './db/prisma.js';
import { logger } from '../utils/logger.js';

/**
 * DB-backed worker (restart-safe):
 * - Leases PENDING tasks
 * - Executes deterministically
 * - Records resultJson / lastError
 *
 * NOTE: Do not run this in the frontend. Run as separate process/container.
 */

const LEASE_MS = 30_000;
const LOOP_DELAY_MS = 1_000;

async function leaseOne() {
  const now = new Date();
  const leasedUntil = new Date(Date.now() + LEASE_MS);

  // Best-effort: find one available task and lease it.
  // In production, use SKIP LOCKED and a single UPDATE ... RETURNING.
  const t = await prisma.executionTask.findFirst({
    where: {
      status: 'PENDING',
      OR: [{ leasedUntil: null }, { leasedUntil: { lt: now } }],
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!t) return null;

  const updated = await prisma.executionTask.updateMany({
    where: {
      id: t.id,
      status: 'PENDING',
      OR: [{ leasedUntil: null }, { leasedUntil: { lt: now } }],
    },
    data: { status: 'RUNNING', leasedUntil, attempts: { increment: 1 } },
  });
  if (updated.count !== 1) return null;
  return await prisma.executionTask.findUnique({ where: { id: t.id } });
}

async function runTask(task: any) {
  // For now, we intentionally fail closed unless live trading is explicitly enabled.
  if (task.type.startsWith('LIVE_')) {
    const enabled = String(process.env.LIVE_TRADING_ENABLED || '').toLowerCase() === 'true';
    if (!enabled) {
      throw new Error('LIVE_TRADING_ENABLED is not true. Live execution is disabled by default.');
    }
    throw new Error('Live execution engine not wired yet (safety-first).');
  }
  throw new Error(`Unknown task type: ${task.type}`);
}

export async function main() {
  logger.info('Worker started');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const task = await leaseOne();
    if (!task) {
      await new Promise((r) => setTimeout(r, LOOP_DELAY_MS));
      continue;
    }
    try {
      const result = await runTask(task);
      await prisma.executionTask.update({
        where: { id: task.id },
        data: { status: 'SUCCEEDED', leasedUntil: null, resultJson: JSON.stringify(result ?? {}) },
      });
    } catch (e: any) {
      await prisma.executionTask.update({
        where: { id: task.id },
        data: { status: 'FAILED', leasedUntil: null, lastError: String(e?.message ?? e) },
      });
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    // Avoid leaking secrets
    logger.error({ err: String(e?.message ?? e) }, 'Worker crashed');
    process.exit(1);
  });
}

