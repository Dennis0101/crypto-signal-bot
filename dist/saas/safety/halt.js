/**
 * "When uncertain, stop" safety gate.
 * Call this before any live trading action.
 */
export function requireOk(d) {
    if (!d.ok) {
        const msg = `[HALT] ${d.code}: ${d.message}`;
        const err = new Error(msg);
        err.halt = { code: d.code, message: d.message, meta: d.meta };
        throw err;
    }
}
