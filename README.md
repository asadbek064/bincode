# [BinCode](https://bincode.asadk.dev) — a self-hostable JSFiddle alternative

BinCode is a minimalist playground for writing, previewing and sharing HTML/CSS/JavaScript snippets. It runs entirely on your own infrastructure: one Node process, one SQLite file, no external services or CDNs.

### [Demo](https://bincode.asadk.dev) · [Org repo](https://git.sheetjs.com/asadbek064/BinCode)

## Features
- **Monaco editor** with HTML / CSS / JS tabs (per-tab undo history), dark/light theme following your system
- **Live preview** in a sandboxed iframe, with pause/resume and an optional in-preview console (Eruda)
- **Share links** — `/?share=<id>`; each bin is **Link** (anyone with the link), **Password**, or **Only me**
- **Self-destructing bins** — delete after the first view, or after 10 minutes to a month
- **Collections** — group bins (a bin can be in several); keep a collection to yourself or share its list by link + password. Only-me bins are never listed to visitors
- **One settings button** — the visibility button next to the title (or the gear in My snippets) sets who can open a bin, when it's deleted and its collections; changes apply instantly
- **My snippets** — list, filter by collection, open, update in place (the share link stays the same) and delete your snippets
- **Fork** — save your own copy of anyone's shared snippet
- **Local drafts** — unsaved work is autosaved in your browser and offered back after a reload
- **Resizable split view** that stacks vertically on mobile
- Keyboard shortcuts: `Ctrl/Cmd+S` save, `Ctrl/Cmd+1/2/3` switch tabs

## No sign-ups, by design
Accounts are created by an admin from the command line. Anyone can view shared snippets; only users can save.

## Requirements
- Node.js **22.13+** (uses the built-in `node:sqlite`)
- pnpm 10

## Getting started

```bash
git clone https://git.sheetjs.com/asadbek064/BinCode.git
cd BinCode
pnpm install
cp .env.example .env        # then set JWT_SECRET to a long random string
pnpm add-user you@example.com   # prompts for a password (min 8 chars)
```

### Development
```bash
pnpm dev
```
Runs the API on `:3000` (auto-reload) and Vite on **http://localhost:5173** (hot reload, proxies `/api`).

### Production
```bash
pnpm build      # builds the client into dist/client
pnpm start      # serves the API + built client on $PORT
```
Put it behind a reverse proxy (nginx, Caddy, …) for HTTPS and set `TRUST_PROXY` accordingly so rate limiting sees real client IPs.

### Other commands
| Command | Description |
|---|---|
| `pnpm test` | API + unit tests (node:test + supertest, in-memory SQLite) |
| `pnpm typecheck` | TypeScript checks for server and client |
| `pnpm add-user <email>` | Create a user (password via prompt, or first line of stdin) |

## Configuration (`.env`)
| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `production` enforces a ≥32-char `JWT_SECRET` |
| `PORT` | `3000` | HTTP port |
| `JWT_SECRET` | — (required) | Secret used to sign login tokens |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime (`24h`, `30d`, …) |
| `DB_FILE` | `./bincode.db` | SQLite database file — back this file up |
| `TRUST_PROXY` | `false` | Express `trust proxy` setting (`1`, `loopback`, a CIDR, …) |
| `BCRYPT_ROUNDS` | `10` | Password hashing cost |

## Security model
- Snippet previews run in a **sandboxed, opaque-origin iframe** — snippet code cannot read the app's storage, cookies or login token. Inside snippets, `localStorage`/`sessionStorage` are in-memory stand-ins that reset on every re-render.
- Strict Content-Security-Policy and security headers on the app (helmet); the preview page has its own permissive policy so snippets can load libraries from any CDN.
- A bin's own visibility alone decides who can read it; collections never grant access. Only-me bins answer 404 to everyone else. Password bins and collections send nothing but their title until the password is verified; unlocks are short-lived, tab-scoped tokens that stop working when the password changes. Burn-after-read content is only sent by an explicit unlock request, so link previewers can't burn it. Expired bins disappear immediately.
- Rate limiting on the API, plus failed-attempt limits on login (per IP and per account) and on password unlocks (per IP and per bin/collection), and a per-user limit on writes.
- Per-account quotas (5,000 bins, 200 collections, 50M characters of code), small request bodies everywhere except snippet content, `Cache-Control: no-store` on all API responses, and short server timeouts.
- Passwords hashed with bcrypt; tokens are HS256 JWTs.
- Snippet size limited to 500,000 characters.

## API
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | – | `{email, password}` → `{token, user}` |
| GET | `/api/auth/me` | ✓ | Current user |
| GET | `/api/snippets` | ✓ | Your snippets (no code bodies) |
| POST | `/api/snippets` | ✓ | Create `{title, html, css, js, settings?}` |
| GET | `/api/snippets/:shareId` | – | A snippet, or `{locked, reason, shareId, title}` for password / burn bins (`X-Unlock-Token` reopens an unlocked one) |
| PATCH | `/api/snippets/:shareId` | owner | Settings `{visibility?: unlisted\|password\|private, password?, expiresIn?: never\|10m\|1h\|1d\|1w\|1m, burnAfterRead?}` |
| POST | `/api/snippets/:shareId/unlock` | – | `{password?}` → `{snippet, burned, token?}`; deletes burn-after-read bins |
| PUT | `/api/snippets/:shareId` | owner | Update content in place |
| DELETE | `/api/snippets/:shareId` | owner | Delete |
| POST | `/api/snippets/:shareId/fork` | ✓ | Copy into your account (optional content overrides) |
| GET | `/api/collections` | ✓ | Your collections |
| POST | `/api/collections` | ✓ | Create `{title, password?}` |
| GET | `/api/collections/:shareId` | – | Owner: full. Others: `{locked, shareId, title}` until unlocked |
| PUT | `/api/collections/:shareId` | owner | Update (`password: null` removes it) |
| DELETE | `/api/collections/:shareId` | owner | Delete (bins are kept) |
| PUT / DELETE | `/api/collections/:shareId/snippets/:snippetShareId` | owner | Add / remove a bin |
| POST | `/api/collections/:shareId/unlock` | – | `{password}` → `{token, expiresAt}` |
| GET | `/api/health` | – | Health check |

Errors are returned as `{ "error": string, "details"?: [{ path, message }] }`.

## Contributing
Contributions are welcome as long as the tool stays lightweight and self-contained. Please run `pnpm typecheck && pnpm test` before opening a PR.

## License
Apache License 2.0
