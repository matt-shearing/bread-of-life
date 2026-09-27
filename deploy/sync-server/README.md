# Bread of Life — sync server

A small **delta-sync** backend for the app's Dexie/IndexedDB store, so prayers,
journal, reading progress, notes, plans and highlights follow you across devices.
It syncs IndexedDB, which works in every platform's webview (OPFS does not).

- **Per-record last-write-wins** keyed by `(account, table, id)`, a monotonic
  per-account `seq` for cursor pulls, and tombstones for deletes. The app merges
  reading-plan progress per day on top of this.
- **End-to-end encryption is optional and done by the app.** When a user turns it on,
  journal, prayer and note payloads arrive as `{"__enc": "..."}`, which this server
  cannot read. Everything else (ids, timestamps, highlights, progress, plans,
  account-level settings) is stored as sent.
- Storage: Node's built-in `node:sqlite` (no native addon). Passwords are hashed with
  scrypt (N=2^17, r=8, p=1); hashes from v0.4.0 (N=2^14) still verify and are upgraded
  at the next login.

## API

All JSON. Everything except `/health`, signup and login needs `Authorization: Bearer <token>`.

| Route | Body | Returns |
|---|---|---|
| `GET /health` | — | `{ok, version, features}` |
| `POST /auth/signup` | `{email, password}` | `{token}` |
| `POST /auth/login` | `{email, password}` | `{token}` |
| `POST /auth/refresh` | — | `{token}` with a fresh expiry |
| `POST /auth/logout-all` | — | `{ok}`; every token for the account stops working |
| `POST /auth/password` | `{current, next}` | `{token}`; every other token stops working |
| `POST /account/delete` | `{password}` | `{ok}`; the account and all its records are deleted |
| `POST /pull` | `{since, deviceId?, limit?}` | `{changes:[{table,id,updatedAt,deleted,data}], cursor, more}` |
| `POST /push` | `{changes:[…], deviceId?}` | `{cursor, rejected:[{table,id,reason,current?}], adjusted?}` |

Details the app relies on:

- **Pages.** A pull returns at most 5000 changes. `more: true` means ask again from
  the returned `cursor`. (The v0.4.0 server had no `more`; apps treat a full page as
  "there may be more".)
- **Per-row results.** A bad row no longer fails the whole push. Rows are rejected
  with a reason: `stale` (the server's copy is as new or newer), `table` (not a table
  the app syncs), `invalid` (bad id, timestamp or data), `device-local` (a setting that
  belongs to one device) or `quota` (the account holds `MAX_RECORDS_PER_ACCOUNT`
  records). When the push carries a `deviceId`, a `stale` rejection includes the
  server's `current` copy, and `adjusted` lists stamps the server clamped.
- **Clock limits.** An `updatedAt` more than five minutes ahead of the server's clock is
  clamped to now + 5 minutes; otherwise one device with a wrong clock would win every
  later edit. Rows already stored with a future stamp are repaired at start-up.
- **No echo.** A pull with a `deviceId` leaves out rows that device pushed itself.
- **Status codes.** `400` for a malformed body, email or password; `401` for a bad
  login, or a missing, expired or revoked token; `409` when signup finds the email in
  use; `413` for a body over `MAX_BODY_BYTES` (8 MB); `500` only for a server fault,
  without internal detail.
- **Tokens** expire after `TOKEN_TTL_DAYS` (90); the app refreshes them weekly. Tokens
  issued by v0.4.0 carry no expiry. They keep working, so upgrading the server signs
  nobody out, until the account first uses logout-all or changes its password.
- **Compatibility.** Every addition is optional for the client. A v0.4.0 app sends
  and reads exactly what it did before. Apps from v0.5 read `features` from
  `/health` and use only what the server lists.

## Run it (self-host or app-hosted — same steps)

```bash
cp .env.example .env    # set SYNC_DOMAIN, ACME_EMAIL, TOKEN_SECRET
docker compose up -d    # sync server + Caddy (auto-TLS + per-IP rate limit)
```

Live at `https://$SYNC_DOMAIN`. In the app: **Settings → Sync → Hosted** (the
app-hosted instance) or **Self-hosted** (paste your URL). Use an `https://` address:
over plain `http://` the password and everything that syncs cross the network
unencrypted, and the app warns about it.

`TOKEN_SECRET` must be set, long, random (`openssl rand -hex 32`) and stable. In
production (`NODE_ENV=production`, set by the Dockerfile) the server refuses to start
without it; changing it signs every device out. Bare server for local testing, with a
throwaway secret: `PORT=4000 node server.mjs`.

## Abuse mitigation (built in)

Caddy caps each client address at `RATE_EVENTS`/`RATE_WINDOW` (default 300 a minute)
and rejects bodies over 8 MB; the server enforces the same body limit itself, validates
every row, and caps records per account. The relay port is never exposed directly.
Monitor the `bol-sync-data` volume.

### Behind Cloudflare

Put the app-hosted instance behind Cloudflare for DDoS protection, but then every
connection reaches Caddy from a Cloudflare address, and without more configuration
all users share one rate-limit bucket. Set `TRUSTED_PROXIES` in `.env` to Cloudflare's
published ranges (<https://www.cloudflare.com/ips/>). Caddy then takes the client
address from the `CF-Connecting-IP` header, but only on connections from those ranges,
so nobody can spoof it by sending the header directly. As of September 2026:

```
TRUSTED_PROXIES=173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32
```

Leave it unset when clients connect to Caddy directly.

## Accounts and deleting them

Signup is open, keyed on email and password. From v0.5, **Settings → Sync & account**
offers sign out on all devices, change password and delete account whenever the
server lists those features. Deleting an account removes its records, its cursor and
the account row at once; data on the user's devices is left alone. Google Play also
asks for a way to request deletion without the app: the operator can run
`DELETE FROM records WHERE account_id=…; DELETE FROM seqs WHERE account_id=…; DELETE FROM accounts WHERE id=…`
on `sync.db` for the account with that email.

## Tests

From the repository root: `pnpm test:sync-server` (this server on its own) and
`pnpm test:sync` (the app's real sync code on three simulated devices, against both
this server and the v0.4.0 one).

## Deploy the app-hosted instance

Provision a VM (see the `oneqode-deploy` flow), copy this folder, set `.env`,
`docker compose up -d`, point `sync.<domain>` at it. Build the app with
`VITE_BOL_SYNC_URL=https://sync.<domain>` so the **Hosted** option appears.
