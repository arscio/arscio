// Starts the server. Run with:  pnpm dev:api
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { consoleOtpSender } from './auth/otp-sender.js';
import { startPushWorker } from './notify/push.js';
import { startResultsDayJob } from './results/job.js';
import { RequestMetrics } from './platform/metrics.js';

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
const metrics = new RequestMetrics();
const app = await buildApp({ metrics, db, jwtSecret: config.JWT_SECRET, otpSender: consoleOtpSender, logger: true,
  corsOrigins: config.CORS_ORIGINS, loginMode: config.LOGIN_MODE, appDownloadUrl: config.APP_DOWNLOAD_URL,
  publicWebUrl: config.PUBLIC_WEB_URL });

await app.listen({ port: config.PORT, host: config.HOST });

// Phone notifications (needs the platform connection, as it works across schools).
let stopPush: (() => void) | null = null;
let stopResults: (() => void) | null = null;
if (config.DATABASE_OWNER_URL) {
  const owner = createPool(config.DATABASE_OWNER_URL, 4);
  if (process.env.PUSH_ENABLED === 'true') stopPush = startPushWorker(owner, 5000, (m) => app.log.info(m));
  // Results day: makes marksheets and tells families when a class's result date comes.
  stopResults = startResultsDayJob(owner, db, 15 * 60 * 1000, (m) => app.log.info(m));
  // Request counts for the control panel, saved once a minute.
  const flush = setInterval(() => void metrics.flush(owner), 60_000);
  stopResults = ((s) => () => { s(); clearInterval(flush); })(stopResults);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    stopPush?.();
    stopResults?.();
    await app.close();
    await db.end();
    process.exit(0);
  });
}
