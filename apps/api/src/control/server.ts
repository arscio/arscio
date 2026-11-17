// Starts the Arscio control panel. On the server it runs as the "arscio-control" service,
// listening only inside the server on 127.0.0.1:4102. To open it from your Mac:
//   ssh -i <your key> -L 8102:127.0.0.1:4102 ubuntu@<server address>
// then visit http://localhost:8102 and enter the control panel password.
import pg from 'pg';
import { buildControlApp } from './app.js';
import { Sampler } from './sampler.js';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k} in the settings file`); process.exit(1); }
  return v;
};
const owner = new pg.Pool({ connectionString: need('DATABASE_OWNER_URL'), max: 3 });
const sampler = new Sampler(owner, `http://127.0.0.1:${process.env.PORT ?? 4100}`);
const app = await buildControlApp({
  owner,
  sampler,
  passwordHash: need('CONTROL_PASSWORD_HASH'),
  secret: need('JWT_SECRET'),
  apiUrl: `http://127.0.0.1:${process.env.PORT ?? 4100}`,
  webUrl: `http://127.0.0.1:${process.env.WEB_PORT ?? 4101}`,
  backupDir: process.env.BACKUP_DIR ?? '/var/backups/arscio',
  loginMode: process.env.LOGIN_MODE === 'password' ? 'password' : 'otp',
  publicWebUrl: process.env.PUBLIC_WEB_URL,
  logger: true,
});
// Only reachable from inside the server (through the SSH tunnel), never from the internet.
await app.listen({ host: '127.0.0.1', port: Number(process.env.CONTROL_PORT ?? 4102) });
sampler.start();
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { sampler.stop(); await app.close(); await owner.end(); process.exit(0); });
