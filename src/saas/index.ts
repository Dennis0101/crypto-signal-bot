import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';
import { authOptional } from './http/middleware.js';

import { createRouter as createAuthRouter } from './routes/auth.js';
import { createRouter as createKeysRouter } from './routes/keys.js';
import { createRouter as createMarketRouter } from './routes/market.js';
import { createRouter as createTradesRouter } from './routes/trades.js';
import { createRouter as createSettingsRouter } from './routes/settings.js';
import { createRouter as createAnalysisRouter } from './routes/analysis.js';
import { createRouter as createTradingRouter } from './routes/trading.js';

export function createApp() {
  const app = express();
  const isProd = (process.env.NODE_ENV ?? 'development') === 'production';

  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: false, // CSP will be set by web app when bundled
  }));
  app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

  app.use(express.json({ limit: '256kb' }));
  // Required for Apple Sign-In callback (response_mode=form_post)
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

  app.use(authOptional);

// Serve web UI (single-binary SaaS feel)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const webDir = path.join(__dirname, 'web');
  app.use(
    '/_app',
    express.static(webDir, {
      maxAge: isProd ? '1h' : 0,
      etag: true,
      setHeaders(res) {
        if (!isProd) res.setHeader('Cache-Control', 'no-store');
      },
    })
  );

  // Vendor: serve lightweight-charts from local node_modules (no CDN dependency)
  const vendorCharts = path.join(process.cwd(), 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.esm.production.js');
  app.get('/_app/vendor/lightweight-charts.js', (_req, res) => res.sendFile(vendorCharts));

  app.get('/', (_req, res) => {
    if (!isProd) res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(webDir, 'index.html'));
  });

  app.use('/v1/auth', createAuthRouter());
  app.use('/v1/exchange-keys', createKeysRouter());
  app.use('/v1/settings', createSettingsRouter());
  app.use('/v1/analysis', createAnalysisRouter());
  app.use('/v1/trading', createTradingRouter());
  app.use('/v1/market', createMarketRouter());
  app.use('/v1/trades', createTradesRouter());

  return app;
}

export async function main() {
  const app = createApp();
  const port = Number(process.env.SAAS_PORT || 8080);
  app.listen(port, () => logger.info({ port }, 'SaaS API listening'));
}

// Only listen when executed as the entrypoint.
const isEntry = (() => {
  try {
    if (!process.argv[1]) return false;
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isEntry) {
  main().catch((e) => {
    logger.error({ err: String(e?.message ?? e) }, 'SaaS API crashed');
    process.exit(1);
  });
}
