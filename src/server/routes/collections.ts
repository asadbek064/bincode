import bcrypt from 'bcryptjs';
import { Router, type Request, type RequestHandler } from 'express';
import type {
  CollectionInput,
  CollectionListResponse,
  CollectionResponse,
  CollectionSummary,
  UnlockRequest,
  UnlockResponse,
} from '../../shared/api.ts';
import { SHARE_ID_PATTERN, UNLOCK_TOKEN_HEADER } from '../../shared/constants.ts';
import { collectionInputSchema, unlockSchema } from '../../shared/schemas.ts';
import type { Config } from '../config.ts';
import { hasUnlockToken, signUnlockToken } from '../middleware/auth.ts';
import { HttpError } from '../middleware/error.ts';
import { validateBody } from '../middleware/validate.ts';
import { toCollectionSummary, type CollectionData, type CollectionRecord, type CollectionsRepo } from '../repos/collections.ts';
import type { SnippetRecord, SnippetsRepo } from '../repos/snippets.ts';

interface CollectionsRouterDeps {
  config: Config;
  collections: CollectionsRepo;
  snippets: SnippetsRepo;
  requireAuth: RequestHandler;
  optionalAuth: RequestHandler;
  writeLimiter: RequestHandler;
  /** per-IP and per-collection limiters for password attempts */
  unlockLimiters: RequestHandler[];
}

export function collectionsRouter(deps: CollectionsRouterDeps): Router {
  const { config, collections, snippets, requireAuth, optionalAuth, writeLimiter, unlockLimiters } = deps;
  const router = Router();

  function find(req: Request): CollectionRecord | undefined {
    const shareId = req.params.shareId;
    return typeof shareId === 'string' && SHARE_ID_PATTERN.test(shareId) ? collections.findByShareId(shareId) : undefined;
  }

  /** Owner-only collections are invisible to everyone else: 404, like an unknown id. */
  function load(req: Request): CollectionRecord {
    const record = find(req);
    if (!record || (record.passwordHash === null && record.userId !== req.user?.id)) {
      throw new HttpError(404, 'Collection not found');
    }
    return record;
  }

  function loadOwned(req: Request): CollectionRecord {
    const record = load(req);
    if (record.userId !== req.user!.id) throw new HttpError(403, 'You do not own this collection');
    return record;
  }

  function loadOwnedSnippet(req: Request): SnippetRecord {
    const shareId = req.params.snippetShareId;
    const record = typeof shareId === 'string' && SHARE_ID_PATTERN.test(shareId) ? snippets.findByShareId(shareId) : undefined;
    if (!record || (record.visibility === 'private' && record.userId !== req.user!.id)) {
      throw new HttpError(404, 'Snippet not found');
    }
    if (record.userId !== req.user!.id) throw new HttpError(403, 'You do not own this snippet');
    return record;
  }

  function isUnlocked(record: CollectionRecord, req: Request): boolean {
    return record.passwordHash !== null && hasUnlockToken(config, 'collection', record, req.get(UNLOCK_TOKEN_HEADER));
  }

  async function toData(input: CollectionInput): Promise<CollectionData> {
    const passwordHash =
      input.password === undefined
        ? undefined
        : input.password === null
          ? null
          : await bcrypt.hash(input.password, config.BCRYPT_ROUNDS);
    return { title: input.title, description: input.description, passwordHash };
  }

  router.get('/', requireAuth, (req, res) => {
    const body: CollectionListResponse = {
      collections: collections.listByUser(req.user!.id).map(toCollectionSummary),
    };
    res.json(body);
  });

  router.post('/', requireAuth, writeLimiter, validateBody(collectionInputSchema), async (req, res) => {
    const record = collections.create(req.user!.id, await toData(req.body as CollectionInput));
    const body: CollectionSummary = toCollectionSummary(record);
    res.status(201).json(body);
  });

  router.get('/:shareId', optionalAuth, (req, res) => {
    const record = load(req);
    const isOwner = record.userId === req.user?.id;
    // Nothing but the title goes out before the password is verified.
    if (!isOwner && !isUnlocked(record, req)) {
      const body: CollectionResponse = { locked: true, shareId: record.shareId, title: record.title };
      res.json(body);
      return;
    }
    // The password unlocks the list, not the bins: visitors never see private ones, not even their count.
    const list = collections.listSnippets(record.id, req.user?.id, { includePrivate: isOwner });
    const body: CollectionResponse = {
      locked: false,
      isOwner,
      collection: { ...toCollectionSummary(record), snippetCount: list.length },
      snippets: list,
    };
    res.json(body);
  });

  // Ownership is checked before validating the body so non-owners learn nothing from validation errors.
  router.put('/:shareId', requireAuth, writeLimiter, (req, _res, next) => {
    loadOwned(req);
    next();
  }, validateBody(collectionInputSchema), async (req, res) => {
    const data = await toData(req.body as CollectionInput);
    const body: CollectionSummary = toCollectionSummary(collections.update(loadOwned(req), data));
    res.json(body);
  });

  router.delete('/:shareId', requireAuth, writeLimiter, (req, res) => {
    collections.delete(loadOwned(req).id);
    res.status(204).end();
  });

  router.put('/:shareId/snippets/:snippetShareId', requireAuth, writeLimiter, (req, res) => {
    const collection = loadOwned(req);
    collections.addSnippet(collection, loadOwnedSnippet(req).id);
    res.status(204).end();
  });

  router.delete('/:shareId/snippets/:snippetShareId', requireAuth, writeLimiter, (req, res) => {
    const collection = loadOwned(req);
    collections.removeSnippet(collection, loadOwnedSnippet(req).id);
    res.status(204).end();
  });

  router.post('/:shareId/unlock', ...unlockLimiters, validateBody(unlockSchema), async (req, res) => {
    const record = find(req);
    // Owner-only collections can't be unlocked, and say so the same way unknown ids do.
    if (!record || record.passwordHash === null) throw new HttpError(404, 'Collection not found');
    const { password } = req.body as UnlockRequest;
    // 403, not 401: a 401 means "your login is bad" to the client and would sign a logged-in visitor out.
    if (!(await bcrypt.compare(password, record.passwordHash))) throw new HttpError(403, 'Invalid password');
    const body: UnlockResponse = signUnlockToken(config, 'collection', record);
    res.json(body);
  });

  return router;
}
