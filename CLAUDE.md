# CLAUDE.md — guide for AI assistants working on BinCode

## What this is
BinCode is a self-hostable JSFiddle alternative. Users write HTML/CSS/JS snippets ("bins") with a live preview and share them by link. Each bin has one visibility — Link (`unlisted`), Password, or Only me (`private`) — and an optional lifetime (expire after a duration, or burn after the first view). Bins can be grouped into collections, which only organize; a collection can be shared by link + password. It is a quick tool: keep the UI minimal. Accounts are created **only** via the CLI (`pnpm add-user`) — no self sign-up, by design.

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
  constants.ts       LIMITS, share-id format, VISIBILITIES, EXPIRATIONS, UNLOCK_TOKEN_HEADER, preview paths & message types
  schemas.ts         zod schemas (server-only; client must not import it → keeps zod out of the bundle)
src/server/
  index.ts           Entry: loads .env, config, opens DB, hourly expired-bin sweep, listens; graceful shutdown
  app.ts             createApp({ db, config, clientDir, limits, quotas }) — used by tests too
  config.ts          loadConfig() (full) and loadDbConfig() (no JWT; used by add-user)
  db.ts              openDb(file | ':memory:') + base schema + PRAGMA user_version migrations
  repos/             users.ts (DuplicateEmailError), snippets.ts (toSnippet/toSummary DTO mapping),
                     collections.ts (membership, password_version), backup.ts (export / transactional import)
  middleware/
    auth.ts          createAuth(config, users) → { requireAuth, optionalAuth }; signToken(config, userId);
                     signUnlockToken / hasUnlockToken (bin and collection unlock tokens)
    validate.ts      validateBody(schema) — replaces req.body with the parsed value
    error.ts         HttpError, notFound, errorHandler
    security.ts      securityHeaders() (app vs preview CSP), noStore, createRateLimiters(limits),
                     Quotas / DEFAULT_QUOTAS
  routes/            auth.ts, snippets.ts, collections.ts, account.ts (backup export / import)
