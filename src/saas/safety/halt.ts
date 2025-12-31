export type HaltReasonCode =
  | 'UNCONFIGURED'
  | 'RISK_LIMIT'
  | 'API_DESYNC'
  | 'EXCHANGE_ERROR'
  | 'AI_UNCERTAIN'
  | 'SERVER_RESTART_SAFE_MODE'
  | 'INVARIANT_VIOLATION';

export type HaltDecision =
  | { ok: true }
  | { ok: false; code: HaltReasonCode; message: string; meta?: Record<string, unknown> };

/**
 * "When uncertain, stop" safety gate.
 * Call this before any live trading action.
 */
export function requireOk(d: HaltDecision): asserts d is { ok: true } {
  if (!d.ok) {
    const msg = `[HALT] ${d.code}: ${d.message}`;
    const err = new Error(msg);
    (err as any).halt = { code: d.code, message: d.message, meta: d.meta };
    throw err;
  }
}

