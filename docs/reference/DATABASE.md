# Database

Paperclip uses PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/). There are three ways to run the database, from simplest to most production-ready.

## 1. Embedded PostgreSQL — zero config

If you don't set `DATABASE_URL`, the server automatically starts an embedded PostgreSQL instance and manages a local data directory.

```sh
pnpm dev
```

That's it. On first start the server:

1. Creates a `~/.paperclip/instances/default/db/` directory for storage
2. Ensures the `paperclip` database exists
3. Runs migrations automatically for empty databases
4. Starts serving requests

Data persists across restarts in `~/.paperclip/instances/default/db/`. To reset local dev data, delete that directory.

If you need to apply pending migrations manually, run:

```sh
pnpm db:migrate
```

When `DATABASE_URL` is unset, this command targets the current embedded PostgreSQL instance for your active Paperclip config/instance.

This mode is ideal for local development and one-command installs.

Docker note: the Docker quickstart image also uses embedded PostgreSQL by default. Persist `/paperclip` to keep DB state across container restarts (see `docs/reference/DOCKER.md`).

## 2. Local PostgreSQL (Docker)

For a full PostgreSQL server locally, use the included Docker Compose setup:

```sh
docker compose up -d
```

This starts PostgreSQL 17 on `localhost:5432`. Then set the connection string:

```sh
cp .env.example .env
# .env already contains:
# DATABASE_URL=postgres://paperclip:paperclip@localhost:5432/paperclip
```

Run migrations (once the migration generation issue is fixed) or use `drizzle-kit push`:

```sh
DATABASE_URL=postgres://paperclip:paperclip@localhost:5432/paperclip \
  npx drizzle-kit push
```

Start the server:

```sh
pnpm dev
```

## 3. Hosted PostgreSQL (Supabase)

For production, use a hosted PostgreSQL provider. [Supabase](https://supabase.com/) is a good option with a free tier.

### Setup

1. Create a project at [database.new](https://database.new)
2. Go to **Project Settings > Database > Connection string**
3. Copy the URI and replace the password placeholder with your database password

### Connection string

Supabase exposes Supavisor in two modes via the same `pooler.supabase.com` host:

**Session Pooler** (port **5432**) — **use this for the Paperclip server.** Persistent sessions, prepared statements, `SET search_path`, advisory locks, and Drizzle transactions all work normally:

```
postgres://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
```

**Transaction Pooler** (port **6543**) — only suitable for stateless serverless callers. Prepared statements and session-level state are stripped between transactions; running a long-lived Node server through this mode will be unstable.

### Configure

Set `DATABASE_URL` in your `.env`:

```sh
DATABASE_URL=postgres://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
```

Paperclip detects Supavisor pooler URLs and applies conservative connection lifetimes plus server-enforced statement timeouts. For the Transaction Pooler (port 6543) prepared statements are automatically disabled, but the Session Pooler is still the recommended endpoint. Tune via env if needed:

```sh
PAPERCLIP_DB_CONNECT_TIMEOUT_SECONDS=10
PAPERCLIP_DB_MAX_CONNECTIONS=10
PAPERCLIP_DB_IDLE_TIMEOUT_SECONDS=60
PAPERCLIP_DB_MAX_LIFETIME_SECONDS=900
PAPERCLIP_DB_STATEMENT_TIMEOUT_MS=30000
PAPERCLIP_DB_IDLE_IN_TX_TIMEOUT_MS=60000
PAPERCLIP_HEALTH_DB_TIMEOUT_MS=5000
```

Paperclip also creates a separate, small database pool for background work such
as heartbeat recovery, scheduled routines, and plugin cron jobs. This keeps a
stalled background tick from exhausting the HTTP request pool:

```sh
PAPERCLIP_BACKGROUND_DB_MAX_CONNECTIONS=2
PAPERCLIP_BACKGROUND_DB_CONNECT_TIMEOUT_SECONDS=10
PAPERCLIP_BACKGROUND_DB_IDLE_TIMEOUT_SECONDS=30
PAPERCLIP_BACKGROUND_DB_MAX_LIFETIME_SECONDS=300
PAPERCLIP_BACKGROUND_DB_STATEMENT_TIMEOUT_MS=20000
PAPERCLIP_BACKGROUND_DB_IDLE_IN_TX_TIMEOUT_MS=30000
PAPERCLIP_SCHEDULER_TASK_TIMEOUT_MS=45000
```

### Push the schema

```sh
# Use the direct connection (port 5432) for schema changes
DATABASE_URL=postgres://postgres.[PROJECT-REF]:[PASSWORD]@...5432/postgres \
  npx drizzle-kit push
```

### Free tier limits

- 500 MB database storage
- 200 concurrent connections
- Projects pause after 1 week of inactivity

See [Supabase pricing](https://supabase.com/pricing) for current details.

## Switching between modes

The database mode is controlled by `DATABASE_URL`:

| `DATABASE_URL` | Mode |
|---|---|
| Not set | Embedded PostgreSQL (`~/.paperclip/instances/default/db/`) |
| `postgres://...localhost...` | Local Docker PostgreSQL |
| `postgres://...supabase.com...` | Hosted Supabase |

Your Drizzle schema (`packages/db/src/schema/`) stays the same regardless of mode.

## Secret storage

Paperclip stores secret metadata and versions in:

- `company_secrets`
- `company_secret_versions`

For local/default installs, the active provider is `local_encrypted`:

- Secret material is encrypted at rest with a local master key.
- Default key file: `~/.paperclip/instances/default/secrets/master.key` (auto-created if missing).
- CLI config location: `~/.paperclip/instances/default/config.json` under `secrets.localEncrypted.keyFilePath`.

Optional overrides:

- `PAPERCLIP_SECRETS_MASTER_KEY` (32-byte key as base64, hex, or raw 32-char string)
- `PAPERCLIP_SECRETS_MASTER_KEY_FILE` (custom key file path)

Strict mode to block new inline sensitive env values:

```sh
PAPERCLIP_SECRETS_STRICT_MODE=true
```

You can set strict mode and provider defaults via:

```sh
pnpm paperclipai configure --section secrets
```

Inline secret migration command:

```sh
pnpm secrets:migrate-inline-env --apply
```
