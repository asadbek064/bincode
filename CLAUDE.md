# CLAUDE.md — guide for AI assistants working on BinCode

## What this is
BinCode is a self-hostable JSFiddle alternative. Users write HTML/CSS/JS snippets ("bins") with a live preview and share them by link. Bins are unlisted (link = access) or private (owner only), and can be grouped into collections that are owner-only or unlocked by link + password. Accounts are created **only** via the CLI (`pnpm add-user`) — no self sign-up, by design.

## Stack
- **Language**: TypeScript everywhere (ESM, `"type": "module"`), single `package.json`, pnpm
- **Server**: Express 5, run with `tsx` (also in production — there is no server build/emit step)
- **Database**: built-in `node:sqlite` (`DatabaseSync`, synchronous) — Node ≥ 22.13
- **Validation**: zod 4 schemas in `src/shared/schemas.ts`
- **Auth**: HS256 JWT (`jsonwebtoken`), passwords via `bcryptjs`
- **Security headers / limits**: helmet 8, express-rate-limit 8
- **Client**: React 19 + Vite 7, `@monaco-editor/react` with locally bundled `monaco-editor` (no CDN)
- **Tests**: `node:test` + supertest against an in-memory database

## Layout
```
src/shared/          The API contract — imported by both server and client
  api.ts             DTO / request / response types (+ endpoint list)
  constants.ts       LIMITS, share-id format, VISIBILITIES, COLLECTION_TOKEN_HEADER, preview paths & message types
  schemas.ts         zod schemas (server-only; client must not import it → keeps zod out of the bundle)
src/server/
  index.ts           Entry: loads .env, config, opens DB, listens; graceful SIGINT/SIGTERM shutdown
  app.ts             createApp({ db, config, clientDir, limits }) — used by tests too
  config.ts          loadConfig() (full) and loadDbConfig() (no JWT; used by add-user)
  db.ts              openDb(file | ':memory:') + base schema + PRAGMA user_version migrations
  repos/             users.ts (DuplicateEmailError), snippets.ts (toSnippet/toSummary DTO mapping),
                     collections.ts (membership, password_version)
  middleware/
    auth.ts          createAuth(config, users) → { requireAuth, optionalAuth }; signToken(config, userId);
                     signCollectionToken / verifyCollectionToken (collection unlock tokens)
    validate.ts      validateBody(schema) — replaces req.body with the parsed value
    error.ts         HttpError, notFound, errorHandler
    security.ts      securityHeaders() (app vs preview CSP), vendorCorp, createRateLimiters(limits)
  routes/            auth.ts, snippets.ts, collections.ts
src/client/
  index.html         Vite entry (no inline scripts — strict CSP)
  public/            Copied as-is: preview.html, vendor/eruda.min.js, logo/, favicon.ico
  src/
    main.tsx, App.tsx, styles.css
    components/      Toolbar, Icons, EditorPane (lazy), PreviewPane, SplitPane, Modal,
                     LoginModal, ShareModal, SnippetsDashboard (collections sidebar), CollectionForm,
                     CollectionView (password gate), DraftBanner, Toast
    hooks/           useAuth, useSnippetEditor, useLocalDraft, useKeyboardShortcuts,
                     useColorScheme, useDebouncedValue
    lib/             api (typed fetch client, ApiError), previewDoc, monaco (workers),
                     drafts, storage (safe localStorage), collectionTokens (sessionStorage),
                     url, clipboard, template, time
scripts/add-user.ts  CLI user creation
test/                *.test.ts, helpers.ts (makeApp), fixtures/client
```

## Commands
```bash
pnpm install
pnpm dev               # API on :3000 (tsx watch) + Vite on :5173 (proxies /api)
pnpm build             # client → dist/client
pnpm start             # production: API + static dist/client
pnpm test              # all tests
pnpm typecheck         # tsc for server (tsconfig.json) and client (src/client/tsconfig.json)
pnpm add-user <email>  # prompts for password; or: printf 'pw\n' | pnpm add-user <email>
```
Always run `pnpm typecheck && pnpm test` (and `pnpm build` for client changes) before committing.

## Architecture notes

### Request flow
routes → middleware (`requireAuth` / `optionalAuth`, `validateBody(schema)`) → repos → SQLite. Express 5 forwards async errors, so handlers just `throw new HttpError(status, msg)`; `errorHandler` turns everything into `ApiErrorBody` JSON.

