import { ClientSecretPost, authorizationCodeGrant, buildAuthorizationUrl, calculatePKCECodeChallenge, discovery, fetchUserInfo, randomPKCECodeVerifier, randomState, skipSubjectCheck, } from 'openid-client';
import { SignJWT, decodeJwt, importPKCS8 } from 'jose';
function required(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing env ${name}`);
    return v;
}
let googleConfigP = null;
let appleConfigP = null;
async function appleClientSecret() {
    // Production: generate on the server from Apple p8 key.
    // Env options:
    // - APPLE_PRIVATE_KEY_P8 (literal PEM including BEGIN/END lines)
    // - or APPLE_PRIVATE_KEY_B64 (base64 of PEM)
    const teamId = required('APPLE_TEAM_ID');
    const clientId = required('APPLE_CLIENT_ID');
    const keyId = required('APPLE_KEY_ID');
    const now = Math.floor(Date.now() / 1000);
    const pem = process.env.APPLE_PRIVATE_KEY_P8 ||
        (process.env.APPLE_PRIVATE_KEY_B64
            ? Buffer.from(process.env.APPLE_PRIVATE_KEY_B64, 'base64').toString('utf8')
            : '');
    if (!pem)
        throw new Error('Missing APPLE_PRIVATE_KEY_P8 or APPLE_PRIVATE_KEY_B64');
    const key = await importPKCS8(pem, 'ES256');
    return await new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: keyId })
        .setIssuer(teamId)
        .setSubject(clientId)
        .setAudience('https://appleid.apple.com')
        .setIssuedAt(now)
        .setExpirationTime(now + 60 * 60 * 24 * 30) // 30 days
        .sign(key);
}
async function getConfig(provider) {
    if (provider === 'google') {
        const issuer = process.env.GOOGLE_ISSUER || 'https://accounts.google.com';
        const clientId = required('GOOGLE_CLIENT_ID');
        const clientSecret = required('GOOGLE_CLIENT_SECRET');
        const redirectUri = required('GOOGLE_REDIRECT_URI');
        googleConfigP ??= discovery(new URL(issuer), clientId, { client_secret: clientSecret, redirect_uris: [redirectUri], response_types: ['code'] }, ClientSecretPost(clientSecret));
        return { config: await googleConfigP, redirectUri };
    }
    const issuer = process.env.APPLE_ISSUER || 'https://appleid.apple.com';
    const clientId = required('APPLE_CLIENT_ID');
    const redirectUri = required('APPLE_REDIRECT_URI');
    const clientSecret = await appleClientSecret();
    // Apple client secret is a JWT; we regenerate it as needed (cached config still ok).
    appleConfigP ??= discovery(new URL(issuer), clientId, { client_secret: clientSecret, redirect_uris: [redirectUri], response_types: ['code'] }, ClientSecretPost(clientSecret));
    return { config: await appleConfigP, redirectUri };
}
export async function oidcStart(provider) {
    const { config, redirectUri } = await getConfig(provider);
    const codeVerifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
    const state = randomState();
    const authorizationUrl = buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    });
    return { authorizationUrl: authorizationUrl.toString(), state, codeVerifier };
}
export async function oidcCallback(args) {
    const { config, redirectUri } = await getConfig(args.provider);
    const tokenSet = await authorizationCodeGrant(config, args.currentUrl, { expectedState: args.expectedState, pkceCodeVerifier: args.codeVerifier }, { redirect_uri: redirectUri });
    const idToken = typeof tokenSet?.id_token === 'string' ? tokenSet.id_token : '';
    const claims = idToken ? decodeJwt(idToken) : {};
    const sub = String(claims?.sub ?? '');
    let email = claims?.email;
    let name = claims?.name;
    let picture = claims?.picture;
    // Google: userinfo is richer and more reliable than id_token.
    if (args.provider === 'google' && typeof tokenSet?.access_token === 'string') {
        try {
            const ui = await fetchUserInfo(config, tokenSet.access_token, sub || skipSubjectCheck);
            email = ui?.email ?? email;
            name = ui?.name ?? name;
            picture = ui?.picture ?? picture;
        }
        catch {
            // ignore, fallback to id_token
        }
    }
    if (!sub)
        throw new Error('Missing provider account id (sub)');
    return { email, name, picture, providerAccountId: sub };
}
