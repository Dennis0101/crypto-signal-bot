import crypto from 'node:crypto';
function signBase64(secret, prehash) {
    return crypto.createHmac('sha256', secret).update(prehash).digest('base64');
}
async function bitgetRequest(args) {
    const baseUrl = args.baseUrl.replace(/\/+$/, '');
    const url = new URL(baseUrl + args.path);
    if (args.query) {
        for (const [k, v] of Object.entries(args.query)) {
            if (v === undefined)
                continue;
            url.searchParams.set(k, String(v));
        }
    }
    const ts = Date.now().toString();
    const bodyStr = args.body ? JSON.stringify(args.body) : '';
    const pathWithQuery = url.pathname + (url.search ? url.search : '');
    const prehash = ts + args.method + pathWithQuery + bodyStr;
    const sign = signBase64(args.creds.apiSecret, prehash);
    const res = await fetch(url, {
        method: args.method,
        headers: {
            'content-type': 'application/json',
            'ACCESS-KEY': args.creds.apiKey,
            'ACCESS-SIGN': sign,
            'ACCESS-TIMESTAMP': ts,
            'ACCESS-PASSPHRASE': args.creds.passphrase || '',
            locale: 'en-US',
        },
        body: args.method === 'POST' ? bodyStr : undefined,
    });
    const txt = await res.text();
    let json;
    try {
        json = JSON.parse(txt);
    }
    catch {
        throw new Error(`Bitget non-JSON response: HTTP ${res.status} ${txt.slice(0, 200)}`);
    }
    if (!res.ok) {
        throw new Error(`Bitget HTTP ${res.status}: ${json?.msg || txt}`);
    }
    if (json?.code && json.code !== '00000') {
        throw new Error(`Bitget error ${json.code}: ${json.msg || 'unknown'}`);
    }
    return json?.data;
}
export async function bitgetGetContracts(baseUrl) {
    // Public endpoint; used for sizing sanity checks.
    const url = new URL('/api/v2/mix/market/contracts', baseUrl);
    url.searchParams.set('productType', 'usdt-futures');
    const res = await fetch(url);
    const j = await res.json();
    if (!res.ok || j?.code !== '00000')
        throw new Error(`contracts failed: ${j?.msg || res.statusText}`);
    return j.data;
}
export async function bitgetPrivateAccountOverview(baseUrl, creds) {
    // Private "read" endpoint to verify credentials without trading.
    // This endpoint exists and returns "Invalid ACCESS_KEY" if headers are missing.
    return await bitgetRequest({
        baseUrl,
        creds,
        method: 'GET',
        path: '/api/v2/mix/account/account',
        query: { productType: 'usdt-futures' },
    });
}
export async function bitgetPrivateAccounts(baseUrl, creds) {
    return await bitgetRequest({
        baseUrl,
        creds,
        method: 'GET',
        path: '/api/v2/mix/account/accounts',
        query: { productType: 'usdt-futures' },
    });
}
export async function bitgetSetMarginMode(baseUrl, creds, args) {
    return await bitgetRequest({
        baseUrl,
        creds,
        method: 'POST',
        path: '/api/v2/mix/account/set-margin-mode',
        body: {
            symbol: args.symbol,
            productType: 'usdt-futures',
            marginCoin: args.marginCoin,
            marginMode: args.marginMode,
        },
    });
}
export async function bitgetSetLeverage(baseUrl, creds, args) {
    return await bitgetRequest({
        baseUrl,
        creds,
        method: 'POST',
        path: '/api/v2/mix/account/set-leverage',
        body: {
            symbol: args.symbol,
            productType: 'usdt-futures',
            marginCoin: args.marginCoin,
            leverage: String(args.leverage),
            holdSide: args.holdSide,
        },
    });
}
export async function bitgetOrderDetail(baseUrl, creds, args) {
    return await bitgetRequest({
        baseUrl,
        creds,
        method: 'GET',
        path: '/api/v2/mix/order/detail',
        query: {
            symbol: args.symbol,
            productType: 'usdt-futures',
            orderId: args.orderId,
            clientOid: args.clientOid,
        },
    });
}
export async function bitgetAllPositions(baseUrl, creds) {
    return await bitgetRequest({
        baseUrl,
        creds,
        method: 'GET',
        path: '/api/v2/mix/position/all-position',
        query: { productType: 'usdt-futures' },
    });
}
export async function bitgetPlaceOrder(baseUrl, creds, body) {
    // WARNING: only call when LIVE_ORDER_SEND=true.
    return await bitgetRequest({
        baseUrl,
        creds,
        method: 'POST',
        path: '/api/v2/mix/order/place-order',
        body,
    });
}
