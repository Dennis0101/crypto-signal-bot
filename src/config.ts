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
  TF_CHOICES: ['1m','5m','15m','1h','4h'],
  SYMBOL_CHOICES: ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ARBUSDT'],
  COOLDOWN_MS: 30_000,
  CACHE_TTL_MS: 15_000,
  PORT: Number(process.env.PORT || 3000)  // Railway가 주입
};

if (!CONFIG.DISCORD_TOKEN) {
  throw new Error('DISCORD_TOKEN 누락');
}
