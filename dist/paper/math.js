// src/paper/math.ts
import { CONFIG } from '../config.js';
/** 레버리지 보정 (1 ~ MAX) */
export function clampLev(v, maxLev = (CONFIG.PAPER?.MAX_LEVERAGE ?? 50)) {
    const n = Math.floor(Number.isFinite(v) ? v : 1);
    return Math.min(Math.max(n, 1), maxLev);
}
/** 주문 금액(USD) → 수량 계산: notional = price * qty / lev  ⇒ qty = notional * lev / price */
export function qtyFromNotionalUSD(notionalUSD, price, lev) {
    if (!Number.isFinite(notionalUSD) || !Number.isFinite(price) || !Number.isFinite(lev) || price <= 0 || lev <= 0)
        return 0;
    return (notionalUSD * lev) / price;
}
/** 미실현 손익(USD) */
export function unrealizedPnlUSD(side, entry, price, qty) {
    if (!Number.isFinite(entry) || !Number.isFinite(price) || !Number.isFinite(qty))
        return 0;
    const diff = price - entry;
    return side === 'LONG' ? diff * qty : -diff * qty;
}
/** 수익률(%) — (명목/레버리지 기준) */
export function pnlPct(side, entry, price, qty, lev) {
    const pnl = unrealizedPnlUSD(side, entry, price, qty);
    const notional = (entry * qty) / Math.max(1, lev || 1); // 실제 증거금
    if (!Number.isFinite(notional) || notional <= 0)
        return 0;
    return (pnl / notional) * 100;
}
/** 원화 환산 */
export function usdToKrw(usd) {
    const fx = Number(CONFIG.PAPER?.FX_USDKRW) || 1400;
    return usd * fx;
}
/** 통화 포맷터들 */
export function fmtUSD(n) {
    if (!Number.isFinite(n))
        return '$-';
    return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}
export function fmtKRW(n) {
    if (!Number.isFinite(n))
        return '–원';
    const v = Math.round(n);
    return `${v.toLocaleString('ko-KR')}원`;
}
/** 부호 포함 USD (예: +$12.34 / -$5.10) */
export function fmtMoney(n) {
    if (!Number.isFinite(n))
        return '$-';
    const s = n >= 0 ? '+' : '';
    return `${s}$${Math.abs(n).toFixed(2)}`;
}
