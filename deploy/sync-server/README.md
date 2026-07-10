# Bread of Life — sync server

A small **delta-sync** backend for the app's Dexie/IndexedDB store, so prayers,
journal, reading progress, notes, plans and highlights follow you across devices.
Standard local-first pattern — works in **every** platform's webview because it
syncs IndexedDB (which works everywhere), not OPFS.

- **Per-record last-write-wins** keyed by `(account, table, id)`, monotonic
  per-account `seq` for cursor pulls, tombstones for deletes.
- Storage: Node's built-in `node:sqlite` (no native addon). Passwords scrypt-hashed.
- E2E is deferred (see ROADMAP), so the server stores data server-side; account =
  email + password.

## API

| Route | Body | Returns |
|---|---|---|
| `POST /auth/signup` | `{email,password}` | `{token}` |
| `POST /auth/login` | `{email,password}` | `{token}` |
| `POST /pull` | `{since}` (Bearer) | `{changes:[{table,id,updatedAt,deleted,data}], cursor}` |
| `POST /push` | `{changes:[…]}` (Bearer) | `{cursor}` |
| `GET /health` | — | `{ok:true}` |

## Run it (self-host or app-hosted — same steps)

```bash
cp .env.example .env    # set SYNC_DOMAIN, ACME_EMAIL, TOKEN_SECRET (long random, keep stable)
docker compose up -d    # sync server + Caddy (auto-TLS + per-IP rate limit)
```

Live at `https://$SYNC_DOMAIN`. In the app: **Settings → Sync → Hosted** (the
app-hosted instance) or **Self-hosted** (paste your URL). Bare server for local
testing: `PORT=4000 node server.mjs`.

## Abuse mitigation (built in)
Caddy caps each IP at `RATE_EVENTS`/`RATE_WINDOW` (default 300/min), rejects
bodies over 8 MB, and the relay port is never exposed directly. Put the
app-hosted instance behind Cloudflare for DDoS protection. Monitor the
`bol-sync-data` volume.

## Deploy the app-hosted instance
Provision a VM (see the `oneqode-deploy` flow), copy this folder, set `.env`,
`docker compose up -d`, point `sync.<domain>` at it. Build the app with
`VITE_BOL_SYNC_URL=https://sync.<domain>` so the **Hosted** option appears.
