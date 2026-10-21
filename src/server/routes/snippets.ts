import bcrypt from 'bcryptjs';
import { Router, type Request, type RequestHandler } from 'express';
import type {
  CreateSnippetRequest,
  LockReason,
  LockedSnippet,
  Snippet,
  SnippetInput,
  SnippetListResponse,
  SnippetSettingsInput,
  UnlockSnippetRequest,
  UnlockSnippetResponse,
} from '../../shared/api.ts';
import { EXPIRATIONS, LIMITS, SHARE_ID_PATTERN, UNLOCK_TOKEN_HEADER } from '../../shared/constants.ts';
import {
  createSnippetSchema,
  forkInputSchema,
  snippetInputSchema,
  snippetSettingsSchema,
  unlockSnippetSchema,
} from '../../shared/schemas.ts';
import type { Config } from '../config.ts';
import { hasUnlockToken, signUnlockToken } from '../middleware/auth.ts';
import { HttpError } from '../middleware/error.ts';
import { validateBody } from '../middleware/validate.ts';
import {
  DEFAULT_SETTINGS,
  toSnippet,
  type SnippetRecord,
  type SnippetSettings,
  type SnippetsRepo,
} from '../repos/snippets.ts';

interface SnippetsRouterDeps {
  config: Config;
  snippets: SnippetsRepo;
  requireAuth: RequestHandler;
  optionalAuth: RequestHandler;
  writeLimiter: RequestHandler;
  /** per-IP and per-bin limiters for password and burn unlocks */
  unlockLimiters: RequestHandler[];
}

type ForkInput = Partial<SnippetInput>;

