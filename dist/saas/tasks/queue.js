import { withRlsUser } from '../db/rls.js';
export async function enqueueTask(userId, type, payload) {
    return await withRlsUser(userId, async (tx) => {
        const task = await tx.executionTask.create({
            data: {
                userId,
                type,
                status: 'PENDING',
                payloadJson: JSON.stringify(payload ?? {}),
            },
            select: { id: true, type: true, status: true, createdAt: true },
        });
        return task;
    });
}
export async function listTasks(userId, limit = 50) {
    return await withRlsUser(userId, async (tx) => {
        return await tx.executionTask.findMany({
            orderBy: { createdAt: 'desc' },
            take: Math.max(1, Math.min(200, limit)),
            select: {
                id: true,
                type: true,
                status: true,
                attempts: true,
                leasedUntil: true,
                createdAt: true,
                updatedAt: true,
                lastError: true,
                resultJson: true,
            },
        });
    });
}
