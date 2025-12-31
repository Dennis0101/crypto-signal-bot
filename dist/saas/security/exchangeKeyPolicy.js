export function validateExchangeKeyInput(input) {
    if (!input.apiKey || input.apiKey.length < 8)
        return { ok: false, message: 'apiKey is missing/too short' };
    if (!input.apiSecret || input.apiSecret.length < 8)
        return { ok: false, message: 'apiSecret is missing/too short' };
    if (input.withdrawEnabled === true) {
        // absolute rule
        return { ok: false, message: 'Withdraw permission must be disabled.' };
    }
    return { ok: true };
}