Behaviours worth knowing:
- `/api/health` is mounted **outside** the API rate limiter so monitoring can't trip it.
- `PUT` checks ownership **before** validating the body, so non-owners always get 403.
- Fork merges overrides with the source and re-validates the result with `snippetInputSchema` (inherited code + overrides could exceed the 500K cap).
- Login compares against a dummy bcrypt hash for unknown emails (no timing-based user enumeration) and always answers `401 Invalid email or password`.
- `updatedAt` is bumped by ≥1ms on every update, and lists are ordered by `updated_at DESC` with insertion order as tiebreaker.
- Body-parser errors map to JSON: malformed JSON → 400, body > 2MB → 413.
- `PUT /api/snippets/:id` keeps the stored `visibility` when the body omits it; forks inherit the source's visibility unless overridden.

### Access rules (security-critical)
- **Private bins** answer 404 (never 403) to everyone but the owner, including PUT/DELETE/fork, so their existence doesn't leak. A fork's `forkedFrom` is masked to `null` when the source is private and the viewer isn't the source's owner.
- **Collections** are owner-only when `password_hash IS NULL` (404 to others, unlock → 404). With a password, a non-owner's `GET` returns exactly `{ locked: true, shareId, title }` — no description, no bins — until `POST /:id/unlock` succeeds. Wrong password → **403** (not 401: the client treats 401 as "log out").
- Unlock returns a 12h HS256 JWT with `aud: 'bincode:collection'`, `sub: collection.id`, `pv: password_version`. It is sent as `X-Collection-Token` (never as Bearer). User tokens must have no `aud`; `authenticate` rejects tokens that carry one, and `verifyCollectionToken` requires it — the two are not interchangeable.
- Changing or removing a collection password bumps `password_version`, which revokes every outstanding unlock token.
- A valid collection token lets `GET /api/snippets/:id` read a **private** bin that is a member of that (still password-protected) collection. It does not grant fork, edit or anything else.
- Membership: both the collection and the bin must belong to the caller. Deleting a collection keeps its bins; deleting a bin cascades its memberships.

### Rate limits (`createRateLimiters` in `middleware/security.ts`)
| Limiter | Default | Key | Applies to |
|---|---|---|---|
| `api` | 300/min | IP | all of `/api` except `/api/health` |
| `login` | 10 failures / 15 min | IP | `POST /api/auth/login` |
| `loginEmail` | 20 failures / 15 min | normalized email | `POST /api/auth/login` (stops distributed guessing; can lock one account out) |
| `unlock` | 10 failures / 15 min | IP | `POST /api/collections/:id/unlock` |
| `unlockCollection` | 50 failures / hour | collection shareId | same (stops distributed guessing; owners never need to unlock) |
| `writes` | 60/min | user id | every POST/PUT/DELETE on snippets and collections (after `requireAuth`) |

Custom key generators that fall back to the IP must call `ipKeyGenerator(req.ip)` **inline** — express-rate-limit inspects the function source and warns otherwise. Client-supplied identifiers (device fingerprints, etc.) are deliberately not used as keys: they are forgeable, so they only weaken limits.

### Data model
- `users(id, email UNIQUE, password_hash, created_at)`
- `snippets(id, share_id UNIQUE, user_id → users ON DELETE CASCADE, title, html, css, js, visibility CHECK IN ('unlisted','private'), forked_from → snippets ON DELETE SET NULL, created_at, updated_at)`
- `collections(id, share_id UNIQUE, user_id → users ON DELETE CASCADE, title, description, password_hash NULL, password_version, created_at, updated_at)`
- `collection_snippets(collection_id → collections CASCADE, snippet_id → snippets CASCADE, added_at, PK(collection_id, snippet_id))` — many-to-many
- The internal `id`s and password hashes never leave the server. Clients only see `shareId` (10-char nanoid); `forkedFrom` is the source's `shareId`.
- Migrations: `SCHEMA` in `db.ts` is v0 (`CREATE TABLE IF NOT EXISTS`); `MIGRATIONS[i]` upgrades to version `i + 1`, each in a transaction, tracked in `PRAGMA user_version`. Append new entries; never edit one that shipped. `test/migration.test.ts` upgrades a real v0 file.

### Preview isolation (security-critical)
- The preview is `<iframe src="/preview.html" sandbox="allow-scripts allow-modals allow-forms allow-popups">` — **never add `allow-same-origin`**; the opaque origin is what stops snippet code from reading the app's `localStorage` token.
- `preview.html` posts `{type:'bincode:ready'}` to the parent; the parent replies `{type:'bincode:render', doc}` and the frame `document.write`s it. The iframe is remounted for every render.
- The document is built by the pure function `src/client/src/lib/previewDoc.ts` (escapes `</script` / `</style`, optionally injects Eruda).
- `srcdoc` is intentionally not used: it would inherit the app's strict CSP and block snippet scripts. `/preview.html` gets its own permissive CSP; `/vendor/*` sends `Cross-Origin-Resource-Policy: cross-origin` so the opaque-origin frame can load Eruda.

