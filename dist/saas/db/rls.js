import { prisma } from './prisma.js';
/**
 * Execute a function with Postgres RLS user context set for the transaction.
 * RLS policies rely on `current_setting('app.user_id', true)`.
 */
export async function withRlsUser(userId, fn) {
    return await prisma.$transaction(async (tx) => {
        // Set local (transaction-scoped) GUC for RLS policies.
        await tx.$executeRaw `SELECT set_config('app.user_id', ${userId}, true)`;
        return await fn(tx);
    });
}
/**
 * For server-only queries (auth tables) where RLS is intentionally not applied.
 */
export { prisma };
