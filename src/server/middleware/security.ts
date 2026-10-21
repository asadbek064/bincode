import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
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

// The preview runs arbitrary user code in an opaque-origin sandbox, so it may load anything;
// only embedding by other sites is restricted.
const PREVIEW_CSP = {
  defaultSrc: ['*', 'data:', 'blob:', "'unsafe-inline'", "'unsafe-eval'"],
  frameAncestors: ["'self'"],
};

export function securityHeaders(): RequestHandler {
  const appHelmet = helmet({ contentSecurityPolicy: { useDefaults: false, directives: APP_CSP } });
  const previewHelmet = helmet({ contentSecurityPolicy: { useDefaults: false, directives: PREVIEW_CSP } });

  return (req, res, next) => {
    if (req.path === PREVIEW_PATH) previewHelmet(req, res, next);
    else appHelmet(req, res, next);
  };
}

/** The preview frame has an opaque origin, so vendored scripts it loads count as cross-origin. */
export const vendorCorp: RequestHandler = (_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
};

export interface RateLimits {
  /** requests per minute across /api */
  api?: number;
  /** failed login attempts per 15 minutes */
  login?: number;
}

function limiter(windowMs: number, limit: number, skipSuccessfulRequests = false): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many requests, please try again later.' });
    },
  });
}

export function createRateLimiters(limits: RateLimits = {}) {
  return {
    api: limiter(60_000, limits.api ?? 300),
    login: limiter(15 * 60_000, limits.login ?? 10, true),
  };
}
