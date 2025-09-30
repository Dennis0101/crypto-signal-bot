import 'dotenv/config';

export const CONFIG = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN || '',
  BITGET_BASE: process.env.BITGET_BASE || 'https://api.bitget.com',
  OPENAI: {
    KEY: process.env.OPENAI_API_KEY || '',
    MODEL: process.env.OPENAI_MODEL || 'gpt-4o-mini'
  },
  DEFAULT_SYMBOL: 'BTCUSDT',
  DEFAULT_TF: '15m',
  CATEGORY: 'USDT-FUTURES',
  TF_CHOICES: ['1m', '5m', '15m', '1h', '4h'],
  SYMBOL_CHOICES: [
    'BTCUSDT',
    'ETHUSDT',
    'SOLUSDT',
    'XRPUSDT',
    'ARBUSDT',
    'ONDOUSDT',   // 👈 ONDO 코인 추가
  ],
  COOLDOWN_MS: 30_000,
  CACHE_TTL_MS: 15_000,
  PORT: Number(process.env.PORT || 3000),  // Railway가 주입

  // ===== 페이퍼 트레이딩(가상 선물거래) =====
  PAPER: {
    DEFAULT_EQUITY_USD: 100_000,   // ✅ 기본 가상자본: $100,000
    DEFAULT_LEVERAGE: 50,          // ✅ 기본 레버리지: 50x
    MAX_LEVERAGE: 50,              // ✅ 상한: 50x
    MIN_ORDER_USD: 100,            // ✅ 최소 주문: $100
    MAX_ORDER_USD: 10_000,         // ✅ 최대 주문: $10,000
    SCOPE: 'per_guild',               // 전 서버 공용 계정 (per_guild 로 바꾸면 서버별 분리)
    FX_USDKRW: Number(process.env.FX_USDKRW || 1400), // 원화 환산 비율
  }
};

if (!CONFIG.DISCORD_TOKEN) {
  throw new Error('DISCORD_TOKEN 누락');
}
