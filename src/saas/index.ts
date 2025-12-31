import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { logger } from '../utils/logger.js';
import { authOptional } from './http/middleware.js';

import { createRouter as createAuthRouter } from './routes/auth.js';
import { createRouter as createKeysRouter } from './routes/keys.js';
import { createRouter as createMarketRouter } from './routes/market.js';
import { createRouter as createTradesRouter } from './routes/trades.js';

const app = express();

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false, // CSP will be set by web app when bundled
}));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.use(authOptional);

app.use('/v1/auth', createAuthRouter());
app.use('/v1/exchange-keys', createKeysRouter());
app.use('/v1/market', createMarketRouter());
app.use('/v1/trades', createTradesRouter());

const port = Number(process.env.SAAS_PORT || 8080);
app.listen(port, () => logger.info({ port }, 'SaaS API listening'));