### Client
- No router: `?share=<id>[&c=<collectionId>]` and `?collection=<id>` + `history.pushState` / `popstate` (`lib/url.ts`). `c` names the collection a bin was opened from so its unlock token (sessionStorage `bincode:ctok:<id>`, tab-scoped on purpose) is sent on reload; a 404 with `c` set sends the visitor back to that collection's gate.
- State: `AuthProvider` (token in `localStorage['bincode:token']`, validated via `/api/auth/me`) and the `useSnippetEditor` reducer. No state library.
- Save: not logged in → login then retry; owner → PUT (same link); someone else's → fork; new → POST.
- Drafts: `localStorage['bincode:draft:<shareId|new>']`, debounced, restored/offered via `DraftBanner`, cleared on save. Drafts carry `visibility` (optional for older drafts).
- Someone else's private bin (seen through a collection) can't be saved or forked: the toolbar disables Save.
- Monaco is code-split (lazy `EditorPane`) and its workers are bundled with Vite `?worker` imports (`lib/monaco.ts`).

## Conventions
- 2-space indent, single quotes, semicolons; comments explain *why*.
- Relative imports include the extension (`./app.ts`, `./App.tsx`) — `allowImportingTsExtensions` + `verbatimModuleSyntax` (use `import type` for types).
- New endpoint: add types to `src/shared/api.ts` (and a schema to `schemas.ts`) first, then route + repo, then tests in `test/`.
- Validate every request body with `validateBody(schema)`; store user content raw (React escapes on render) — never "sanitize" snippet code.
- Use parameterized prepared statements only.
- Check ownership for any mutation (`403` for non-owners, `404` for unknown/malformed share ids — and for private bins / owner-only collections the caller can't see).
- Never log passwords or tokens. `add-user` must not echo the password.
- `index.html` must not contain inline scripts (CSP `script-src 'self'`).

## Testing
`test/helpers.ts` → `makeApp(opts?)` builds an app with an in-memory DB, bcrypt cost 4 and seeded users (`alice@example.com`, `bob@example.com` / `password123`). It returns `{ app, db, config, users, seeded, tokenFor(email) }`. The API rate limit defaults to 10,000 in tests; rate-limit tests pass lower `limits`. Each test creates its own app, so tests are independent. Static/CSP tests use `test/fixtures/client`.

Also `createCollection(t, email, body?)` and `addToCollection(t, email, collectionId, snippetId)`. Tests that simulate several client IPs set `env: { TRUST_PROXY: '1' }` and send `X-Forwarded-For` (`'true'` triggers an express-rate-limit warning). `writes` also defaults to 10,000 in tests.

Test files: `auth.test.ts`, `snippets.test.ts`, `fork.test.ts`, `visibility.test.ts`, `collections.test.ts`, `migration.test.ts`, `http.test.ts` (headers, static, 404/400 JSON), `previewDoc.test.ts` (unit test of the client's pure preview builder — keep `previewDoc.ts` free of DOM imports; it is included in the server tsconfig for this reason).

## Gotchas
- `node:sqlite` is flagged experimental; scripts pass `--disable-warning=ExperimentalWarning`.
- Snippets get in-memory `localStorage`/`sessionStorage` shims (`STORAGE_SHIM` in `previewDoc.ts`) because real storage throws in the opaque-origin sandbox; data resets on every re-render and cookies are unavailable. This is intended.
- Rate limits are in-memory per process; restarting resets them.
- JWTs are stateless: logout is client-side and tokens remain valid until expiry (deleting the user invalidates them).
- `JWT_SECRET` must be ≥ 32 chars when `NODE_ENV=production`.
- `@vitejs/plugin-react` is pinned to `^5` because v6 requires Vite 8. Upgrade both together.
- `pnpm start` serves `dist/client`; without `pnpm build` the app responds "Client not built".

## Environment variables
| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `production` \| `test` |
| `PORT` | `3000` | |
| `JWT_SECRET` | — | Required by the server (not by `add-user`); ≥ 32 chars in production |
| `JWT_EXPIRES_IN` | `7d` | |
| `DB_FILE` | `./bincode.db` | |
| `TRUST_PROXY` | `false` | `false`/empty, `true`, a hop count, or a string such as `loopback` / CIDR |
| `BCRYPT_ROUNDS` | `10` | 4–15 |

See `.env.example`.
