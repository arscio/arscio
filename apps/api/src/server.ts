// Starts the server. Run with:  pnpm dev:api
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { consoleOtpSender } from './auth/otp-sender.js';
import { startPushWorker } from './notify/push.js';

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
const app = await buildApp({ db, jwtSecret: config.JWT_SECRET, otpSender: consoleOtpSender, logger: true,
  corsOrigins: config.CORS_ORIGINS, });

await app.listen({ port: config.PORT, host: '0.0.0.0' });

// Phone notifications (needs the platform connection, as it works across schools).
let stopPush: (() => void) | null = null;
if (config.DATABASE_OWNER_URL && process.env.PUSH_ENABLED === 'true') {
  stopPush = startPushWorker(createPool(config.DATABASE_OWNER_URL), 5000, (m) => app.log.info(m));
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    stopPush?.();
    await app.close();
    await db.end();
    process.exit(0);
  });
}
