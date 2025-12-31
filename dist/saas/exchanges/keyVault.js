import { withRlsUser } from '../db/rls.js';
import { decryptSecret } from '../crypto/secretbox.js';
export async function loadBitgetCreds(userId) {
    return await withRlsUser(userId, async (tx) => {
        const k = await tx.exchangeKey.findFirst({
            where: { exchange: 'BITGET' },
            orderBy: { createdAt: 'desc' },
            select: { id: true, apiKeyLast4: true, encApiKey: true, encApiSecret: true, encPassphrase: true },
        });
        if (!k)
            throw new Error('No Bitget key found');
        const apiKey = decryptSecret(k.encApiKey);
        const apiSecret = decryptSecret(k.encApiSecret);
        const passphrase = k.encPassphrase ? decryptSecret(k.encPassphrase) : undefined;
        await tx.exchangeKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } });
        return { keyId: k.id, apiKeyLast4: k.apiKeyLast4, apiKey, apiSecret, passphrase };
    });
}
