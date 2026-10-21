import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { createAuth } from './middleware/auth.ts';
import { errorHandler, notFound } from './middleware/error.ts';
import {
  DEFAULT_QUOTAS,
  createRateLimiters,
  noStore,
  securityHeaders,
  type Quotas,
  type RateLimits,
} from './middleware/security.ts';
import { createCollectionsRepo } from './repos/collections.ts';
import { createSnippetsRepo } from './repos/snippets.ts';
import { createUsersRepo } from './repos/users.ts';
import { authRouter } from './routes/auth.ts';
import { collectionsRouter } from './routes/collections.ts';
import { snippetsRouter } from './routes/snippets.ts';

export interface AppOptions {
  db: Db;
  config: Config;
  /** directory containing the built client (index.html, preview.html, assets/) */
  clientDir: string;
  limits?: RateLimits;
  quotas?: Partial<Quotas>;
}

// Only snippet content can be large; everything else (logins, unlocks, settings) is tiny. Keeping the
// default small means anonymous endpoints can't be fed megabytes to parse before any limit applies.
const SMALL_BODY = '16kb';
const SNIPPET_BODY = '2mb';
const LARGE_BODY_ROUTE = /^\/api\/snippets(?:\/[^/]+(?:\/fork)?)?\/?$/;

export function createApp({ db, config, clientDir: rawClientDir, limits, quotas }: AppOptions): express.Application {
  const clientDir = path.resolve(rawClientDir);
  const app = express();
  const users = createUsersRepo(db);
  const snippets = createSnippetsRepo(db);
  const collections = createCollectionsRepo(db);
  const { requireAuth, optionalAuth } = createAuth(config, users);
  const limiters = createRateLimiters(limits);
  const quota: Quotas = { ...DEFAULT_QUOTAS, ...quotas };
  const smallJson = express.json({ limit: SMALL_BODY });
  const snippetJson = express.json({ limit: SNIPPET_BODY });

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.use(securityHeaders());
  // Snippet create/update/fork get room above the 500K character cap so oversized code gets a
  // validation error instead of 413.
  app.use((req, res, next) => {
    const large = (req.method === 'POST' || req.method === 'PUT') && LARGE_BODY_ROUTE.test(req.path);
    (large ? snippetJson : smallJson)(req, res, next);
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  const api = express.Router();
  api.use(noStore);
  api.use(limiters.api);
  api.use('/auth', authRouter({ config, users, requireAuth, loginLimiters: [limiters.login, limiters.loginEmail] }));
  api.use(
    '/snippets',
    snippetsRouter({
      config,
      snippets,
      quotas: quota,
      requireAuth,
      optionalAuth,
      writeLimiter: limiters.writes,
      unlockLimiters: [limiters.unlock, limiters.unlockTarget],
    }),
  );
  api.use(
    '/collections',
    collectionsRouter({
      config,
      collections,
      snippets,
      quotas: quota,
      requireAuth,
      optionalAuth,
      writeLimiter: limiters.writes,
      unlockLimiters: [limiters.unlock, limiters.unlockTarget],
    }),
  );
  api.use(notFound);
  app.use('/api', api);

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