src/client/
  index.html         Vite entry (no inline scripts — strict CSP)
  public/            Copied as-is: preview.html, logo/ (emerald </> mark + favicons)
  src/
    main.tsx, App.tsx, styles.css
    components/      Toolbar (3-zone navbar) + Toolbar.css, SharePopover, AccountMenu, Popover,
                     Icons, EditorPane (lazy; tabs, Format, editor settings) + EditorPane.css,
                     LibrarySearch + .css (CDNJS search popover),
                     PreviewPane, ConsoleDrawer + .css, SplitPane, Modal, LoginModal,
                     BinSettings (BinSettingsForm + modal wrapper), BinGate (password / burn gate),
                     SnippetsDashboard (collections sidebar), CollectionForm,
                     CollectionView (collection password gate), DraftBanner, Toast
    hooks/           useAuth, useSnippetEditor, useLocalDraft, useKeyboardShortcuts,
                     useColorScheme, useDebouncedValue, useConsoleLog
    lib/             api (typed fetch client, ApiError, exportBackup / importBackup), previewDoc (+ CONSOLE_BRIDGE), consoleTypes,
                     monaco (workers, bincode-light / bincode-dark themes),
                     drafts, storage (safe localStorage), unlockTokens (sessionStorage),
                     binSettings (labels, pending settings), cdnjs (search, tagFor, insertTag),
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
- Body size: only snippet create/update/fork (`POST /api/snippets`, `PUT /api/snippets/:id`, `POST /api/snippets/:id/fork`) accept up to 2MB; every other body is capped at 16kb, so anonymous endpoints can't be fed megabytes before a limit applies. Malformed JSON → 400, too large → 413.
- Every `/api` response carries `Cache-Control: no-store` (private / unlocked content must never land in a shared cache; `X-Unlock-Token` isn't `Authorization`, which caches already respect).
- Static assets: `pnpm build` writes `.br` / `.gz` next to each file in `dist/client/assets` (`precompress()` in `vite.config.ts`); `app.ts` sends them by `Accept-Encoding` (brotli preferred), with `Vary`. Nothing else is compressed — API bodies mix tokens with reflected input (BREACH). `/preview.html` is cacheable for 5 minutes (the iframe is remounted on every run), `index.html` is `no-cache`.
- `PUT /api/snippets/:id` changes content only; settings go through `PATCH` (ownership checked before validation, like PUT), so they apply without saving the code. `POST /api/snippets` takes optional `settings`.

### Access rules (security-critical)
- **A bin's own visibility is the only thing that decides who reads it.** Collections never grant access to a bin.
  - `unlisted`: anyone with the link. `private`: owner only — 404 (never 403) to everyone else, including PUT/PATCH/DELETE/fork, so existence doesn't leak. `password`: non-owners get `{ locked: true, reason, shareId, title }` (no code) until `POST /:id/unlock {password}` succeeds.
  - `forkedFrom` is masked to `null` when the source is private and the viewer isn't the source's owner.
- **Burn after read**: a non-owner `GET` is always `locked` (`reason: 'burn'` or `'password+burn'`); the content is sent only by `POST /:id/unlock`, which deletes the bin in the same request (`burn()` must report a deleted row, so only one requester gets it). An explicit POST means link-preview bots and React StrictMode double effects can't burn a bin. Owner views never burn.
- **Expiry**: every read filters `expires_at > now` (`NOT_EXPIRED` in `repos/snippets.ts`), so expired bins are gone immediately; the hourly sweep only reclaims space.
- **Unlock tokens**: 12h HS256 JWTs with `aud: 'bincode:snippet' | 'bincode:collection'`, `sub: id`, `pv: password_version`, sent as `X-Unlock-Token` (never Bearer). Login tokens must have no `aud`: `authenticate` rejects tokens that carry one, and `hasUnlockToken` requires the right one. Changing or removing a password bumps `password_version`, revoking every outstanding token. Burn bins never get a token.
- Wrong passwords answer **403**, not 401 — the client treats 401 as "log out".
- **Reading = forking**: anyone who can read a bin (owner, unlisted, valid unlock token) can fork it. Owners' forks keep visibility + password; everyone else's start as plain unlisted.
- **Collections** are owner-only when `password_hash IS NULL` (404 to others). With a password, a non-owner's `GET` returns exactly `{ locked: true, shareId, title }` until unlocked; then it lists the collection's **non-private, non-expired** bins only (`snippetCount` is recomputed so private ones aren't even counted). Opening a password bin from the list still goes through that bin's own gate.
- Membership: both the collection and the bin must belong to the caller. Deleting a collection keeps its bins; deleting a bin cascades its memberships.

### Rate limits (`createRateLimiters` in `middleware/security.ts`)
| Limiter | Default | Key | Applies to |
|---|---|---|---|
| `api` | 300/min | IP | all of `/api` except `/api/health` |
| `login` | 10 failures / 15 min | IP | `POST /api/auth/login` |
| `loginEmail` | 20 failures / hour | normalized email | `POST /api/auth/login` (stops distributed guessing; can lock one account out) |
| `unlock` | 10 failures / 15 min | IP | `POST /api/{snippets,collections}/:id/unlock` |
| `unlockTarget` | 30 failures / hour | `baseUrl` + shareId | same (stops distributed guessing; owners never need to unlock) |
| `backup` | 10/hour | user id | `GET /api/account/export`, `POST /api/account/import` |
| `writes` | 60/min | user id | every POST/PUT/DELETE on snippets and collections (after `requireAuth`) |

Quotas (`DEFAULT_QUOTAS`, 403 when exceeded): 5,000 bins, 200 collections and 50M characters of code per account. Storage is checked on create/fork and on PUT (net growth), and counts expired rows until the sweep removes them.

The HTTP server sets `headersTimeout` 15s and `requestTimeout` 30s (slowloris). `TRUST_PROXY=true` logs a startup warning: it lets any client spoof `X-Forwarded-For` and dodge every IP limit; use a hop count.

Custom key generators that fall back to the IP must call `ipKeyGenerator(req.ip)` **inline** — express-rate-limit inspects the function source and warns otherwise. Client-supplied identifiers (device fingerprints, etc.) are deliberately not used as keys: they are forgeable, so they only weaken limits.

### Data model
- `users(id, email UNIQUE, password_hash, created_at)`
- `snippets(id, share_id UNIQUE, user_id → users ON DELETE CASCADE, title, html, css, js, visibility CHECK IN ('unlisted','password','private'), password_hash, password_version, expires_at, burn_after_read, forked_from → snippets ON DELETE SET NULL, created_at, updated_at, CHECK ((visibility = 'password') = (password_hash IS NOT NULL)))`
- `collections(id, share_id UNIQUE, user_id → users ON DELETE CASCADE, title, description, password_hash NULL, password_version, created_at, updated_at)`
- `collection_snippets(collection_id → collections CASCADE, snippet_id → snippets CASCADE, added_at, PK(collection_id, snippet_id))` — many-to-many
- `retired_share_ids(share_id PK, user_id, kind)` — filled by `AFTER DELETE` triggers on `snippets` / `collections` (so delete, burn, the expiry sweep and user-deletion cascades all count); backup import uses it to never take over someone else's dead link.
- The internal `id`s and password hashes never leave the server. Clients only see `shareId` (10-char nanoid); `forkedFrom` is the source's `shareId`.
- Migrations: `SCHEMA` in `db.ts` is v0 (`CREATE TABLE IF NOT EXISTS`); `MIGRATIONS[i]` upgrades to version `i + 1`, each in a transaction, tracked in `PRAGMA user_version`. Append new entries; never edit one that shipped. SQLite can't alter constraints, so a changed CHECK needs a table rebuild: mark the entry `rebuild: true` and `migrate()` turns foreign keys off around it (outside the transaction, as SQLite requires) and runs `PRAGMA foreign_key_check` before committing (migration 2 is the example). `test/migration.test.ts` upgrades real v0 and v1 files.

### Backup (export / import)
- Account menu → **Export backup** downloads `bincode-backup-YYYY-MM-DD.json.br`: Brotli-compressed `BackupFile` JSON (`src/shared/api.ts`) with every non-expired bin (code, settings, **password hashes**, `forkedFrom`, timestamps) and every collection with members. No internal ids or user ids. Compressing this file download is fine despite the BREACH rule below: it's an authenticated GET of the user's own data with no reflected input.
- **Import backup…** accepts `.json.br` or plain `.json` (first non-whitespace byte `{`), `application/octet-stream`, ≤ 25 MB upload, ≤ 64 MiB decompressed (`maxOutputLength`, else 413). `backupFileSchema` validates everything; bcrypt hashes must have work factor **4–15** (the factor is inside the hash, and a factor-31 hash would pin the CPU for hours per unlock).
- `importFor` runs in one transaction (all-or-nothing). Per item: already the importer's → skipped; shareId live under, or retired by, another user → new shareId; otherwise the original shareId is reused (old links keep working). Quotas are checked after inserting and roll everything back on breach. Fork links resolve through the file first, then existing bins. Memberships use `INSERT OR IGNORE`, so re-importing fills in missing ones.

### Preview isolation (security-critical)
- The preview is `<iframe src="/preview.html" sandbox="allow-scripts allow-modals allow-forms allow-popups">` — **never add `allow-same-origin`**; the opaque origin is what stops snippet code from reading the app's `localStorage` token.
- `preview.html` posts `{type:'bincode:ready'}` to the parent; the parent replies `{type:'bincode:render', doc}` and the frame `document.write`s it. The iframe is remounted for every render.
- The document is built by the pure function `src/client/src/lib/previewDoc.ts` (escapes `</script` / `</style`). Its head carries one line of `CONSOLE_BRIDGE` + `STORAGE_SHIM` in its own `<script>` (so a syntax error in the user's JS can still be reported, inline HTML scripts are covered, and the user's script has no prefix — its line numbers are the user's own). The bridge wraps `console.*` and `error` / `unhandledrejection`, formats arguments safely (cycles, depth 3, 2,000 chars each, max 1,000 messages per run) and posts `{ type: 'bincode:console', level, text }` to the parent.
- `PreviewPane` accepts console messages only from its current iframe's window, keeps only known levels and string text (≤ 10,000 chars), and `useConsoleLog` keeps ≤ 500 entries. Console text is untrusted: render it as text only. The doc no longer depends on the console toggle, so opening the drawer never re-runs the snippet; `runId` (⌘/Ctrl+Enter) forces a re-run.
- `/preview.html` also sends a CSP `sandbox allow-scripts allow-modals allow-forms allow-popups` directive, so it has an opaque origin even when opened outside the iframe (e.g. a hostile site `window.open`s it). Its script only renders messages from `window.parent`.
- `srcdoc` is intentionally not used: it would inherit the app's strict CSP and block snippet scripts. `/preview.html` gets its own permissive CSP. (Eruda and `/vendor` were removed in favour of the native console drawer.)

### Client
- No router: `?share=<id>` and `?collection=<id>` + `history.pushState` / `popstate` (`lib/url.ts`). Unlock tokens live in sessionStorage `bincode:unlock:<kind>:<id>` (tab-scoped on purpose) and are sent on reload.
- **Navbar** (`Toolbar`, 56px): left = logo/wordmark (new bin), ghost title input, save status (Saved / Unsaved / Saving…); centre = Editor / Preview / Console toggles (console count badge, red on errors); right = Run/Pause, **Share**, **Save** (⌘S), account avatar menu (My bins, New bin, Fork, Sign out) or Log in. Styles live in `Toolbar.css`, scoped `.toolbar.navbar` because component CSS is bundled before `styles.css`.
- **Share** (`SharePopover`): on a saved bin it copies the link at once (toast) and opens a popover with the link and, for the owner, `BinSettingsForm`; on a new bin the popover shows the form with "Save & copy link", which calls `App.saveAndCopy(settings)` (settings passed explicitly — `pendingRef` would be stale until the next render). The first save via Save copies the link and toasts too; there is no share dialog any more.
- **Settings form** (`BinSettingsForm`, used by Share and by the My bins row gear via the `BinSettings` modal): visibility segments, a password field when needed, one "Delete" select (Never / After first view / After 10 min … 1 month — burn and expiry are one choice in the UI), and collection checkboxes (only if the user has collections). For a saved bin "Apply" sends PATCH at once and leaves editor content/dirty alone; for a new bin the choices are kept in App state (`pending`, never in drafts — no passwords in localStorage) and sent with the first POST, then collections are added.
- The workspace has a `view` (`App.tsx`): `'editor'`, `'blank'` (a `?share=`/`?collection=` link still loading), `{ locked }` or `{ unavailable }`. Anything but `'editor'` replaces the editor and preview, so a link never shows the demo snippet as if it were the bin: a locked bin shows only `BinGate` (an inline card: password and/or burn warning), a 404 shows "doesn't exist, has expired, or is private" with Log in / New bin. Save, Fork and the view toggles are hidden there, and `save()` refuses to run. A burned bin's content is loaded as a **new unsaved bin** so Save makes a copy.
- State: `AuthProvider` (token in `localStorage['bincode:token']`, validated via `/api/auth/me`) and the `useSnippetEditor` reducer. No state library.
- Save: not logged in → login then retry; owner → PUT (same link); someone else's → fork; new → POST.
- Drafts: `localStorage['bincode:draft:<shareId|new>']`, debounced, restored/offered via `DraftBanner`, cleared on save. Drafts hold content only.
- Monaco is code-split (lazy `EditorPane`) and its workers are bundled with Vite `?worker` imports (`lib/monaco.ts`). Editor prefs (font size 12/14/16, word wrap) persist in `localStorage['bincode:editor']`. Format runs `editor.action.formatDocument`.
- **CDNJS libraries**: a small "+" beside the HTML and JavaScript tab labels opens `LibrarySearch` (a `Popover` anchored to the editor header, because the tab bar scrolls and would clip it). The query is debounced (250ms), stale requests are aborted, results are cached per query. The browser calls `https://api.cdnjs.com/libraries?search=…&fields=version,description,sri` directly — the app CSP's `connect-src` allows exactly that origin. `lib/cdnjs.ts` keeps only `https://cdnjs.cloudflare.com/` URLs and well-formed `sha256/384/512-` SRI values (third-party data), `tagFor` builds `<script>` or (for `.css`) `<link>` with `integrity` + `crossorigin="anonymous"`, and `insertTag` prepends it to the HTML panel unless the URL is already there. `lib/cdnjs.ts` is imported by a server-side test (`test/cdnjs.test.ts`), so it must stay DOM-free. Repeated queries are served from the cache synchronously (`cachedLibraries`), with no loading state.
- User-facing name: "My bins" (the component is still `SnippetsDashboard`).
- Theme: light-first slate/emerald tokens in `styles.css` `:root`, mirrored for `prefers-color-scheme: dark`; use the variables, never hard-coded colours (Tailwind is deliberately not used).
- Shortcuts: ⌘/Ctrl+S save, ⌘/Ctrl+Enter re-run, ⌘/Ctrl+1/2/3 tabs (registered both in Monaco and globally).

## Conventions
- 2-space indent, single quotes, semicolons; comments explain *why*.
- Relative imports include the extension (`./app.ts`, `./App.tsx`) — `allowImportingTsExtensions` + `verbatimModuleSyntax` (use `import type` for types).
- New endpoint: add types to `src/shared/api.ts` (and a schema to `schemas.ts`) first, then route + repo, then tests in `test/`.
- Validate every request body with `validateBody(schema)`; store user content raw (React escapes on render) — never "sanitize" snippet code.
- Use parameterized prepared statements only.
- Check ownership for any mutation (`403` for non-owners, `404` for unknown/malformed/expired share ids — and for private bins / owner-only collections the caller can't see).
- UI: this is a quick tool for devs. Prefer one control over two, short labels over explanatory paragraphs, and hide sections that have nothing in them.
- Never log passwords or tokens. `add-user` must not echo the password.
- `index.html` must not contain inline scripts (CSP `script-src 'self'`).

## Testing
`test/helpers.ts` → `makeApp(opts?)` builds an app with an in-memory DB, bcrypt cost 4 and seeded users (`alice@example.com`, `bob@example.com` / `password123`). It returns `{ app, db, config, users, seeded, tokenFor(email) }`. The API rate limit defaults to 10,000 in tests; rate-limit tests pass lower `limits`. Each test creates its own app, so tests are independent. Static/CSP tests use `test/fixtures/client`.

Also `createCollection(t, email, body?)` and `addToCollection(t, email, collectionId, snippetId)`. Tests that simulate several client IPs set `env: { TRUST_PROXY: '1' }` and send `X-Forwarded-For` (`'true'` triggers an express-rate-limit warning). `writes` also defaults to 10,000 in tests.

`makeApp({ quotas })` lowers quotas for tests.

Test files: `auth.test.ts`, `snippets.test.ts`, `fork.test.ts`, `visibility.test.ts`, `bins.test.ts` (password, burn, expiry, unlock limits), `security.test.ts` (no-store, preview sandbox, body caps, quotas, access matrix, forged tokens, IDOR, mass assignment), `collections.test.ts`, `migration.test.ts`, `http.test.ts` (headers, static, 404/400 JSON), `backup.test.ts` (round trip, idempotent re-import, link guard, hash / bomb / quota validation), `cdnjs.test.ts` (CDNJS response mapping, tag building, no duplicates), `previewDoc.test.ts` (unit test of the client's pure preview builder — `previewDoc.ts` is imported by a server-side test, so it must stay DOM-free — the server tsconfig has no DOM lib).

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
