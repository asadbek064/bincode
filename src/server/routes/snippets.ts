import { Router, type Request, type RequestHandler } from 'express';
import type { Snippet, SnippetInput, SnippetListResponse } from '../../shared/api.ts';
import { COLLECTION_TOKEN_HEADER, LIMITS, SHARE_ID_PATTERN } from '../../shared/constants.ts';
import { forkInputSchema, snippetInputSchema } from '../../shared/schemas.ts';
import type { Config } from '../config.ts';
import { verifyCollectionToken } from '../middleware/auth.ts';
import { HttpError } from '../middleware/error.ts';
import { validateBody } from '../middleware/validate.ts';
import type { CollectionsRepo } from '../repos/collections.ts';
import { toSnippet, type SnippetRecord, type SnippetsRepo } from '../repos/snippets.ts';

interface SnippetsRouterDeps {
  config: Config;
  snippets: SnippetsRepo;
  collections: CollectionsRepo;
  requireAuth: RequestHandler;
  optionalAuth: RequestHandler;
  writeLimiter: RequestHandler;
}

type ForkInput = Partial<SnippetInput>;

export function snippetsRouter(deps: SnippetsRouterDeps): Router {
  const { config, snippets, collections, requireAuth, optionalAuth, writeLimiter } = deps;
  const router = Router();

  function find(req: Request): SnippetRecord | undefined {
    const shareId = req.params.shareId;
    return typeof shareId === 'string' && SHARE_ID_PATTERN.test(shareId) ? snippets.findByShareId(shareId) : undefined;
  }

  /** Unlisted bins are readable by link; private ones only by their owner. */
  function canRead(record: SnippetRecord, req: Request): boolean {
    return record.visibility === 'unlisted' || record.userId === req.user?.id;
  }

  /** A private bin is also readable through an unlocked, still password-protected collection containing it. */
  function unlockedViaCollection(record: SnippetRecord, req: Request): boolean {
    const grant = verifyCollectionToken(config, req.get(COLLECTION_TOKEN_HEADER));
    if (!grant) return false;
    const collection = collections.findById(grant.collectionId);
    return (
      collection !== undefined &&
      collection.passwordHash !== null &&
      collection.passwordVersion === grant.passwordVersion &&
      collection.userId === record.userId &&
      snippets.isInCollection(record.id, collection.id)
    );
  }

  // Unreadable private bins answer 404 like unknown ones, so their existence doesn't leak.
  function load(req: Request): SnippetRecord {
    const record = find(req);
    if (!record || !canRead(record, req)) throw new HttpError(404, 'Snippet not found');
    return record;
  }

  function loadOwned(req: Request): SnippetRecord {
    const record = load(req);
    if (record.userId !== req.user!.id) throw new HttpError(403, 'You do not own this snippet');
    return record;
  }

  router.get('/', requireAuth, (req, res) => {
    const body: SnippetListResponse = { snippets: snippets.listByUser(req.user!.id) };
    res.json(body);
  });

  router.post('/', requireAuth, writeLimiter, validateBody(snippetInputSchema), (req, res) => {
    const record = snippets.create(req.user!.id, req.body as SnippetInput);
    const body: Snippet = toSnippet(record, req.user!.id, []);
    res.status(201).json(body);
  });

  router.get('/:shareId', optionalAuth, (req, res) => {
    const record = find(req);
    if (!record || !(canRead(record, req) || unlockedViaCollection(record, req))) {
      throw new HttpError(404, 'Snippet not found');
    }
    const isOwner = record.userId === req.user?.id;
    const body: Snippet = toSnippet(record, req.user?.id, isOwner ? snippets.collectionsOf(record.id) : undefined);
    res.json(body);
  });

  // Ownership is checked before validating the body so non-owners learn nothing from validation errors.
  router.put('/:shareId', requireAuth, writeLimiter, (req, _res, next) => {
    loadOwned(req);
    next();
  }, validateBody(snippetInputSchema), (req, res) => {
    const updated = snippets.update(loadOwned(req), req.body as SnippetInput);
    const body: Snippet = toSnippet(updated, req.user!.id, snippets.collectionsOf(updated.id));
    res.json(body);
  });

  router.delete('/:shareId', requireAuth, writeLimiter, (req, res) => {
    snippets.delete(loadOwned(req).id);
    res.status(204).end();
  });

  // Forking needs plain read access: an unlocked collection lets visitors view private bins, not copy them.
  router.post('/:shareId/fork', requireAuth, writeLimiter, validateBody(forkInputSchema), (req, res) => {
    const source = load(req);
    const overrides = req.body as ForkInput;
    // Re-validate the merged result: overrides plus inherited code can exceed the combined limit.
    const input: SnippetInput = snippetInputSchema.parse({
      title: overrides.title ?? `${source.title} (fork)`.slice(0, LIMITS.titleMax),
      html: overrides.html ?? source.html,
      css: overrides.css ?? source.css,
      js: overrides.js ?? source.js,
      visibility: overrides.visibility ?? source.visibility,
    });
    const record = snippets.create(req.user!.id, input, source.id);
    const body: Snippet = toSnippet(record, req.user!.id, []);
    res.status(201).json(body);
  });

  return router;
}
