import crypto from 'node:crypto';
/**
 * AES-256-GCM envelope for short secrets (API keys, passphrases).
 *
 * Security invariants:
 * - Secrets are encrypted at rest.
 * - Decryption happens only in-memory and only at execution time.
 * - Callers must ensure decrypted values are never logged.
 *
 * Encoding format:
 *   base64(iv) + "." + base64(tag) + "." + base64(ciphertext)
 */
const MASTER_KEY_ENV = 'KEY_ENC_MASTER_B64';
function getMasterKey() {
    const b64 = process.env[MASTER_KEY_ENV];
    if (!b64) {
        throw new Error(`Missing ${MASTER_KEY_ENV}. Generate 32 random bytes, base64-encode, and set it in env.`);
    }
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) {
        throw new Error(`${MASTER_KEY_ENV} must be 32 bytes (base64 of 32 raw bytes).`);
    }
    return key;
}
export function encryptSecret(plaintext) {
    const key = getMasterKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}
export function decryptSecret(payload) {
    const key = getMasterKey();
    const parts = payload.split('.');
    if (parts.length !== 3)
        throw new Error('Invalid secret payload format.');
    const [ivB64, tagB64, ctB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    return plaintext;
}
export function sha256Hex(input) {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}
