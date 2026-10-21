import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit';
import helmet from 'helmet';
import { PREVIEW_PATH } from '../../shared/constants.ts';

const APP_CSP = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  // Monaco injects inline styles at runtime.
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'", 'data:'],
  // Monaco language workers may be spawned from blob: URLs.
  workerSrc: ["'self'", 'blob:'],
  connectSrc: ["'self'"],
  frameSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'self'"],
};

// The preview runs arbitrary user code, so it may load anything; only embedding by other sites is
// restricted. The sandbox directive gives it an opaque origin even if it is opened outside our
// sandboxed iframe (e.g. in a popup), so snippet code can never run with the app's origin.
const PREVIEW_CSP = {
  defaultSrc: ['*', 'data:', 'blob:', "'unsafe-inline'", "'unsafe-eval'"],
  frameAncestors: ["'self'"],
  sandbox: ['allow-scripts', 'allow-modals', 'allow-forms', 'allow-popups'],
};

export function securityHeaders(): RequestHandler {
  const appHelmet = helmet({ contentSecurityPolicy: { useDefaults: false, directives: APP_CSP } });
  const previewHelmet = helmet({ contentSecurityPolicy: { useDefaults: false, directives: PREVIEW_CSP } });

  return (req, res, next) => {
    if (req.path === PREVIEW_PATH) previewHelmet(req, res, next);
    else appHelmet(req, res, next);
  };
}

/**
 * API responses can hold private or password-protected content (and unlock tokens aren't the
 * Authorization header that shared caches already respect), so nothing under /api may be cached.
 */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

/** Per-account caps, so one account can't fill the disk. Enforced on create (and on update for storage). */
export interface Quotas {
  binsPerUser: number;
  collectionsPerUser: number;
  /** combined characters of html + css + js across all of a user's bins */
  storagePerUser: number;
}

export const DEFAULT_QUOTAS: Quotas = {
  binsPerUser: 5_000,
  collectionsPerUser: 200,
  storagePerUser: 50_000_000,
};

/** The preview frame has an opaque origin, so vendored scripts it loads count as cross-origin. */
export const vendorCorp: RequestHandler = (_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
};

export interface RateLimits {
  /** requests per minute across /api */
  api?: number;
  /** failed login attempts per 15 minutes, per IP */
  login?: number;
  /** failed login attempts per hour, per email (across all IPs) */
  loginEmail?: number;
  /** failed bin/collection unlocks per 15 minutes, per IP */
  unlock?: number;
  /** failed unlocks per hour, per bin or collection (across all IPs) */
  unlockTarget?: number;
  /** mutations (POST/PUT/DELETE) per minute, per user */
  writes?: number;
}

interface LimiterOptions {
  windowMs: number;
  limit: number;
  skipSuccessfulRequests?: boolean;
  keyGenerator?: Options['keyGenerator'];
}

function limiter({ windowMs, limit, skipSuccessfulRequests = false, keyGenerator }: LimiterOptions): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests,
    ...(keyGenerator ? { keyGenerator } : {}),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many requests, please try again later.' });
    },
  });
}

// Prefixes keep keys from different sources apart. ipKeyGenerator groups IPv6 by /56 so one host can't
// rotate addresses; it is called inline because express-rate-limit checks the keyGenerator's source for it.

function bodyEmail(body: unknown): string | null {
  const email = (body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
}

export function createRateLimiters(limits: RateLimits = {}) {
  return {
    api: limiter({ windowMs: 60_000, limit: limits.api ?? 300 }),
    login: limiter({ windowMs: 15 * 60_000, limit: limits.login ?? 10, skipSuccessfulRequests: true }),
    // Stops a password guess spread across many IPs. Trade-off: an attacker can make one account's
    // login fail for 15 minutes; the per-IP limit alone would let a botnet guess indefinitely.
    loginEmail: limiter({
      windowMs: 60 * 60_000,
      limit: limits.loginEmail ?? 20,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => {
        const email = bodyEmail(req.body);
        return email ? `email:${email}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
      },
    }),
    unlock: limiter({ windowMs: 15 * 60_000, limit: limits.unlock ?? 10, skipSuccessfulRequests: true }),
    // Same idea per bin or collection. Visitors can be locked out for an hour; owners never need to unlock.
    unlockTarget: limiter({
      windowMs: 60 * 60_000,
      limit: limits.unlockTarget ?? 30,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => `${req.baseUrl}:${String(req.params.shareId)}`,
    }),
    // Must run after requireAuth; keyed per account so one user can't flood the database.
    writes: limiter({
      windowMs: 60_000,
      limit: limits.writes ?? 60,
      keyGenerator: (req) => (req.user ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip ?? '')}`),
    }),
  };
}

export type RateLimiters = ReturnType<typeof createRateLimiters>;
