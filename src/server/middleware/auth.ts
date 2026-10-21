import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { User } from '../../shared/api.ts';
import type { Config } from '../config.ts';
import type { UsersRepo } from '../repos/users.ts';
import { HttpError } from './error.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const BEARER = /^Bearer ([^\s]+)$/;

/** Unlock tokens carry an audience per kind; login tokens carry none, so none passes as another. */
export type UnlockKind = 'collection' | 'snippet';
const AUDIENCE: Record<UnlockKind, string> = { collection: 'bincode:collection', snippet: 'bincode:snippet' };
const UNLOCK_TOKEN_TTL_SECONDS = 12 * 60 * 60;

export function signToken(config: Config, userId: string): string {
  return jwt.sign({}, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function signUnlockToken(
  config: Config,
  kind: UnlockKind,
  target: { id: string; passwordVersion: number },
): { token: string; expiresAt: string } {
  const token = jwt.sign({ pv: target.passwordVersion }, config.JWT_SECRET, {
    algorithm: 'HS256',
    audience: AUDIENCE[kind],
    subject: target.id,
    expiresIn: UNLOCK_TOKEN_TTL_SECONDS,
  });
  const expiresAt = new Date(Date.now() + UNLOCK_TOKEN_TTL_SECONDS * 1000).toISOString();
  return { token, expiresAt };
}

/**
 * True when `token` is a valid, unexpired unlock token of this kind for this target at its current
 * password version (changing the password revokes every token issued before).
 */
export function hasUnlockToken(
  config: Config,
  kind: UnlockKind,
  target: { id: string; passwordVersion: number },
  token: unknown,
): boolean {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return false;
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'], audience: AUDIENCE[kind] });
    return typeof payload === 'object' && payload.sub === target.id && payload.pv === target.passwordVersion;
  } catch {
    return false;
  }
}

export function createAuth(config: Config, users: UsersRepo) {
  /** Returns the user for a valid token, null when no token was sent, and throws 401 otherwise. */
  function authenticate(header: string | undefined): User | null {
    if (!header) return null;
    const match = BEARER.exec(header);
    if (!match) throw new HttpError(401, 'Invalid authorization header');

    let userId: string | undefined;
    try {
      // Pinning the algorithm blocks alg:none and key-confusion tokens.
      const payload = jwt.verify(match[1]!, config.JWT_SECRET, { algorithms: ['HS256'] });
      // A token with an audience is a collection unlock token, not a login.
      if (typeof payload === 'object' && payload.aud === undefined) userId = payload.sub;
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }
    if (!userId) throw new HttpError(401, 'Invalid or expired token');

    // Tokens outlive deleted accounts, so re-check the user on every request.
    const user = users.findById(userId);
    if (!user) throw new HttpError(401, 'Invalid or expired token');
    return user;
  }

  const requireAuth: RequestHandler = (req, _res, next) => {
    const user = authenticate(req.headers.authorization);
    if (!user) throw new HttpError(401, 'Authentication required');
    req.user = user;
    next();
  };

  const optionalAuth: RequestHandler = (req, _res, next) => {
    try {
      req.user = authenticate(req.headers.authorization) ?? undefined;
    } catch {
      req.user = undefined;
    }
    next();
  };

  return { requireAuth, optionalAuth };
}
