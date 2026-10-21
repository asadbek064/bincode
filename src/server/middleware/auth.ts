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

export function signToken(config: Config, userId: string): string {
  return jwt.sign({}, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
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
      if (typeof payload === 'object') userId = payload.sub;
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
