# CLAUDE.md — guide for AI assistants working on BinCode

## What this is
BinCode is a self-hostable JSFiddle alternative. Users write HTML/CSS/JS snippets with a live preview and share them by link. Accounts are created **only** via the CLI (`pnpm add-user`) — no self sign-up, by design.

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
  constants.ts       LIMITS, share-id format, preview paths & message types
  schemas.ts         zod schemas (server-only; client must not import it → keeps zod out of the bundle)
src/server/
  index.ts           Entry: loads .env, config, opens DB, listens; graceful SIGINT/SIGTERM shutdown
  app.ts             createApp({ db, config, clientDir, limits }) — used by tests too
  config.ts          loadConfig() (full) and loadDbConfig() (no JWT; used by add-user)
  db.ts              openDb(file | ':memory:') + schema
  repos/             users.ts (DuplicateEmailError), snippets.ts (toSnippet DTO mapping)
  middleware/
    auth.ts          createAuth(config, users) → { requireAuth, optionalAuth }; signToken(config, userId)
    validate.ts      validateBody(schema) — replaces req.body with the parsed value
    error.ts         HttpError, notFound, errorHandler
    security.ts      securityHeaders() (app vs preview CSP), vendorCorp, createRateLimiters(limits)
  routes/            auth.ts, snippets.ts
src/client/
  index.html         Vite entry (no inline scripts — strict CSP)
  public/            Copied as-is: preview.html, vendor/eruda.min.js, logo/, favicon.ico
  src/
    main.tsx, App.tsx, styles.css
    components/      Toolbar, Icons, EditorPane (lazy), PreviewPane, SplitPane, Modal,
                     LoginModal, ShareModal, SnippetsDashboard, DraftBanner, Toast
    hooks/           useAuth, useSnippetEditor, useLocalDraft, useKeyboardShortcuts,
                     useColorScheme, useDebouncedValue
    lib/             api (typed fetch client, ApiError), previewDoc, monaco (workers),
                     drafts, storage (safe localStorage), url, clipboard, template, time
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

### Data model
- `users(id, email UNIQUE, password_hash, created_at)`
- `snippets(id, share_id UNIQUE, user_id → users ON DELETE CASCADE, title, html, css, js, forked_from → snippets ON DELETE SET NULL, created_at, updated_at)`
- The internal `id` never leaves the server. Clients only see `shareId` (10-char nanoid); `forkedFrom` is the source's `shareId`.
- No migrations: schema is `CREATE TABLE IF NOT EXISTS` in `db.ts`. A schema change currently means deleting the DB file (or adding a migration keyed on `PRAGMA user_version`).

### Preview isolation (security-critical)
- The preview is `<iframe src="/preview.html" sandbox="allow-scripts allow-modals allow-forms allow-popups">` — **never add `allow-same-origin`**; the opaque origin is what stops snippet code from reading the app's `localStorage` token.
- `preview.html` posts `{type:'bincode:ready'}` to the parent; the parent replies `{type:'bincode:render', doc}` and the frame `document.write`s it. The iframe is remounted for every render.
- The document is built by the pure function `src/client/src/lib/previewDoc.ts` (escapes `</script` / `</style`, optionally injects Eruda).
- `srcdoc` is intentionally not used: it would inherit the app's strict CSP and block snippet scripts. `/preview.html` gets its own permissive CSP; `/vendor/*` sends `Cross-Origin-Resource-Policy: cross-origin` so the opaque-origin frame can load Eruda.

### Client
- No router: `?share=<id>` + `history.pushState` / `popstate` (`lib/url.ts`).
- State: `AuthProvider` (token in `localStorage['bincode:token']`, validated via `/api/auth/me`) and the `useSnippetEditor` reducer. No state library.
- Save: not logged in → login then retry; owner → PUT (same link); someone else's → fork; new → POST.
- Drafts: `localStorage['bincode:draft:<shareId|new>']`, debounced, restored/offered via `DraftBanner`, cleared on save.
- Monaco is code-split (lazy `EditorPane`) and its workers are bundled with Vite `?worker` imports (`lib/monaco.ts`).

## Conventions
- 2-space indent, single quotes, semicolons; comments explain *why*.
- Relative imports include the extension (`./app.ts`, `./App.tsx`) — `allowImportingTsExtensions` + `verbatimModuleSyntax` (use `import type` for types).
- New endpoint: add types to `src/shared/api.ts` (and a schema to `schemas.ts`) first, then route + repo, then tests in `test/`.
- Validate every request body with `validateBody(schema)`; store user content raw (React escapes on render) — never "sanitize" snippet code.
- Use parameterized prepared statements only.
- Check ownership for any mutation (`403` for non-owners, `404` for unknown/malformed share ids).
- Never log passwords or tokens. `add-user` must not echo the password.
- `index.html` must not contain inline scripts (CSP `script-src 'self'`).

## Testing
`test/helpers.ts` → `makeApp(opts?)` builds an app with an in-memory DB, bcrypt cost 4 and seeded users (`alice@example.com`, `bob@example.com` / `password123`). It returns `{ app, db, config, users, seeded, tokenFor(email) }`. The API rate limit defaults to 10,000 in tests; rate-limit tests pass lower `limits`. Each test creates its own app, so tests are independent. Static/CSP tests use `test/fixtures/client`.

Test files: `auth.test.ts`, `snippets.test.ts`, `fork.test.ts`, `http.test.ts` (headers, static, 404/400 JSON), `previewDoc.test.ts` (unit test of the client's pure preview builder — keep `previewDoc.ts` free of DOM imports; it is included in the server tsconfig for this reason).

## Gotchas
- `node:sqlite` is flagged experimental; scripts pass `--disable-warning=ExperimentalWarning`.
- Snippets cannot use `localStorage`/cookies (sandboxed opaque origin) — this is intended.
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
