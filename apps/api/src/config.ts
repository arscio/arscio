// Reads settings from environment variables (the .env file) and refuses to
// start if something important is missing or unsafe.
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_OWNER_URL: z.string().url().optional(),
  APP_DB_PASSWORD: z.string().min(8).optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  OTP_PROVIDER: z.enum(['console']).default('console'),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGINS: z.string().default('').transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean)),
  NODE_ENV: z.string().default('development'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Server settings are not valid:\n${msg}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.OTP_PROVIDER === 'console') {
    throw new Error('OTP_PROVIDER=console is for development only');
  }
  return parsed.data;
}
