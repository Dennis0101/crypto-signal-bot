// src/paper/store.ts
import fs from 'fs';
import path from 'path';
const SAVE_PATH = path.resolve('data/paper.json');
// ✅ 서버별(guildId) → 유저별(userId) → 계정
const accounts = new Map();
const DEFAULT_ACCOUNT = () => ({
    equityUSD: 100_000,
    orderAmountUSD: 100,
    leverage: 5,
    currency: 'USD',
    enabled: false,
    positions: new Map(),
    openedAt: Date.now(),
    realizedPnl: 0,
});
export function getAccount(guildId, userId) {
    if (!accounts.has(guildId))
        accounts.set(guildId, new Map());
    const g = accounts.get(guildId);
    if (!g.has(userId))
        g.set(userId, DEFAULT_ACCOUNT());
    return g.get(userId);
}
export function getPosition(guildId, userId, symbol) {
    return getAccount(guildId, userId).positions.get(symbol);
}
export function upsertPosition(guildId, userId, pos) {
    getAccount(guildId, userId).positions.set(pos.symbol, pos);
}
export function removePosition(guildId, userId, symbol) {
    getAccount(guildId, userId).positions.delete(symbol);
}
export function addEquity(guildId, userId, delta) {
    const acc = getAccount(guildId, userId);
    acc.equityUSD += delta;
    acc.realizedPnl += delta;
}
export function setOrderAmount(guildId, userId, usd) {
    const acc = getAccount(guildId, userId);
    acc.orderAmountUSD = usd;
}
export function setLeverage(guildId, userId, lev) {
    const acc = getAccount(guildId, userId);
    acc.leverage = lev;
}
export function setCurrency(guildId, userId, c) {
    getAccount(guildId, userId).currency = c;
}
export function setEnabled(guildId, userId, e) {
    getAccount(guildId, userId).enabled = e;
}
export function resetAccount(guildId, userId) {
    if (!accounts.has(guildId))
        accounts.set(guildId, new Map());
    accounts.get(guildId).set(userId, DEFAULT_ACCOUNT());
}
/* =============== 랭킹 =============== */
export function getRanking(guildId) {
    const g = accounts.get(guildId);
    if (!g)
        return [];
    return Array.from(g.entries())
        .map(([userId, acc]) => {
        const total = acc.equityUSD + acc.realizedPnl;
        const roi = ((total - 100_000) / 100_000) * 100;
        return { userId, total, roi };
    })
        .sort((a, b) => b.total - a.total);
}
/* =============== 스냅샷 저장/로드 =============== */
function accountToPlain(acc) {
    return {
        equityUSD: acc.equityUSD,
        orderAmountUSD: acc.orderAmountUSD,
        leverage: acc.leverage,
        currency: acc.currency,
        enabled: acc.enabled,
        openedAt: acc.openedAt,
        realizedPnl: acc.realizedPnl,
        positions: Array.from(acc.positions.values()), // Map -> Array
    };
}
export function saveSnapshot() {
    const plain = {};
    for (const [guildId, gmap] of accounts.entries()) {
        plain[guildId] = {};
        for (const [userId, acc] of gmap.entries()) {
            plain[guildId][userId] = accountToPlain(acc);
        }
    }
    fs.mkdirSync(path.dirname(SAVE_PATH), { recursive: true });
    fs.writeFileSync(SAVE_PATH, JSON.stringify(plain, null, 2), 'utf8');
}
export function loadSnapshot() {
    if (!fs.existsSync(SAVE_PATH))
        return;
    const raw = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'));
    for (const [guildId, users] of Object.entries(raw)) {
        const gmap = new Map();
        for (const [userId, a] of Object.entries(users)) {
            gmap.set(userId, {
                equityUSD: a.equityUSD,
                orderAmountUSD: a.orderAmountUSD,
                leverage: a.leverage,
                currency: a.currency,
                enabled: a.enabled,
                openedAt: a.openedAt,
                realizedPnl: a.realizedPnl,
                positions: new Map(a.positions.map(p => [p.symbol, p])),
            });
        }
        accounts.set(guildId, gmap);
    }
}
// 주기 저장 + 종료 시 저장
setInterval(saveSnapshot, 30_000);
process.on('SIGINT', () => {
    saveSnapshot();
    process.exit(0);
});
