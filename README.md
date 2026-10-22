# [BinCode](https://bincode.asadk.dev)

A self-hostable JSFiddle alternative: write HTML/CSS/JS, see a live preview, share it by link. One Node process, one SQLite file, no external services.

[Demo](https://bincode.asadk.dev) · [Org repo](https://git.sheetjs.com/asadbek064/BinCode)

## Features
- Monaco editor with HTML / CSS / JS tabs, sandboxed live preview and a console
- Add libraries from CDNJS: search from the HTML or JavaScript tab, and a pinned `<script>` / `<link>` is added to the HTML
- Share by link; each bin is **Link**, **Password** or **Only me**
- Self-destruct after the first view, or after 10 minutes to a month
- Collections to group bins, optionally shared by link + password
- Fork any bin you can open; unsaved work is kept as a local draft

No sign-ups: accounts are created from the CLI. Anyone can view shared bins; only users can save.

## Getting started
Requires Node.js 22.13+ and pnpm 10.

```bash
git clone https://git.sheetjs.com/asadbek064/BinCode.git
cd BinCode
pnpm install
cp .env.example .env            # set JWT_SECRET to a long random string
pnpm add-user you@example.com   # prompts for a password
pnpm dev                        # http://localhost:5173
```

For production, run `pnpm build && pnpm start` behind a reverse proxy for HTTPS, and set `TRUST_PROXY` (e.g. `1`) so rate limits see real client IPs.

## Configuration (`.env`)
| Variable | Default | |
|---|---|---|
| `JWT_SECRET` | — | Required; ≥ 32 chars in production |
| `PORT` | `3000` | |
| `DB_FILE` | `./bincode.db` | Back this file up |
| `TRUST_PROXY` | `false` | Hop count, `loopback`, a CIDR, … |
| `JWT_EXPIRES_IN` | `7d` | Login token lifetime |
| `BCRYPT_ROUNDS` | `10` | |

## Security
- Previews run in a sandboxed, opaque-origin iframe, so snippet code can't reach the app's storage or login token.
- A bin's own visibility decides who can read it. Password and burn-after-read bins send no content until explicitly unlocked.
- Strict CSP, rate limits on the API, login and unlocks, and per-account quotas.
- The only outside call is the optional library search, made from your browser to the public CDNJS API (`api.cdnjs.com`); inserted tags carry SRI hashes when CDNJS provides them.

## Contributing
Keep it lightweight and self-contained. The API contract lives in `src/shared/api.ts`. Run `pnpm typecheck && pnpm test` before opening a PR.

## License
Apache 2.0
