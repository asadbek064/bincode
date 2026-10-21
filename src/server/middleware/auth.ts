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

/** Collection unlock tokens carry this audience; user tokens carry none, so neither passes as the other. */
const COLLECTION_AUDIENCE = 'bincode:collection';
const COLLECTION_TOKEN_TTL_SECONDS = 12 * 60 * 60;

export function signToken(config: Config, userId: string): string {
  return jwt.sign({}, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function signCollectionToken(
  config: Config,
  collection: { id: string; passwordVersion: number },
): { token: string; expiresAt: string } {
  const token = jwt.sign({ pv: collection.passwordVersion }, config.JWT_SECRET, {
    algorithm: 'HS256',
    audience: COLLECTION_AUDIENCE,
    subject: collection.id,
    expiresIn: COLLECTION_TOKEN_TTL_SECONDS,
  });
  const expiresAt = new Date(Date.now() + COLLECTION_TOKEN_TTL_SECONDS * 1000).toISOString();
  return { token, expiresAt };
}

export interface CollectionGrant {
  collectionId: string;
  passwordVersion: number;
}

/** Returns the grant in a valid collection token, or null for a missing, malformed or expired one. */
export function verifyCollectionToken(config: Config, token: unknown): CollectionGrant | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return null;
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'], audience: COLLECTION_AUDIENCE });
    if (typeof payload !== 'object' || typeof payload.sub !== 'string' || typeof payload.pv !== 'number') return null;
    return { collectionId: payload.sub, passwordVersion: payload.pv };
  } catch {
    return null;
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
