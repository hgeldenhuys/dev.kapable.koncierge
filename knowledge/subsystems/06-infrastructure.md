# Kapable Infrastructure & Operations Guide

**Comprehensive reference for server infrastructure, deployment pipelines, worker systems, and operational procedures on Kapable production.**

---

## 1. Server Infrastructure

### Hetzner CCX33 Specifications

| Property | Details |
|----------|---------|
| **Server Model** | CCX33 (cloud compute, high-memory) |
| **vCPU** | 8 × AMD EPYC (work-stealing capable) |
| **RAM** | 32 GB (shared across all containers) |
| **Storage** | 240 GB NVMe SSD (system) + 100 GB XFS volume (`kapable-data`) |
| **Location** | Ashburn, VA (ash-dc1, us-east) |
| **IPv4** | 178.156.222.197 |
| **OS** | Ubuntu 24.04 LTS |
| **Cost** | ~$61.09/month |

### Resource Allocation

```
System overhead: ~2GB (Caddy, systemd, base OS)
Postgres 16: ~4GB (auto-tuned, shared buffers 8GB)
Available for containers: ~18GB-22GB
Current usage: ~40% utilization (14 containers)
```

### Storage

- `/opt/kapable/` — Platform binaries, scripts, shared packages, pipeline YAML
- `/opt/kapable/.env` — Runtime secrets (PostgreSQL credentials, API keys, deploy secret)
- `/var/lib/caddy/` — TLS certificates (auto-managed by Let's Encrypt)
- `/data/` — XFS volume for org workspaces (KAIT), container images (Incus)

---

## 2. Services Map

All services on the Hetzner server are fronted by **Caddy reverse proxy** (TLS termination). The proxy maintains a **JSON configuration file** at `/opt/kapable/caddy-services.json` and regenerates the Caddyfile deterministically.

### Live Services (2026-03-16)

| Service | Binary | Port | Domain | Purpose |
|---------|--------|------|--------|---------|
| **kapable-api** | `/opt/kapable/bin/kapable-api` | 3003 | api.kapable.dev | Core platform API (data, management, billing, services) |
| **kapable-proxy** | `/opt/kapable/bin/kapable-proxy` | 3080 | `*.kapable.run` | Connect app reverse proxy, X-Slot routing (blue-green) |
| **kapable-worker** | `/opt/kapable/bin/kapable-worker all` | — | (internal) | 15 background worker processes (see Worker System) |
| **kapable-forge** | `/opt/kapable/bin/kapable-forge` | 3015 | (internal) | AI orchestration daemon + Deploy daemon (uses kapable-pipeline) |
| **kapable-k8way** | `/opt/kapable/bin/kapable-k8way` | 3113 | k8way.kapable.dev | OAuth token proxy gateway for Claude API access |
| **kapable-kait** | `/opt/kapable/bin/kapable-kait` | 3112 | kait.kapable.dev | KAIT AI IDE session daemon (Incus container manager) |
| **kapable-console** | Incus container | 3005 | console.kapable.dev | Org admin console (TypeScript SPA, Connect App) |
| **kapable-admin** | Incus container | 3007 | admin.kapable.dev | Platform admin portal (TypeScript SPA, Connect App) |
| **kapable-developer** | Incus container | 3009 | developer.kapable.dev | Developer portal (TypeScript SPA, Connect App) |

### Monitoring & Observability (127.0.0.1 only, NOT exposed)

| Service | Port | Purpose |
|---------|------|---------|
| **node_exporter** | 9100 | System metrics (CPU, disk, network) |
| **postgres_exporter** | 9187 | PostgreSQL metrics (table sizes, connection counts, WAL lag) |
| **prometheus** | 9090 | Time-series metrics database (15-day retention) |
| **grafana** | 3100 | Dashboard UI (`monitoring.kapable.dev`, accessible via Caddy) |

---

## 3. Caddy Reverse Proxy & TLS

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Caddy (Reverse Proxy)                                   │
│ - TLS via Let's Encrypt (auto-renew)                    │
│ - Dynamic config from /opt/kapable/caddy-services.json  │
│ - Route rules: specific paths before wildcards          │
│ - All headers passed through (including X-Slot)         │
└──┬──────────┬──────────┬──────────┬──────────┬──────────┘
   │          │          │          │          │
   v          v          v          v          v
api.k.d   console     admin    developer   *.kapable.run
(3003)    (3005)      (3007)    (3009)     (3080)
```

### Management

**Helper Scripts** (installed in `/opt/kapable/bin/`):

```bash
# Add a service to Caddy
ssh kapable-prod-root '/opt/kapable/bin/caddy-add-service console.kapable.dev 3005 "Org Console"'

# Remove a service from Caddy
ssh kapable-prod-root '/opt/kapable/bin/caddy-remove-service console.kapable.dev'

# Regenerate Caddyfile from JSON source of truth
ssh kapable-prod-root '/opt/kapable/bin/caddy-generate-caddyfile'

# Reload Caddy (graceful, no downtime)
ssh kapable-prod-root 'systemctl reload caddy'
```

### TLS Certificate Management

- **Provider**: Let's Encrypt (ACME)
- **Storage**: `/var/lib/caddy/.local/share/caddy/certificates/` (owned by Caddy user)
- **Auto-renew**: Caddy manages renewal; no manual action needed
- **If renewal fails**: Clear the certificate directory and reload Caddy to force fresh issuance

```bash
# Emergency re-issue (clears all certs and starts fresh)
ssh kapable-prod-root 'rm -rf /var/lib/caddy/.local/share/caddy/certificates && systemctl reload caddy'
```

### X-Slot Routing (Blue-Green Verification)

Caddy **passes all headers through** (no modification). The `X-Slot` header is handled by `kapable-proxy`, NOT Caddy:

```
X-Slot: standby  →  Caddy passes through  →  kapable-proxy routes to standby container
X-Slot: <absent> →  Caddy passes through  →  kapable-proxy routes to primary container
```

**Both slots share the same session secret and database** — cookies work across slots.

---

## 4. Container Management (Incus)

### Warm Pool System

`kapable-worker warm-pool` (30s poll) maintains a warm pool of idle containers ready for instant KAIT session startup.

- **Golden images**: `kapable-tpl-console`, `kapable-tpl-admin`, `kapable-tpl-developer`, `kapable-tpl-kait`
- **Pool name**: `kap-warm-pool-{app}-{index}` (e.g., `kap-warm-pool-console-0`)
- **Expiry**: Containers idle for >30 min are destroyed
- **Health checks**: Pool monitor runs `curl http://<container-ip>:3005/health` every 30s

### Container Reconciliation

`kapable-worker reconcile` (60s poll) detects and removes orphaned containers (crashed processes, forgotten deploys).

### Connect App Containers

**Naming pattern**: `kap-kapable-{app}-{slot}` (e.g., `kap-kapable-console-primary`, `kap-kapable-console-standby`)

**Lifecycle**:
1. Pipeline stage `Provision` creates container from golden image
2. Pipeline stage `Build` (bun run build) inside the container
3. Pipeline stage `Start` writes systemd drop-in, restarts `kapable-app` service
4. **Blue-green**: Standby container is promoted to primary via database update (`app_deployment_slots.weight`)

**Container DNS**: Does NOT resolve from host. Health checks must:
```bash
# Get container IP
incus list kap-kapable-console-primary --format=csv -c 4  # outputs: 10.N.N.N

# Then curl that IP (not the container name)
curl http://10.N.N.N:3005/health
```

### KAIT Session Containers

**Golden image**: `kapable-tpl-kait`
**Firewall**: nftables egress policy (deny-by-default), allowlist includes:
- DNS (53/tcp, 53/udp)
- HTTP + HTTPS (80/tcp, 443/tcp)
- Internal Kapable API (10.0.0.0/8:3003, 10.0.0.0/8:3005)
- ICMP (ping)

**Updating firewall rules**:
```bash
# Temporary (lost on restart)
incus exec <container> -- nft add rule inet filter output tcp dport 8080 accept

# Permanent (update golden image)
incus init kapable-tpl-kait temp-update
incus start temp-update
incus exec temp-update -- nano /etc/nftables.conf
incus stop temp-update
incus publish temp-update --alias kapable-tpl-kait --reuse
incus delete temp-update
```

### Workspace Persistence

**KAIT workspaces** are host directories bind-mounted into containers:
- Host path: `/opt/kapable/workspaces/{orgId}/{projectName}/`
- Container mount: `/workspace/` (or determined by `WORKSPACE_ROOT` env)
- **Reaper kill** (`incus delete --force`): workspace directory persists
- **Explicit kill** (`killSession()` via BFF): directory is `rm -rf`

**Deterministic workspace reuse**: If a workspace already exists and is not in use, fetch+rebase instead of re-cloning (saves ~1s per session start).

---

## 5. Database — PostgreSQL 16

### Connection

- **Host**: localhost:5432 (on the Hetzner server)
- **Database**: `kapable_platform`
- **User**: `kapable` (credentials in `/opt/kapable/.env`, mode 600)
- **Migrations**: 47 applied (SQLx migrations)
- **Tables**: 70+ (organizations, org_members, apps, deployments, functions, flows, etc.)

### Critical Tables (Identity)

| Table | Key Columns | Purpose |
|-------|------------|---------|
| `organizations` | `id`, `slug`, `name`, `plan`, `billing_email` | Tenant (org) record |
| `org_members` | `id`, `org_id`, `email`, `password_hash`, `role` | User identity; **NO `users` table** |
| `sessions` | `id`, `user_id` (→ org_members.id), `token`, `expires_at` | Login sessions |
| `api_keys` | `id`, `org_id`, `key_hash`, `scopes`, `last_used_at` | API authentication |
| `service_tokens` | `id`, `org_id`, `token_hash` | Service-to-service auth |
| `k8way_consumers` | `id`, `account_id`, `monthly_budget_usd`, `usage_usd`, `reset_date` | OAuth token consumers |

### Secrets Management

Sensitive fields use **PostgreSQL native encryption**:
```sql
pgp_sym_encrypt(plain_text, encryption_key)
pgp_sym_decrypt(encrypted_bytes, encryption_key)
```

The encryption key is in `/opt/kapable/.env` as `PG_CIPHER_KEY`.

### Queries to Remember (Ways of Working)

✅ **Correct** — uses org_members:
```sql
SELECT om.email FROM org_members om WHERE om.org_id = $1 AND om.role = 'owner'
```

❌ **WRONG** — no `users` table:
```sql
SELECT u.email FROM users u WHERE u.org_id = $1
```

---

## 6. Deploy Pipelines

### Two Deployment Paths

| Pipeline | What | Trigger | Path |
|----------|------|---------|------|
| **Bootstrap Pipeline** | Rust binaries + DB migrations | `/deploy-kapable` skill OR deploy API | `kapable-forge` + `kapable-pipeline` |
| **Connect App Pipeline** | TypeScript frontends (console, admin, developer) | `POST /v1/apps/{id}/environments/production/deploy` | `kapable-api` + `kapable-pipeline` |

### Bootstrap Pipeline (Rust Binaries)

**Flow**: Build binary → cross-compile → upload to `/opt/kapable/bin/` → atomic swap → restart service

**Commands**:
```bash
# Via skill (preferred)
/deploy-kapable

# Via deploy script (manual)
cd /Users/hgeldenhuys/WebstormProjects/kapable
scripts/deploy.sh api                    # Deploy kapable-api
scripts/deploy.sh worker                 # Deploy kapable-worker
scripts/deploy.sh all                    # Deploy all + migrations
```

**Self-deploy pattern** (kapable-api only):
1. Binary calls deploy API to upload itself
2. API writes to `.new`, renames to binary on success
3. Process exits with status 1
4. systemd `Restart=on-failure` loads new binary (~7s downtime)

**Other services** (kapable-worker, kapable-forge, etc.):
1. Deploy API uploads binary
2. API returns response with `"restart":"required"`
3. **Operator must SSH and restart**: `ssh kapable-prod 'sudo systemctl restart kapable-worker'`

### Connect App Pipeline (TypeScript Frontends)

**Unified pipeline** (`kapable-pipeline` crate, `connect-app.yaml`):

**Stages**:
1. `Clone` — git clone frontend repo
2. `Shallow-Fetch-SDK` — ensure SDK is current
3. `Link-Shared-Deps` — create `file:` symlinks to shared packages on host
4. `Package-Sync` — copy shared packages from host to container
5. `Install` — `bun install` in container
6. `Build` — `bun run build` with memory config (6GB for monaco)
7. `Start` — write systemd drop-in, restart `kapable-app` service
8. `Health-Check` — verify `/health` endpoint
9. `Finally-Promote` (success) — update database slots, swap primary/standby
10. `Finally-Cleanup` (failure) — remove container

**Trigger**:
```bash
curl -X POST https://api.kapable.dev/v1/apps/{app_id}/environments/production/deploy \
  -H "x-api-key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ref":"main"}'
```

**App IDs** for production:
| Service | App ID |
|---------|--------|
| console | `9ee900e7-3d10-46f1-b59b-bade220cfaa4` |
| admin | `abee3d58-259b-4454-9147-df67c0b74de6` |
| developer | `81e66cfd-84fa-4cae-a497-2d7f07e8f801` |
| marketing | `e23d5853-f742-4724-8f48-1d6a8c62dbbc` |

### PIPELINE_DIR Hot-Reload (Platform Only)

**For platform engineering ONLY** (not app developers):

```bash
# Copy pipeline YAML to production
scp pipelines/connect-app.yaml kapable-prod:/opt/kapable/pipelines/connect-app.yaml

# Reload (overrides embedded include_str! YAML)
curl -X POST https://api.kapable.dev/v1/admin/pipelines/reload \
  -H "x-api-key: $ADMIN_KEY"

# Then update the source file for next compile
git add pipelines/connect-app.yaml
```

---

## 7. Worker System (kapable-worker)

`kapable-worker` is a CLI tool with **16 background worker subcommands**. Each worker runs as an independent async task.

### Workers & Poll Intervals

| Worker | Subcommand | Interval | Purpose |
|--------|-----------|----------|---------|
| **Webhook** | `webhook` | pg_notify + 60s fallback | Deliver queued webhook events (with exponential backoff) |
| **Email** | `email_delivery` | 5s | Deliver queued emails via Resend (with retry) |
| **Scheduler** | `scheduler` | 15s | Execute cron-scheduled tasks (functions, flows, jobs) |
| **Status** | `status` | 30s | Health check monitored services (container, external) |
| **Warm Pool** | `warm_pool` | 30s | Maintain KAIT warm container pool (create, health, expire) |
| **Container Reconcile** | `reconcile` | 60s | Detect and clean orphaned Incus containers |
| **Billing Reset** | `billing_reset` | 60s | Reset k8way consumer monthly usage counters |
| **Usage Aggregation** | `usage_aggregation` | 60s | Aggregate API call quotas, trigger alerts |
| **Functions** | `functions` | pg_notify + 60s fallback | Execute serverless WASM functions (Wasmtime sandbox) |
| **Function Triggers** | `function_triggers` | pg_notify | Listen for data events, queue function invocations |
| **Flow Executor** | `flows` | 5s | Execute AI flow DAG nodes (Kahn executor, 30 node types) |
| **Agent Scheduler** | `agent_scheduler` | 10s | Wake autonomous agents, execute queued agent runs |
| **Deploy Queue** | `deploy_queue` | 30s | Process deployment queue (FOR UPDATE SKIP LOCKED) |
| **Agent Reaper** | `agent_reaper` | 30s/60s | Expire dead pipeline agents, timeout stale job executions |
| **Stale Sprint Reaper** | (internal) | 60s | Expire idle KAIT sprints/sessions |
| **Cron** | (internal) | embedded | Shared cron evaluation (both scheduler + function_triggers) |

### Running

```bash
# Run all workers (default)
kapable-worker all

# Run single worker (for debugging)
kapable-worker scheduler

# Systemd service
systemctl restart kapable-worker
systemctl status kapable-worker
journalctl -fu kapable-worker
```

### Key Patterns

- **pg_notify listener** — Some workers (webhook, functions, function_triggers) use PostgreSQL `LISTEN` for real-time notification instead of polling. Fallback to polling if listener fails.
- **FOR UPDATE SKIP LOCKED** — Deploy queue uses `SELECT ... FOR UPDATE SKIP LOCKED` to prevent concurrent processing of the same deployment.
- **Exponential backoff** — Webhook and email workers implement retry with exponential backoff (1s, 2s, 4s, 8s, 16s, cap 5m).
- **DashMap guard safety** — When workers access shared state (DashMap), never hold guards across await points. Use single-expression access or explicit scoping blocks.

---

## 8. Monitoring & Observability

### Prometheus

- **Endpoint**: http://127.0.0.1:9090 (NOT exposed; Caddy proxy required for remote access)
- **Retention**: 15 days (auto-deleted)
- **Scrape interval**: 15s (default)
- **Targets**: node_exporter (9100), postgres_exporter (9187), Kapable services (custom metrics endpoint `/metrics`)

### Grafana

- **URL**: https://monitoring.kapable.dev
- **Dashboards**: Platform metrics, container health, database performance, API latency percentiles
- **Data source**: Prometheus (localhost:9090)

### Key Metrics Emitted by Kapable

Services emit Prometheus metrics via `metrics::counter!()` and `metrics::gauge!()`:

- `kapable_api_requests_total{method,path,status}` — API request counts
- `kapable_api_request_duration_seconds{method,path}` — Request latency
- `kapable_worker_jobs_processed{worker}` — Jobs processed per worker
- `kapable_pipeline_stage_duration_seconds{pipeline,stage}` — Stage execution time
- `database_connections_active` — Active PostgreSQL connections
- `incus_containers_total` — Total Incus containers (warm pool + active)

**Best practice**: Use **normalized paths** in labels, not raw UUIDs (e.g., `/v1/apps/{app_id}` not `/v1/apps/9ee900e7...`).

### Health Checks

```bash
# API
curl -sf https://api.kapable.dev/health

# Console
curl -sf https://console.kapable.dev/health

# Metrics (requires internal network access)
curl -sf https://api.kapable.dev/metrics
```

---

## 9. SSH Access & Credentials

### SSH Keys

- **Key type**: ed25519
- **Key file**: `~/.ssh/kapable_ed25519`
- **Passphrase**: Optional (can be stored in ssh-agent)
- **Auth method**: Key-based ONLY (password auth disabled)

### SSH Aliases (in `~/.ssh/config`)

```bash
Host kapable-prod
  HostName 178.156.222.197
  User deploy
  IdentityFile ~/.ssh/kapable_ed25519
  StrictHostKeyChecking accept-new

Host kapable-prod-root
  HostName 178.156.222.197
  User root
  IdentityFile ~/.ssh/kapable_ed25519
  StrictHostKeyChecking accept-new
```

### User Permissions

| User | Capabilities | Use Cases |
|------|--------------|-----------|
| `deploy` | - Passwordless sudo for `systemctl` (kapable-* services) | Daily ops (restart services, logs, status checks) |
| `root` | - Full system admin | Caddy config, sshd config, file ownership fixes |

### Usage

```bash
# SSH as deploy user (preferred for daily ops)
ssh kapable-prod

# Restart a service
ssh kapable-prod 'sudo systemctl restart kapable-api'

# Check logs
ssh kapable-prod 'journalctl -fu kapable-api | head -50'

# SSH as root (only when needed)
ssh kapable-prod-root 'systemctl reload caddy'
```

### Firewall

- **Hetzner firewall ID**: `10539737`
- **SSH**: IP-whitelisted (not open to all)
- **Check your IP**: `curl -s ifconfig.me`

---

## 10. Secrets Management

### Environment Variables (Production)

**Location**: `/opt/kapable/.env` (mode 600, owned by deploy user)

**Key variables**:
```bash
DATABASE_URL=postgresql://kapable:...@localhost/kapable_platform
PG_CIPHER_KEY=<base64-encoded encryption key for pgp_sym_encrypt>
RESEND_API_KEY=<resend-email-provider-key>
OPENROUTER_API_KEY=<openrouter-api-key>
FAL_KEY=<fal-image-generation-key>
ELEVENLABS_API_KEY=<elevenlabs-tts-key>
DEPLOY_SECRET=<deploy-api-authorization-key>
ADMIN_API_KEY=sk_admin_61af775f967c434dbace3877ade456b8
```

### Bitwarden (CLI)

For non-interactive credential retrieval:

```bash
# Unlock session
export BW_SESSION=$(bw unlock --passwordfile ~/.bw_master --raw)

# Retrieve secret
bw get item "item-id" --session "$BW_SESSION" | jq -r '.notes'

# Get Cloudflare API token
CF_TOKEN=$(bw get item "b348e24b-9f7a-4759-bda6-1be7bf142932" --session "$BW_SESSION" | jq -r '.notes')
```

### Best Practices

- **Never hardcode credentials** in code or scripts
- **Never commit `.env` files** to git
- **Rotate keys regularly** (especially deploy secret)
- **Local `.env` must be superset of production** — rsync uses local as source of truth; any production-only var gets wiped
- **Alert on credential usage** — Monitor `DEPLOY_SECRET` and API key usage via `last_used_at` column in database

---

## 11. Critical Operational Rules (Ways of Working)

### The Top 19 Rules from ways-of-working.md

1. **Deploy via pipelines, NOT SSH/rsync** — Bootstrap Pipeline for Rust, Connect App Pipeline for TypeScript
   
2. **No `users` table** — Platform uses `org_members` with email directly on the row

3. **RR7 routes must be in `app/routes.ts`** — File existence alone is NOT sufficient; entries in routes.ts are required

4. **SSR: no skeleton on navigation** — React Router keeps stale content visible during client-side transitions; don't fight it with skeleton states

5. **`x-api-key` header for admin auth** — NOT `X-Admin-Key`, NOT `Authorization`

6. **`cargo fmt` before deploy** — Format drift from other sessions blocks deployment verification

7. **Commit before deploy** — Connect App Pipeline does `git clone`; local changes NOT deployed

8. **COALESCE in UPDATE queries** — NULL params must not overwrite existing values (`COALESCE($N, column_name)`)

9. **Specific routes before wildcards** — Register `/v1/_meta/tables` before `/v1/{table}`

10. **Never hardcode credentials** — Use `/opt/kapable/.env` or Bitwarden secret retrieval

11. **Never use backtick template literals for YAML/config constants** — JS bundler evaluates `${varName}` at import time; use regular strings

12. **Never use `Promise.allSettled` without error surfacing** — Catches rejections silently; MUST surface errors to UI

13. **Connect App .env vars require manual provisioning** — Blue-green deploys clone fresh containers; `.env` is NOT copied; SSH and add manually

14. **Always verify after deploy** — Check health endpoint + systemd status + public URL + deploy status API

15. **Deploy API for binaries** — `curl -X PUT https://api.kapable.dev/v1/internal/deploy/binary/{service}`; API handles atomic swap

16. **SDK must be deployed with every frontend** — Frontends use `file:` dependency; stale SDK = silent runtime errors

17. **Format before deploy** — Run `cargo fmt --all` (fix) before checking

18. **Local `.env` is the source of truth** — `rsync --delete` overwrites server `.env` with local copy

19. **KAIT session token forwarding** — BFF cookie → WS query param → KAIT container env → deploy API header

---

## 12. Deployment Checklist

### Before Every Deploy

- [ ] `cargo clippy --workspace -- -D warnings` (Rust) or `bun build` (TypeScript) passes
- [ ] `cargo test --workspace` passes (Rust tests)
- [ ] `cargo fmt --all -- --check` passes (no formatting drift)
- [ ] Git status is clean (commit all changes)
- [ ] Local `.env` is superset of production `.env`

### Rust Binary Deploy

```bash
# 1. Verify
cargo clippy -p kapable-api -- -D warnings
cargo test -p kapable-api

# 2. Cross-compile
cargo zigbuild --release --target x86_64-unknown-linux-gnu -p kapable-api

# 3. Deploy
/deploy-kapable    # Uses skill, handles everything

# 4. Verify post-deploy
curl -sf https://api.kapable.dev/health
curl -sf https://api.kapable.dev/metrics | head -20
ssh kapable-prod 'sudo systemctl status kapable-api'
```

### TypeScript Frontend Deploy

```bash
# 1. Verify
bun build

# 2. Commit
git add .
git commit -m "your message"

# 3. Trigger via API
curl -X POST https://api.kapable.dev/v1/apps/9ee900e7-3d10-46f1-b59b-bade220cfaa4/environments/production/deploy \
  -H "x-api-key: sk_admin_61af775f967c434dbace3877ade456b8" \
  -H "Content-Type: application/json" \
  -d '{"ref":"main"}'

# 4. Poll deployment status
curl https://api.kapable.dev/v1/admin/deployments?limit=1 \
  -H "x-api-key: sk_admin_61af775f967c434dbace3877ade456b8" | jq '.[]'

# 5. Verify post-deploy
curl -sf https://console.kapable.dev/health
```

---

## 13. Troubleshooting

### Service Won't Start

```bash
# Check systemd status
ssh kapable-prod 'sudo systemctl status kapable-api'

# Check logs
ssh kapable-prod 'journalctl -fu kapable-api | tail -100'

# Check binary exists
ssh kapable-prod 'ls -lh /opt/kapable/bin/kapable-api'

# Verify binary has correct code
ssh kapable-prod 'strings /opt/kapable/bin/kapable-api | grep <unique_string>'
```

### Deployment Failed (Deploy Queue Stuck)

```bash
# Check deployment status
curl https://api.kapable.dev/v1/admin/deployments?limit=5 \
  -H "x-api-key: $ADMIN_KEY" | jq '.'

# Check for stuck jobs
PGPASSWORD=... psql -h localhost -U kapable kapable_platform -c \
  "SELECT * FROM pipeline_runs WHERE status = 'running' AND updated_at < NOW() - INTERVAL '1 hour';"

# Force-fail a stuck run
PGPASSWORD=... psql -h localhost -U kapable kapable_platform -c \
  "UPDATE pipeline_runs SET status = 'failed' WHERE id = '<run-id>';"
```

### Container OOM (Out of Memory)

**Symptom**: `bun run build` killed with SIGKILL, no error message

```bash
# Check container memory limit
incus config get kap-kapable-console-primary limits.memory

# Increase to 6GB (for monaco builds)
incus config set kap-kapable-console-primary limits.memory 6GB

# OR set environment variable in pipeline YAML
NODE_OPTIONS=--max-old-space-size=3072
```

### Database Connection Errors

```bash
# Check connection pool size
curl -sf https://api.kapable.dev/metrics | grep 'sql_pool'

# Check PostgreSQL max_connections
PGPASSWORD=... psql -h localhost -U kapable kapable_platform -c 'SHOW max_connections;'

# If exhausted, increase or restart services
ssh kapable-prod 'sudo systemctl restart kapable-api kapable-worker'
```

---

## 14. Quick Reference Commands

### Server Access

```bash
ssh kapable-prod                    # Deploy user
ssh kapable-prod-root               # Root user
ssh kapable-prod 'uptime'           # Quick health check
ssh kapable-prod 'free -h'          # Memory usage
```

### Service Management

```bash
# Restart service
ssh kapable-prod 'sudo systemctl restart kapable-api'

# Check status
ssh kapable-prod 'sudo systemctl status kapable-api'

# Tail logs
ssh kapable-prod 'journalctl -fu kapable-api'

# Stop service
ssh kapable-prod 'sudo systemctl stop kapable-api'
```

### Database

```bash
# Connect
PGPASSWORD=$(grep 'DATABASE_URL' /opt/kapable/.env | cut -d: -f3 | cut -d@ -f1) \
  psql -h localhost -U kapable kapable_platform

# List tables
\dt

# View recent migrations
SELECT name, installed_on FROM _sqlx_migrations ORDER BY installed_on DESC LIMIT 10;
```

### Incus Containers

```bash
# List all containers
incus list

# List warm pool only
incus list | grep warm-pool

# Get container IP
incus list kap-kapable-console-primary --format=csv -c 4

# Execute command in container
incus exec kap-kapable-console-primary -- bash

# Get container logs (systemd)
incus exec kap-kapable-console-primary -- journalctl -fu kapable-app
```

### Monitoring

```bash
# Prometheus (via Grafana)
https://monitoring.kapable.dev

# Query Prometheus directly (requires SSH tunnel)
ssh -L 9090:127.0.0.1:9090 kapable-prod
# Then: http://localhost:9090/

# Check metrics endpoint
curl -sf https://api.kapable.dev/metrics | grep 'kapable_'
```

---

## 15. Pipeline Agents (Remote Execution)

### Mac Studio Setup

The platform supports distributed pipeline execution via **pipeline agents** registered on remote hardware.

| Property | Value |
|----------|-------|
| **Hardware** | Apple Mac Studio |
| **Chip** | Apple M2 Ultra |
| **RAM** | 128 GB unified memory |
| **Connectivity** | Tailscale mesh VPN |
| **Capabilities** | `rust`, `docker`, `apple-silicon`, `arm64`, `zigbuild`, `macos` |

### Registration

```bash
# On Mac Studio
curl -X POST https://api.kapable.dev/v1/admin/pipeline-agents \
  -H "x-api-key: sk_admin_61af775f967c434dbace3877ade456b8" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "mac-studio-01",
    "capabilities": ["rust", "docker", "apple-silicon", "arm64", "zigbuild", "macos"],
    "host_info": {
      "os": "macos",
      "arch": "arm64",
      "chip": "M2 Ultra",
      "memory_gb": 128
    }
  }'
```

### Heartbeat Loop

Agents must send heartbeats every 60s to stay online:

```bash
curl -X POST https://api.kapable.dev/v1/admin/pipeline-agents/{agent_id}/heartbeat \
  -H "x-api-key: sk_admin_61af775f967c434dbace3877ade456b8"
```

---

## 16. Process Documents

### Ways of Working (`../.forge/ways-of-working.md`)

Conventions proven by real session experience. ALWAYS read this before implementing.

**Key sections**:
- Deploy strategies (pipelines vs SSH)
- Database patterns (org_members, no users table)
- Route registration (RR7, routes.ts)
- Deployment edge cases (format drift, git clone, .env provisioning)
- Shared packages (file: linking, PIPELINE_DIR hot-reload)
- K8way gateway rules
- KAIT session management

### Definition of Done (`../.forge/definition-of-done.md`)

Quality gates before work ships. 50+ checklist items covering:
- Code quality (clippy, tests, fmt)
- Database correctness (type matching, PL/pgSQL scoping)
- Deployment verification (cross-compile, health checks, metrics)
- UI verification (Chrome MCP, mobile viewports, toasts)
- Security (auth tiers, RLS, no data leaks)
- Functional completeness (real users, real APIs, real data)

### Definition of Ready (`../.forge/definition-of-ready.md`)

Prerequisites before work starts. 30+ checklist items covering:
- Feature parity (v1 comparison)
- Auth model specified
- Acceptance criteria (real-user scenarios, not just "returns 200")
- Test plan defined
- Dependencies identified
- Chrome MCP required for UI stories

---

## Summary

Kapable's infrastructure is **containerized, multi-tenant, and pipeline-driven**:

- **Server**: Hetzner CCX33 (8 vCPU, 32 GB RAM, 40% utilization)
- **Services**: 10 live services (API, proxy, workers, frontends) + 3 observability services
- **Deployment**: Two pipelines (Bootstrap for Rust, Connect App for TypeScript)
- **Workers**: 16 background jobs handling webhooks, email, scheduling, monitoring, container lifecycle
- **Database**: PostgreSQL 16 with 70+ tables, org-centric identity (no users table)
- **Containers**: Incus (LXD), warm pool, blue-green deploys with X-Slot routing
- **TLS**: Caddy + Let's Encrypt auto-renewal
- **SSH**: Key-based, passwordless sudo for deploy user

**Golden rule**: Use pipelines, not SSH/rsync for deployments.

