import { z } from 'zod';

const trustProxySchema = z
  .string()
  .trim()
  .default('false')
  .transform((v): boolean | number | string => {
    if (v === '' || v === 'false') return false;
    if (v === 'true') return true;
    if (/^\d+$/.test(v)) return Number(v);
    return v;
  });

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  JWT_EXPIRES_IN: z.string().min(1).default('7d'),
  DB_FILE: z.string().min(1).default('./bincode.db'),
  TRUST_PROXY: trustProxySchema,
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
});

const configSchema = baseSchema
  .extend({ JWT_SECRET: z.string().min(1, 'JWT_SECRET is required') })
  .superRefine((c, ctx) => {
    // A short secret is brute-forceable offline from any issued token.
    if (c.NODE_ENV === 'production' && c.JWT_SECRET.length < 32) {
      ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'must be at least 32 characters in production' });
    }
  });

export type Config = z.output<typeof configSchema>;
export type DbConfig = z.output<typeof baseSchema>;

type Env = Record<string, string | undefined>;

function parseOrThrow<T extends z.ZodType>(schema: T, env: Env): z.output<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  return result.data;
}

export function loadConfig(env: Env = process.env): Config {
  return parseOrThrow(configSchema, env);
}

/** Config without JWT settings, for CLI tools that only touch the database. */
export function loadDbConfig(env: Env = process.env): DbConfig {
  return parseOrThrow(baseSchema, env);
}
