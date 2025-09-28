import { Client, GatewayIntentBits } from 'discord.js';
import express from 'express';
import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { initRouter } from './router.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once('ready', () => logger.info(`✅ Logged in as ${client.user?.tag}`));
initRouter(client);
await client.login(CONFIG.DISCORD_TOKEN);

// --- Railway 헬스체크용 아주 간단한 HTTP 서버 ---
const app = express();
app.get('/', (_req, res) => res.send('OK'));
app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.listen(CONFIG.PORT, () => logger.info(`HTTP server on :${CONFIG.PORT}`));
