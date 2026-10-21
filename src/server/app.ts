import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { createAuth } from './middleware/auth.ts';
import { errorHandler, notFound } from './middleware/error.ts';
import { createRateLimiters, securityHeaders, vendorCorp, type RateLimits } from './middleware/security.ts';
import { createSnippetsRepo } from './repos/snippets.ts';
import { createUsersRepo } from './repos/users.ts';
import { authRouter } from './routes/auth.ts';
import { snippetsRouter } from './routes/snippets.ts';

export interface AppOptions {
  db: Db;
  config: Config;
  /** directory containing the built client (index.html, preview.html, assets/, vendor/) */
  clientDir: string;
  limits?: RateLimits;
}

export function createApp({ db, config, clientDir: rawClientDir, limits }: AppOptions): express.Application {
  const clientDir = path.resolve(rawClientDir);
  const app = express();
  const users = createUsersRepo(db);
  const snippets = createSnippetsRepo(db);
  const { requireAuth, optionalAuth } = createAuth(config, users);
  const limiters = createRateLimiters(limits);

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.use(securityHeaders());
  // Above the 500K character cap so oversized snippets get a validation error instead of 413.
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  const api = express.Router();
  api.use(limiters.api);
  api.use('/auth', authRouter({ config, users, requireAuth, loginLimiter: limiters.login }));
  api.use('/snippets', snippetsRouter({ snippets, requireAuth, optionalAuth }));
  api.use(notFound);
  app.use('/api', api);

  app.use('/vendor', vendorCorp);
  app.use(
    express.static(clientDir, {
      index: false,
      setHeaders(res, filePath) {
        // Vite fingerprints everything under assets/, so it can be cached forever.
        if (filePath.startsWith(path.join(clientDir, 'assets') + path.sep)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  const indexFile = path.join(clientDir, 'index.html');
  app.get(/^\/(?!api(?:\/|$))[^.]*$/, (_req, res) => {
    if (!fs.existsSync(indexFile)) {
      res.status(404).type('text/plain').send('Client not built. Run pnpm build.');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });

  app.use(errorHandler);
  return app;
}
