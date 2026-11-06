// Starts the server. Run with:  pnpm dev:api
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { consoleOtpSender } from './auth/otp-sender.js';

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
const app = await buildApp({ db, jwtSecret: config.JWT_SECRET, otpSender: consoleOtpSender, logger: true });

await app.listen({ port: config.PORT, host: '0.0.0.0' });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
