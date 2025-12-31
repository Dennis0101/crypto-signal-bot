export type ExchangeKeyInput = {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  withdrawEnabled?: boolean;
};

export function validateExchangeKeyInput(input: ExchangeKeyInput): { ok: true } | { ok: false; message: string } {
  if (!input.apiKey || input.apiKey.length < 8) return { ok: false, message: 'apiKey is missing/too short' };
  if (!input.apiSecret || input.apiSecret.length < 8) return { ok: false, message: 'apiSecret is missing/too short' };
  if (input.withdrawEnabled === true) {
    // absolute rule
    return { ok: false, message: 'Withdraw permission must be disabled.' };
  }
  return { ok: true };
}

