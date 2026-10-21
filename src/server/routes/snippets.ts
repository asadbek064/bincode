import { Router, type Request, type RequestHandler } from 'express';
import type { Snippet, SnippetInput, SnippetListResponse } from '../../shared/api.ts';
import { LIMITS, SHARE_ID_PATTERN } from '../../shared/constants.ts';
import { forkInputSchema, snippetInputSchema } from '../../shared/schemas.ts';
import { HttpError } from '../middleware/error.ts';
import { validateBody } from '../middleware/validate.ts';
import { toSnippet, type SnippetRecord, type SnippetsRepo } from '../repos/snippets.ts';

interface SnippetsRouterDeps {
  snippets: SnippetsRepo;
  requireAuth: RequestHandler;
  optionalAuth: RequestHandler;
}

type ForkInput = Partial<SnippetInput>;

export function snippetsRouter({ snippets, requireAuth, optionalAuth }: SnippetsRouterDeps): Router {
  const router = Router();

  function load(req: Request): SnippetRecord {
    const shareId = req.params.shareId;
    const record = typeof shareId === 'string' && SHARE_ID_PATTERN.test(shareId) ? snippets.findByShareId(shareId) : undefined;
    if (!record) throw new HttpError(404, 'Snippet not found');
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

  router.post('/', requireAuth, validateBody(snippetInputSchema), (req, res) => {
    const record = snippets.create(req.user!.id, req.body as SnippetInput);
    const body: Snippet = toSnippet(record, req.user!.id);
    res.status(201).json(body);
  });

  router.get('/:shareId', optionalAuth, (req, res) => {
    const body: Snippet = toSnippet(load(req), req.user?.id);
    res.json(body);
  });

  // Ownership is checked before validating the body so non-owners learn nothing from validation errors.
  router.put('/:shareId', requireAuth, (req, _res, next) => {
    loadOwned(req);
    next();
  }, validateBody(snippetInputSchema), (req, res) => {
    const updated = snippets.update(loadOwned(req), req.body as SnippetInput);
    const body: Snippet = toSnippet(updated, req.user!.id);
    res.json(body);
  });

  router.delete('/:shareId', requireAuth, (req, res) => {
    snippets.delete(loadOwned(req).id);
    res.status(204).end();
  });

  router.post('/:shareId/fork', requireAuth, validateBody(forkInputSchema), (req, res) => {
    const source = load(req);
    const overrides = req.body as ForkInput;
    // Re-validate the merged result: overrides plus inherited code can exceed the combined limit.
    const input: SnippetInput = snippetInputSchema.parse({
      title: overrides.title ?? `${source.title} (fork)`.slice(0, LIMITS.titleMax),
      html: overrides.html ?? source.html,
      css: overrides.css ?? source.css,
      js: overrides.js ?? source.js,
    });
    const record = snippets.create(req.user!.id, input, source.id);
    const body: Snippet = toSnippet(record, req.user!.id);
    res.status(201).json(body);
  });

  return router;
}
