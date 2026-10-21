import bcrypt from 'bcryptjs';
import { Router, type RequestHandler } from 'express';
import type { LoginRequest, LoginResponse, MeResponse } from '../../shared/api.ts';
import { loginSchema } from '../../shared/schemas.ts';
import type { Config } from '../config.ts';
import { signToken } from '../middleware/auth.ts';
import { HttpError } from '../middleware/error.ts';
import { validateBody } from '../middleware/validate.ts';
import type { UsersRepo } from '../repos/users.ts';

interface AuthRouterDeps {
  config: Config;
  users: UsersRepo;
  requireAuth: RequestHandler;
  loginLimiter: RequestHandler;
}

export function authRouter({ config, users, requireAuth, loginLimiter }: AuthRouterDeps): Router {
  const router = Router();
  // Unknown emails still pay for a bcrypt compare so response time doesn't reveal which accounts exist.
  const dummyHash = bcrypt.hashSync('dummy-password-for-timing', config.BCRYPT_ROUNDS);

  router.post('/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
    const { email, password } = req.body as LoginRequest;
    const user = users.findByEmail(email);
    const ok = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);
    if (!user || !ok) throw new HttpError(401, 'Invalid email or password');

    const body: LoginResponse = {
      token: signToken(config, user.id),
      user: { id: user.id, email: user.email },
    };
    res.json(body);
  });

  router.get('/me', requireAuth, (req, res) => {
    const body: MeResponse = { user: req.user! };
    res.json(body);
  });

  return router;
}