export function snippetsRouter(deps: SnippetsRouterDeps): Router {
  const { config, snippets, requireAuth, optionalAuth, writeLimiter, unlockLimiters } = deps;
  const router = Router();

  const isOwner = (record: SnippetRecord, req: Request) => record.userId === req.user?.id;

  function find(req: Request): SnippetRecord | undefined {
    const shareId = req.params.shareId;
    return typeof shareId === 'string' && SHARE_ID_PATTERN.test(shareId) ? snippets.findByShareId(shareId) : undefined;
  }

  // Private bins answer 404 like unknown (or expired) ones, so their existence doesn't leak.
  function load(req: Request): SnippetRecord {
    const record = find(req);
    if (!record || (record.visibility === 'private' && !isOwner(record, req))) {
      throw new HttpError(404, 'Snippet not found');
    }
    return record;
  }

  function loadOwned(req: Request): SnippetRecord {
    const record = load(req);
    if (!isOwner(record, req)) throw new HttpError(403, 'You do not own this snippet');
    return record;
  }

  /**
   * The bin's own settings are the only thing that decides who reads it. Burn-after-read bins are
   * never sent on a GET (link previewers and double-fetches would burn them); only POST /unlock.
   */
  function canReadNow(record: SnippetRecord, req: Request): boolean {
    if (isOwner(record, req)) return true;
    if (record.visibility === 'private' || record.burnAfterRead) return false;
    if (record.visibility === 'password') {
      return hasUnlockToken(config, 'snippet', record, req.get(UNLOCK_TOKEN_HEADER));
    }
    return true;
  }

  function lockReason(record: SnippetRecord): LockReason {
    if (record.visibility === 'password') return record.burnAfterRead ? 'password+burn' : 'password';
    return 'burn';
  }

  /** Applies a settings request on top of `base`. Passwords are hashed here and never stored raw. */
  async function resolveSettings(input: SnippetSettingsInput, base: SnippetSettings): Promise<SnippetSettings> {
    const visibility = input.visibility ?? base.visibility;
    let passwordHash: string | null = null;
    if (visibility === 'password') {
      if (input.password) passwordHash = await bcrypt.hash(input.password, config.BCRYPT_ROUNDS);
      else if (base.passwordHash) passwordHash = base.passwordHash;
      else {
        throw new HttpError(400, 'Validation failed', [
          { path: 'password', message: 'A password is required for password-protected bins' },
        ]);
      }
    }
    const expiresAt =
      input.expiresIn === undefined
        ? base.expiresAt
        : input.expiresIn === 'never'
          ? null
          : new Date(Date.now() + EXPIRATIONS[input.expiresIn]).toISOString();
    return { visibility, passwordHash, expiresAt, burnAfterRead: input.burnAfterRead ?? base.burnAfterRead };
  }

  const settingsOf = (r: SnippetRecord): SnippetSettings => ({
    visibility: r.visibility,
    passwordHash: r.passwordHash,
    expiresAt: r.expiresAt,
    burnAfterRead: r.burnAfterRead,
  });

  router.get('/', requireAuth, (req, res) => {
    const body: SnippetListResponse = { snippets: snippets.listByUser(req.user!.id) };
    res.json(body);
  });

  router.post('/', requireAuth, writeLimiter, validateBody(createSnippetSchema), async (req, res) => {
    const { settings, ...content } = req.body as CreateSnippetRequest;
    const record = snippets.create(req.user!.id, content, await resolveSettings(settings ?? {}, DEFAULT_SETTINGS));
    const body: Snippet = toSnippet(record, req.user!.id, []);
    res.status(201).json(body);
  });

  router.get('/:shareId', optionalAuth, (req, res) => {
    const record = load(req);
    if (!canReadNow(record, req)) {
      const body: LockedSnippet = { locked: true, reason: lockReason(record), shareId: record.shareId, title: record.title };
      res.json(body);
      return;
    }
    const owner = isOwner(record, req);
    res.json(toSnippet(record, req.user?.id, owner ? snippets.collectionsOf(record.id) : undefined));
  });

  router.post('/:shareId/unlock', ...unlockLimiters, optionalAuth, validateBody(unlockSnippetSchema), async (req, res) => {
    const record = load(req);
    if (canReadNow(record, req)) throw new HttpError(404, 'This snippet is not locked');
    if (record.visibility === 'password') {
      const { password } = req.body as UnlockSnippetRequest;
      // 403, not 401: a 401 means "your login is bad" to the client and would sign a logged-in visitor out.
      if (!password || !(await bcrypt.compare(password, record.passwordHash!))) {
        throw new HttpError(403, 'Invalid password');
      }
    }
    const snippet = toSnippet(record, req.user?.id);
    if (record.burnAfterRead) {
      // Only the request that actually deleted the row gets the content.
      if (!snippets.burn(record.id)) throw new HttpError(404, 'Snippet not found');
      const body: UnlockSnippetResponse = { snippet, burned: true };
      res.json(body);
      return;
    }
    const body: UnlockSnippetResponse = { snippet, burned: false, ...signUnlockToken(config, 'snippet', record) };
    res.json(body);
  });

  // Ownership is checked before validating the body so non-owners learn nothing from validation errors.
  const ownerFirst: RequestHandler = (req, _res, next) => {
    loadOwned(req);
    next();
  };

  router.put('/:shareId', requireAuth, writeLimiter, ownerFirst, validateBody(snippetInputSchema), (req, res) => {
    const updated = snippets.update(loadOwned(req), req.body as SnippetInput);
    const body: Snippet = toSnippet(updated, req.user!.id, snippets.collectionsOf(updated.id));
    res.json(body);
  });

  // Settings only, so they apply at once without touching (or requiring a save of) the code.
  router.patch('/:shareId', requireAuth, writeLimiter, ownerFirst, validateBody(snippetSettingsSchema), async (req, res) => {
    const existing = loadOwned(req);
    const settings = await resolveSettings(req.body as SnippetSettingsInput, settingsOf(existing));
    const updated = snippets.updateSettings(existing, settings);
    const body: Snippet = toSnippet(updated, req.user!.id, snippets.collectionsOf(updated.id));
    res.json(body);
  });

  router.delete('/:shareId', requireAuth, writeLimiter, (req, res) => {
    snippets.delete(loadOwned(req).id);
    res.status(204).end();
  });

  // Anyone who can read a bin can copy it, so forking needs exactly read access.
  router.post('/:shareId/fork', requireAuth, writeLimiter, validateBody(forkInputSchema), (req, res) => {
    const source = load(req);
    if (!canReadNow(source, req)) throw new HttpError(404, 'Snippet not found');
    const overrides = req.body as ForkInput;
    // Re-validate the merged result: overrides plus inherited code can exceed the combined limit.
    const input: SnippetInput = snippetInputSchema.parse({
      title: overrides.title ?? `${source.title} (fork)`.slice(0, LIMITS.titleMax),
      html: overrides.html ?? source.html,
      css: overrides.css ?? source.css,
      js: overrides.js ?? source.js,
    });
    // Owners keep who-can-see-it on their own copies; anyone else starts from a plain unlisted bin.
    const settings: SnippetSettings = isOwner(source, req)
      ? { ...DEFAULT_SETTINGS, visibility: source.visibility, passwordHash: source.passwordHash }
      : DEFAULT_SETTINGS;
    const record = snippets.create(req.user!.id, input, settings, source.id);
    const body: Snippet = toSnippet(record, req.user!.id, []);
    res.status(201).json(body);
  });

  return router;
}
