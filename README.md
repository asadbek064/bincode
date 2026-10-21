# [BinCode](https://bincode.asadk.dev) — a self-hostable JSFiddle alternative

BinCode is a minimalist playground for writing, previewing and sharing HTML/CSS/JavaScript snippets. It runs entirely on your own infrastructure: one Node process, one SQLite file, no external services or CDNs.

### [Demo](https://bincode.asadk.dev) · [Org repo](https://git.sheetjs.com/asadbek064/BinCode)

## Features
- **Monaco editor** with HTML / CSS / JS tabs (per-tab undo history), dark/light theme following your system
- **Live preview** in a sandboxed iframe, with pause/resume and an optional in-preview console (Eruda)
- **Share links** — `/?share=<id>` opens any snippet read-only for anyone
- **My snippets** — list, open, update in place (the share link stays the same) and delete your snippets
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
- Snippet previews run in a **sandboxed, opaque-origin iframe** — snippet code cannot read the app's storage, cookies or login token. (As a consequence, `localStorage` is not available inside snippets.)
- Strict Content-Security-Policy and security headers on the app (helmet); the preview page has its own permissive policy so snippets can load libraries from any CDN.
- Rate limiting on the API, with a stricter limit on failed logins.
- Passwords hashed with bcrypt; tokens are HS256 JWTs.
- Snippet size limited to 500,000 characters.

## API
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | – | `{email, password}` → `{token, user}` |
| GET | `/api/auth/me` | ✓ | Current user |
| GET | `/api/snippets` | ✓ | Your snippets (no code bodies) |
| POST | `/api/snippets` | ✓ | Create `{title, html, css, js}` |
| GET | `/api/snippets/:shareId` | – | Get a snippet (`isOwner` when authenticated) |
| PUT | `/api/snippets/:shareId` | owner | Update in place |
| DELETE | `/api/snippets/:shareId` | owner | Delete |
| POST | `/api/snippets/:shareId/fork` | ✓ | Copy into your account (optional content overrides) |
| GET | `/api/health` | – | Health check |

Errors are returned as `{ "error": string, "details"?: [{ path, message }] }`.

## Contributing
Contributions are welcome as long as the tool stays lightweight and self-contained. Please run `pnpm typecheck && pnpm test` before opening a PR.

## License
Apache License 2.0
