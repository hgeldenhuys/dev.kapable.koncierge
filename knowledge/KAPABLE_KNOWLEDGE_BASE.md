# Kapable Platform Knowledge Base

Generated: 2026-03-16 04:33 UTC
Purpose: Koncierge onboarding agent context — comprehensive platform reference

---

# Kapable Rust API Platform — Comprehensive Knowledge Document\n\n## 1. Overview\n\n**What:** The Kapable Rust API is the core backend platform for Kapable, an AI-native Backend-as-a-Service (BaaS) system. It provides REST APIs for data management, authentication, application deployment, serverless functions, AI flows, and platform services (email, storage, video, voice).\n\n**Scope:** Multi-tenant Rust backend using Axum (HTTP), SQLx (async PostgreSQL), Tokio (async runtime), and tokio-stream (SSE/WebSocket support). Compiled to 6 binaries + 1 library + 1 migration runner.\n\n**Fit in Platform:** Central API serving three frontend consoles (admin, developer, organization), internal services (worker scheduler, proxy gateway, AI daemon), and external SDK clients. Single entry point for all platform operations.\n\n**Not In Production:** Can change architecture freely. No migration burden.\n\n---\n\n## 2. Workspace Structure\n\n```\ndev.kapable/\n├── Cargo.toml                   ← workspace root (13 crates)\n├── crates/\n│   ├── kapable-api/             ← primary REST API (Axum, 70+ routes)\n│   ├── kapable-proxy/           ← Connect app reverse proxy + auth gate\n│   ├── kapable-forge/           ← pipeline engine CLI + HTTP server + deploy daemon\n│   ├── kapable-worker/          ← background workers (8 subcommands)\n│   ├── kapable-cli/             ← ops CLI (org, app, deploy management)\n│   ├── kapable-core/            ← shared: types, auth, DB, errors, Incus\n│   ├── kapable-migrate/         ← SQLx migration runner (102 migrations)\n│   ├── kapable-k8way/           ← AI gateway proxy (OAuth token management)\n│   ├── kapable-kait/            ← KAIT AI IDE session daemon\n│   ├── kapable-pipeline/        ← DAG pipeline runtime (14K+ lines, 1280+ tests)\n│   ├── kapable-github/          ← GitHub API client library\n│   └── kapable-agent/           ← distributed pipeline job executor\n├── pipelines/\n│   ├── connect-app.yaml         ← embedded Connect App Pipeline definition\n│   └── *.forge.yaml             ← pipeline YAML examples\n├── docs/\n│   ├── REWRITE_SPEC.md          ← 11K+ line spec (comprehensive)\n│   └── rewrite-sections/        ← per-domain spec sections\n└── target/                      ← build output\n```\n\n### Crate Responsibilities\n\n| Crate | Binary | Port | Responsibility |\n|-------|--------|------|-----------------|\n| `kapable-api` | `kapable-api` | 3003 | Primary REST API: data CRUD, auth, management, services, billing, container lifecycle, pipeline orchestration |\n| `kapable-proxy` | `kapable-proxy` | 3080 | Connect app reverse proxy; auth gate; same-domain session validation |\n| `kapable-forge` | `kapable-forge` | 3015 | Pipeline engine (CLI + HTTP); Deploy daemon (SQLite state, artifact management) |\n| `kapable-worker` | `kapable-worker` | — | 8 background workers: scheduler, webhooks, functions, triggers, status, pool, billing, reconcile, usage |\n| `kapable-cli` | `kapable` | — | CLI: org list/create, app deploy, db migrate, service debug |\n| `kapable-core` | (lib) | — | Shared: auth (session, JWT, API key), DB (pool, RLS), types, errors, Incus manager, functions |\n| `kapable-migrate` | `kapable-migrate` | — | SQLx async migration runner (runs on startup or via CLI) |\n| `kapable-k8way` | `kapable-k8way` | 3113 | AI API gateway proxy with OAuth token management |\n| `kapable-kait` | `kapable-kait` | 3112 | KAIT session daemon (Incus-based AI IDE containers) |\n| `kapable-pipeline` | (lib) | — | **Canonical** DAG executor: YAML parsing, event streaming, stage execution, expressions, matrix stages, approval gates, artifact storage (1280+ tests) |\n| `kapable-github` | (lib) | — | GitHub client wrapper (OAuth, webhooks, clone operations) |\n| `kapable-agent` | `kapable-agent` | — | Distributed pipeline job executor (webhook-triggered, state-synced) |\n\n---\n\n## 3. Tech Stack\n\n### HTTP & Concurrency\n- **Axum 0.8** — async HTTP framework, Tower middleware, extractors, OpenAPI/Swagger\n- **Tokio 1** — multi-threaded async runtime, work-stealing scheduler\n- **Tokio-stream** — SSE (Server-Sent Events), WebSocket, broadcast channels\n\n### Database\n- **SQLx 0.8** — compile-time checked async PostgreSQL driver\n- **PostgreSQL 16** — multi-tier schema (public + per-org schemas)\n- **Migrations** — 102 SQL migrations in `crates/kapable-migrate/migrations/`\n\n### Authentication & Crypto\n- **jsonwebtoken 9** — JWT (HS256 per-project)\n- **argon2 0.5** — password hashing (BetterAuth compatible)\n- **bcrypt 0.16** — legacy password support\n- **hmac + sha2** — HMAC signature verification (OAuth bridge)\n\n### Serialization & Validation\n- **serde + serde_json** — JSON (with custom deserializers for JSONB)\n- **serde_yaml** — YAML pipeline parsing\n- **validator** — derive macros (not extensively used; prefer manual validation)\n\n### Monitoring & Observability\n- **tracing 0.1** — structured logging (JSON format, OpenTelemetry export)\n- **metrics 0.24** — Prometheus counters/gauges (per-subsystem)\n- **metrics-exporter-prometheus 0.16** — `/metrics` endpoint\n\n### Async Utilities\n- **async-stream, futures-util, tokio-util** — async combinators and cancellation\n- **dashmap 6** — concurrent hash map (for pipeline event sinks, deploy streams)\n- **moka 0.12** — LRU cache (with sync wrapper)\n- **lru 0.12** — memory-only LRU\n\n### Container & File Operations\n- **git2** — Git operations (Org Vault, clone)\n- **pgwire-replication** — PostgreSQL WAL logical replication (real-time SSE)\n- **wasmtime 29** — WASM runtime (Wasmtime + Javy for serverless)\n- **aws-sdk-s3 + aws-config** — MinIO/S3 storage\n\n### Encoding & Network\n- **base64, hex** — encoding/decoding\n- **regex** — pattern matching (template interpolation, filters)\n- **ipnetwork** — IP allowlist validation\n- **hickory-resolver** — DNS resolution\n\n### Schema Validation\n- **jsonschema 0.28** — JSON Schema validation (for project data schemas)\n\n### Misc\n- **clap 4** — CLI argument parsing (derive macros)\n- **colored 2** — terminal colors\n- **rand 0.8** — random ID/token generation\n- **thiserror + anyhow** — error handling\n- **dotenvy + notify** — .env file loading, file watch\n\n---\n\n## 4. Authentication System\n\n### Auth Tiers\n\nEvery endpoint declares its auth tier. API enforces the declared tier via middleware:\n\n| Tier | Credential | Scope | Use Case | Middleware |\n|------|-----------|-------|----------|-----------|\n| `admin_only` | `sk_admin_*` API key OR admin session | Platform-wide operations | Create org, manage billing, view all apps | `require_admin_key_or_session()` |\n| `org_member` | Session token (`kses_*`) | Single org | Access org dashboard, settings, members | `require_session()` + `require_org_context()` |\n| `data_key` | API key (`sk_live_*` or `sk_test_*`) | Project-scoped, may have scopes (e.g., `read:users`) | Client SDKs, data CRUD | `validate_api_key()` + `require_scope()` (optional) |\n| `token_bearer` | JWT data token (end-user issued by BetterAuth) | Project-scoped, user-scoped | Frontend, post-login | `verify_token()` |\n| `public` | None | None | Health checks, OpenAPI schema | No auth middleware |\n\n### No `users` Table\n\n**CRITICAL:** The platform uses org-centric identity. NO `users` table exists.\n\n| Table | Key Columns | Purpose |\n|-------|-------------|---------|\n| `organizations` | `id`, `slug`, `name`, `plan` | Tenant record |\n| `org_members` | `id`, `org_id`, `email`, `password_hash`, `role`, `name` | **User identity — email stored here directly** |\n| `sessions` | `id`, `user_id` (→ org_members.id), `user_type`, `token`, `expires_at` | Login session (kses_*) |\n| `api_keys` | `id`, `org_id`, `project_id`, `key_prefix`, `key_hash`, `scopes` | API key (sk_live_*, sk_test_*, sk_admin_*) |\n| `password_reset_tokens` | `id`, `user_id` (→ org_members.id), `token`, `expires_at` | Password reset flow |\n| `service_tokens` | `id`, `org_id`, `key_type`, `key_hash` | Service tokens (st_ci_*, st_wh_*) |\n| `sso_providers` | `id`, `org_id`, `provider_type`, `domain` | SSO configuration |\n| `sso_sessions` | `id`, `org_id`, `provider_id`, `user_email` | SSO login sessions |\n\n### Per-Project Auth (BetterAuth)\n\nEach project schema has its own auth table:\n- Table: `{schema}._auth_users` (created per project, NOT on public schema)\n- Used for: End-user signup/login via `/v1/auth/` endpoints in Connect apps\n- JWT issued: HS256, per-project secret, scoped to `{project_id}:{user_id}`\n\n### Auth Context Types\n\nUnified auth context (Phase D) — routes match on the variant they need:\n\n```rust\npub enum AuthContext {\n    PlatformAdmin(AdminContext),       // sk_admin_* key or admin session\n    OrgMember(SessionContext),         // org member session\n    ApiKey(ApiContext),                // sk_live_* or sk_test_*\n    JwtToken(JwtTokenContext),         // end-user JWT\n    ServiceToken(ServiceTokenContext), // st_ci_* or st_wh_*\n    Internal(AdminContext),            // service-to-service\n}\n```\n\n### Session Model\n\n- Token format: `kses_` + 59 random characters\n- Expires: 30 days (configurable)\n- Per-instance: No cross-instance session invalidation (each API instance validates independently)\n- Destruction: Sessions remain in DB; app checks `expires_at > NOW()` on every request\n\n### Common Auth Patterns\n\n**Org member (session-based) → org_members:**\n```sql\nSELECT om.id, om.email, om.role, o.id as org_id\nFROM sessions s\nJOIN org_members om ON om.id = s.user_id\nJOIN organizations o ON o.id = om.org_id\nWHERE s.token = $1 AND s.expires_at > NOW()\n```\n\n**API key → api_keys → org:**\n```sql\nSELECT ak.id, ak.org_id, ak.project_id, ak.scopes,\n       p.schema_name, ak.tier\nFROM api_keys ak\nLEFT JOIN projects p ON p.id = ak.project_id\nWHERE ak.key_hash = $1 AND ak.revoked_at IS NULL\n```\n\n**JWT token:**\n- Decoded via `jsonwebtoken::decode(token, key, &validation)`\n- `sub` field contains `{project_id}:{user_id}`\n- Scopes: optional `scopes` claim (object or array)\n\n---\n\n## 5. Data API\n\n### How It Works\n\nDynamic, schema-agnostic CRUD for project tables. Supports:\n- **JSONB mode** (schemaless) — store arbitrary JSON in `data` column\n- **Typed mode** — strongly-typed columns (TEXT, UUID, TIMESTAMPTZ, NUMERIC, JSONB, BOOLEAN, TEXT[], UUID[])\n- **Real-time SSE** — WAL-based change stream via `/v1/sse`\n- **JWT scoping** — scope filters applied automatically to queries\n- **RLS** (Row-Level Security) — per-org data isolation via PostgreSQL policies\n\n### Key Routes\n\n**List/Create:**\n- `GET /v1/{project_id}/{table}?limit=50&offset=0&order_by=created_at&order=asc`\n- `POST /v1/{project_id}/{table}` — create row\n\n**Read/Update/Delete:**\n- `GET /v1/{project_id}/{table}/{id}`\n- `PATCH /v1/{project_id}/{table}/{id}` — partial update (COALESCE pattern)\n- `DELETE /v1/{project_id}/{table}/{id}`\n\n**Metadata:**\n- `GET /v1/_meta/tables` — list all tables in project\n- `POST /v1/_meta/tables` — create table (schema DDL)\n- `GET /v1/_meta/tables/{table}` — get table schema\n- `PUT /v1/_meta/tables/{table}` — update table schema\n- `DELETE /v1/_meta/tables/{table}` — drop table\n\n**Scoping (JWT):**\n- Scope: `read:users`, `write:users`, `delete:users`\n- Route prefix: `/v1/scope/{project_id}/{table}`\n- Same endpoints; scope filters injected via `generate_scope_filters()`\n\n### Auth for Data API\n\nThree paths (in order of precedence):\n\n1. **API key** (`sk_live_*` or `sk_test_*`) — full access, all scopes\n2. **JWT token** (data token from BetterAuth) — scoped access, filters injected\n3. **Session + X-Project-Id** (BFF proxy) — org member session + project header\n\nHeader extraction:\n- Auth: `Authorization: Bearer <key>` or `X-API-Key: <key>`\n- For session: `X-Session-Token: <token>` + `X-Project-Id: <uuid>`\n\n### Real-Time (SSE)\n\n**Endpoint:** `GET /v1/sse?project_id={id}&branch={optional}`\n\n**Flow:**\n1. WAL consumer listens to `kapable_platform_changes` publication\n2. Decodes logical replication messages\n3. BroadcastManager fans out to per-project channels\n4. SSE endpoint subscribes and streams events\n\n**Event types:**\n- `INSERT` — new row in table\n- `UPDATE` — modified row\n- `DELETE` — deleted row\n\n**Client-side:** Frontend should use exponential backoff (min 2s, max 30s) for reconnection to avoid feedback loops with `last_used_at` updates.\n\n### Filters\n\nQuery params: `?filter=column:eq:value&filter=age:gt:18`\n\nSupported operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `in`, `contains` (JSONB)\n\n### Branch Support\n\nQuery param: `?branch=feature-branch`\n\nRoutes request to `{schema}_{branch}` (e.g., `public_feature-branch` for schema)\n\n---\n\n## 6. Key Routes (70+)\n\n### Route Organization\n\nRoutes grouped by domain in `crates/kapable-api/src/routes/mod.rs`. Each module exports a `Router::new()` function. Main app composes them:\n\n```rust\nlet app = routes::routes(prometheus_handle).with_state(state);\n```\n\n### Route Groups\n\n**Auth & Identity:**\n- `auth.rs` — session-based: signup, login, logout, profile, password reset, /me\n- `admin_auth.rs` — admin: login, session, OAuth bridge, logout\n- `sso_providers.rs` — SAML/OIDC config\n- `sessions.rs` — list/revoke user sessions\n- `members.rs` — org members (invite, revoke, role change)\n\n**Data & Schema:**\n- `data.rs` — **primary data CRUD** (GET, POST, PATCH, DELETE `/v1/{table}/{id}`)\n- `meta.rs` — table metadata (list, create, update, drop)\n- `branches.rs` — database branching (create, list, delete, promote)\n- `scope_bindings.rs` — JWT scope → table/column mapping\n\n**Apps & Projects:**\n- `apps.rs` — app CRUD (create, list, update, delete)\n- `projects.rs` — project CRUD (data schema, billing tier)\n- `app_environments.rs` — environments (dev, staging, production)\n- `app_pipelines.rs` — per-app deployment pipelines\n- `app_domains.rs` — custom domains, SSL certificates\n- `app_dev_keys.rs` — development API keys (sk_test_*)\n- `deployment_slots.rs` — Blue-green deployment slots\n\n**Pipelines & Flows:**\n- `pipelines.rs` — **pipeline execution**: POST to run, GET to list, SSE streaming\n- `flows.rs` — AI Flows (DAG editor integration)\n- `llm_pipelines.rs` — LLM pipelines (Claude, Gemini, etc.)\n- `env_pipelines.rs` — environment-specific pipeline config\n- `sse_pipeline.rs` — SSE stream for pipeline events\n\n**Serverless Functions:**\n- `functions.rs` — WASM functions (create, list, update, delete, compile)\n- `functions.rs` (cont.) — `/call` (sync) and `/invoke` (async)\n- `schedules.rs` — cron triggers for functions\n- `process_rules.rs` — data-driven function triggers (webhooks, data changes)\n\n**Services (Email, Image, Video, Voice, Storage):**\n- `email.rs` — send emails via Resend\n- `email_templates.rs` — email template CRUD\n- `images.rs` — image upload, processing (FAL)\n- `video.rs` — video transcoding (FAL)\n- `voice.rs` — text-to-speech (ElevenLabs)\n- `storage.rs` — MinIO/S3 object storage\n- `secrets.rs` — encrypted secrets management\n- `feature_toggles.rs` — feature flag CRUD\n\n**Webhooks & Events:**\n- `webhooks.rs` — webhook CRUD, retry logic\n- `github_webhooks.rs` — GitHub push, PR webhooks\n- `events.rs` — custom event CRUD\n\n**Management & Monitoring:**\n- `management.rs` — org settings, billing, usage\n- `tokens.rs` — token management (API key CRUD)\n- `containers.rs` — container lifecycle (health, logs, restart)\n- `admin_auth.rs` — admin key management\n- `deploy_queue.rs` — deployment queue status\n- `deploy_locks.rs` — prevent concurrent deploys\n\n**Internal & Debug:**\n- `internal_deploy.rs` — internal deploy hooks (from Connect App Pipeline)\n- `health.rs` — `/health` endpoint\n- `metrics.rs` — `/metrics` (Prometheus format)\n- `openapi.rs` — OpenAPI/Swagger schema\n- `root.rs` — `/` (root route)\n\n**Board & Organization:**\n- `sprints.rs` — epic-runner integration (sprint CRUD)\n- `work_items.rs` — sprint work items, tasks\n- `board_tasks.rs` — kanban board tasks\n- `board_status.rs` — status enums\n- `board_ac.rs` — acceptance criteria\n\n**Specialized:**\n- `agents.rs` — agent definitions (types, config)\n- `pipeline_agents.rs` — agents for pipeline execution\n- `ai_chat.rs` — AI Chat API (Claude, Gemini, etc.)\n- `ai_transform.rs` — AI data transformation\n- `vault.rs` — Org Vault (git-backed docs)\n- `sse_clowder.rs` — SSE for Clowder (builder system)\n- `clowder.rs` — Clowder integration (deprecated)\n- `tickets.rs` — support tickets\n- `lessons.rs` — in-app learning/tutorials\n- `changelog.rs` — product changelog\n- `git.rs` — GitHub integration (clone-token, etc.)\n- `resource_links.rs` — resource linking (apps ↔ data)\n- `end_users.rs` — end-user management\n- `auth_configs.rs` — auth provider configuration\n- `templates.rs` — template library (email, SMS, etc.)\n\n---\n\n## 7. Database\n\n### 102 Migrations\n\nLocated in `crates/kapable-migrate/migrations/`. Numbered by date:\n- `20260216000001_core_tables.sql` — organizations, org_members, sessions, api_keys, password_reset_tokens\n- `20260216000002_database_tier.sql` — database_instances, tier info\n- `20260216000003_billing.sql` — billing, usage, quotas\n- `20260216000004_auth_configs.sql` — OAuth, SAML, OIDC config\n- `20260216000005_apps_platform.sql` — apps, environments, containers\n- `20260216000006_webhooks.sql` — webhook_endpoints, webhook_events\n- `20260216000007_services.sql` — email, image, video, voice, storage service tracking\n- ... (96 more)\n- `20260428000001_cron_trigger_columns.sql` — latest (cron task support)\n\n### Key Tables (Partial List)\n\n**Organization & Identity:**\n- `organizations` (37 cols)\n- `org_members` (11 cols)\n- `sessions` (7 cols)\n- `admins` (6 cols) — platform admins\n- `api_keys` (12 cols)\n- `service_tokens` (8 cols)\n- `password_reset_tokens` (6 cols)\n\n**Apps & Projects:**\n- `apps` (18 cols)\n- `projects` (24 cols)\n- `environments` (14 cols)\n- `database_instances` (12 cols)\n- `app_domains` (11 cols)\n\n**Pipelines & Flows:**\n- `pipelines` (13 cols) — deployment pipelines\n- `pipeline_runs` (18 cols) — execution history\n- `pipeline_events` (15 cols) — event stream\n- `pipeline_nodes` (16 cols) — DAG nodes\n- `flows` (14 cols) — AI Flows\n- `flow_nodes` (12 cols)\n- `flow_schedules` (8 cols) — cron triggers\n\n**Serverless:**\n- `functions` (18 cols)\n- `function_triggers` (12 cols)\n- `function_invocations` (16 cols) — execution log\n- `function_fuel_credits` (6 cols) — WASM fuel per tier\n\n**Services:**\n- `email_queue` (12 cols)\n- `email_templates` (10 cols)\n- `images` (12 cols)\n- `videos` (14 cols)\n- `storage_objects` (12 cols)\n- `secrets` (8 cols) — PGP encrypted\n- `feature_toggles` (11 cols)\n\n**Webhooks & Events:**\n- `webhooks` (13 cols)\n- `webhook_events` (10 cols)\n- `webhook_deliveries` (14 cols) — retry tracking\n- `events` (10 cols)\n\n**Board & Ceremonies:**\n- `sprints` (12 cols)\n- `sprint_artifacts` (11 cols)\n- `work_items` (18 cols)\n- `board_tasks` (16 cols)\n- `acceptance_criteria` (10 cols)\n- `board_status` (8 cols) — enum values\n\n**Real-Time & WAL:**\n- `wal_messages` (6 cols) — logical replication offsets\n- `wal_processed_offsets` (5 cols)\n\n**Monitoring & Audit:**\n- `api_call_usage` (11 cols) — quota tracking\n- `audit_logs` (12 cols) — action history\n\n### Schema Tiers\n\n**Public schema:** Platform tables (organizations, apps, pipelines, etc.)\n\n**Per-org schemas:** One per organization (e.g., `org_a1b2c3d4_schema`)\n- User-defined tables (inherited schema)\n- Tables created by Data API\n\n**Per-project schemas:** One per project (e.g., `proj_e5f6g7h8`)\n- User data tables (JSONB or typed)\n- `{schema}._auth_users` for BetterAuth\n- RLS policies (org_id-based)\n\n**Branch schemas:** One per database branch (e.g., `{schema}_feature-branch`)\n- Copy of main schema at branch time\n- Promoted to main on merge\n\n### RLS (Row-Level Security)\n\nPostgreSQL policies enforce org isolation:\n\n```sql\n-- Example: table_data policy on user tables\nCREATE POLICY org_isolation ON {schema}.table_data\n  USING (org_id = current_setting('jwt.claims.org_id')::UUID)\n```\n\nSet via app state on every query: `SET jwt.claims.org_id = '{org_id}'`\n\n### Migration System\n\nSQLx manages migrations via `SQLX_OFFLINE=true cargo sqlx migrate run`.\n\nAdding a migration:\n1. Create `.sql` file in `crates/kapable-migrate/migrations/`\n2. Name: `{YYYYMMDD}{NNNNN}_{description}.sql`\n3. SQLx auto-discovers and runs on startup\n4. Immutable: never modify old migrations\n\n---\n\n## 8. Serverless Functions (WASM)\n\n### Runtime\n\n**Wasmtime 29** + **Javy v8** (TypeScript → WebAssembly compiler)\n\n- Host provides: `memory`, `read_input`, `write_output`, `get_env`\n- Sandbox: no network, no filesystem access (isolated per function invocation)\n- Fuel: cost-based execution metering (prevents infinite loops)\n- Timeout: per-tier (default 30s)\n\n### Fuel Tiers\n\n| Tier | Fuel/Month | Cost | Use Case |\n|------|-----------|------|----------|\n| Free | 10M | $0 | Development, light usage |\n| Pro | 100M | included | Production small app |\n| Enterprise | unlimited | custom | High-volume, custom requirements |\n\nFuel consumed = execution instructions + data I/O overhead. If exceeded, function invocation fails with quota error.\n\n### Data ABI\n\nFunctions can access project data via `get_env(\"DATA_ABI\")`:\n\n```typescript\n// Inside function\nconst dataAbi = JSON.parse(Deno.env.get(\"DATA_ABI\") || \"{}\");\nconst rows = await dataAbi.select(\"users\", { limit: 10 });\n```\n\nCost: fuel is deducted for each data operation.\n\n### Two Execution Paths\n\n**`POST /v1/apps/{app_id}/environments/{env}/functions/{name}/call`** (sync)\n- Runs in-process via `WasmRuntime` (shared, single-threaded)\n- Returns immediately with output\n- Max timeout: 5 seconds\n\n**`POST /v1/apps/{app_id}/environments/{env}/functions/{name}/invoke`** (async)\n- Queued to `kapable-worker` (background execution)\n- Worker process runs via Wasmtime\n- Returns invocation ID; client polls `/invocations/{id}` for result\n- Max timeout: per-tier (30s-5min)\n\n### Cron Triggers\n\n**Flow:** Function has `function_triggers` with `trigger_type = 'cron'`\n\n`kapable-worker scheduler` polls every 15s:\n```sql\nSELECT * FROM function_triggers\nWHERE trigger_type = 'cron' AND enabled = true\n  AND (last_run_at IS NULL OR last_run_at + interval < NOW())\n```\n\nIf due, create invocation entry and queue for execution.\n\n### Compilation\n\n`POST /v1/apps/{app_id}/functions/{name}/compile` — triggers `kapable-core::functions::compiler`:\n\n1. Fetch function source code\n2. Run Javy TypeScript compiler\n3. Output `.wasm` binary (stored as bytecode in DB)\n4. Set `compiled_at` timestamp\n5. Return compilation result (errors → user feedback)\n\n---\n\n## 9. Pipeline System\n\n### Overview\n\n**kapable-pipeline** (14K+ lines, 1280+ tests) — **canonical** DAG executor used across the platform:\n\n- YAML-defined pipelines (steps, stages, triggers)\n- Event-driven execution (POST to `/v1/pipelines/run`)\n- Async stage execution (parallel steps in stage)\n- Matrix expansion (run step for each item in list)\n- Approval gates (manual intervention)\n- Expression interpolation (`{{var.field}}`)\n- Artifact storage (PostgreSQL + S3)\n\n### Architecture\n\n**Entry point:** `PipelineDefinition` (YAML parsed into Rust structs)\n\n```rust\npub struct PipelineDefinition {\n    pub name: String,\n    pub description: Option<String>,\n    pub trigger_type: TriggerSource,  // \"webhook\", \"manual\", \"schedule\"\n    pub variables: HashMap<String, serde_json::Value>,\n    pub stages: Vec<Stage>,\n}\n\npub struct Stage {\n    pub name: String,\n    pub steps: Vec<StepDefinition>,\n    pub on_failure: Option<String>,  // \"continue\", \"abort\", \"retry\"\n    pub allow_failure: bool,\n}\n\npub struct StepDefinition {\n    pub name: String,\n    pub uses: String,  // \"bash\", \"http\", \"container\", \"approval\", \"gate\"\n    pub with: serde_json::Value,  // step config\n}\n```\n\n**Execution:** `PipelineExecutor` (async, event-streaming):\n\n1. Build DAG from stage order\n2. Topologically sort stages\n3. For each stage:\n   - Expand matrix (if present)\n   - Execute steps in parallel (via `futures::join_all`)\n   - Stream events (step start, completion, error)\n4. Store events in database (PostgreSQL event table)\n5. Return final status (success, failure, aborted)\n\n### Step Types (20+)\n\n| Step Type | Module | Purpose |\n|-----------|--------|---------|\n| `bash` | `steps/bash.rs` | Run shell script, capture output |\n| `http` | `steps/http.rs` | Make HTTP request, handle response |\n| `container` | `steps/container.rs` | Spin up Incus container, execute command |\n| `approval` | `steps/approval.rs` | Wait for manual approval before continuing |\n| `gate` | `steps/gate.rs` | Conditional gate (if/else on variables) |\n| `agent` | `steps/agent.rs` | Dispatch to Claude AI agent (webhook-based) |\n| `agent_stream` | `steps/agent_stream.rs` | Stream agent output (SSE) |\n| `artifact` | `steps/artifact.rs` | Upload/download artifacts |\n| `slot` | `steps/slot.rs` | Deploy to Connect App slot (DSL) |\n| `deploy` | `steps/deploy.rs` | Trigger app deployment |\n| `health` | `steps/health.rs` | Check service health (HTTP GET) |\n\n### Stages & Parallelism\n\nPipeline progress:\n```yaml\nstages:\n  - name: \"Build\"\n    steps:\n      - name: \"Compile\"\n        uses: \"bash\"\n      - name: \"Unit Tests\"\n        uses: \"bash\"\n    # Both \"Compile\" and \"Unit Tests\" run in parallel\n\n  - name: \"Deploy\"\n    steps:\n      - name: \"Provision Infrastructure\"\n        uses: \"container\"\n    # Waits for all \"Build\" steps to complete\n```\n\n### Matrix Expansion\n\n```yaml\nsteps:\n  - name: \"Test Matrix\"\n    uses: \"bash\"\n    with:\n      matrix:\n        python_version: [\"3.9\", \"3.10\", \"3.11\"]\n        os: [\"ubuntu\", \"macos\"]\n    # Creates 6 parallel step executions (3 versions × 2 OSes)\n```\n\n### Expressions & Interpolation\n\nTemplate syntax: `{{var.field}}`, `{{steps.step_name.output.key}}`\n\nBuilt-in variables:\n- `pipeline.name`, `pipeline.id`, `pipeline.run_id`\n- `trigger.type`, `trigger.source` (webhook, manual, schedule)\n- `environment.ENV_VAR` (from deploy context)\n- `steps.{step_name}.output` (captured from previous step)\n\nEvaluator (Regex-based):\n\n```rust\npub fn interpolate(template: &str, context: &HashMap<String, Value>) -> String\n```\n\n### Event Streaming\n\nSSE endpoint: `GET /v1/pipelines/{run_id}/events` (filters within 1s of current time)\n\nEvent types:\n- `PipelineStarted` — execution begins\n- `StageStarted` — stage begins\n- `StepStarted` — step begins\n- `StepCompleted` — step finished (success)\n- `StepFailed` — step errored\n- `StageCompleted` — stage finished\n- `PipelineCompleted` — pipeline finished (with status)\n\n---\n\n## 10. Deploy Model\n\n### Bootstrap Pipeline (Rust Binaries)\n\n**Trigger:** `/deploy-kapable` skill (Claude) OR manual REST call\n\n**Flow:**\n1. User/CLI requests deploy via Slack skill or API\n2. Kapable-API receives POST to `/v1/pipelines/run`\n3. Pipeline YAML executed (embedded or from filesystem)\n4. Steps:\n   - `bash` — run `cargo build --release`\n   - `container` — compile to `x86_64-unknown-linux-gnu`\n   - `artifact` — upload binaries to S3\n   - `slot` — provision new Incus container slots\n   - `health` — verify `/health` returns 200\n   - `approval` — wait for manual verification\n   - `deployment` — swap old containers with new (blue-green)\n\n**Binaries deployed:**\n- `kapable-api` (primary)\n- `kapable-worker` (separate binary — if changed, must deploy separately)\n- `kapable-migrate` (runs migrations on startup)\n- `kapable-proxy`, `kapable-forge`, `kapable-k8way`, `kapable-kait`\n\n### Connect App Pipeline (TypeScript Frontends)\n\n**Trigger:** `POST /v1/apps/{app_id}/environments/{env}/deploy` (from Connect App build)\n\n**Flow:**\n1. Repo cloned from GitHub\n2. Bun dependencies installed\n3. Vite build executed\n4. Output deployed to bucket\n5. Proxy cache cleared\n6. Health verified\n\n**Binary:** `kapable-proxy` reverse-proxies requests to deployed bucket (origin serves HTML/JS/CSS)\n\n### Blue-Green Deploy\n\nTo avoid downtime:\n\n1. **Active slot** — current production container\n2. **Standby slot** — new code compiled/tested\n3. **Swap** — update DNS/routing to point to standby\n4. **Rollback** — if health check fails, swap back to active\n\n---\n\n## 11. Worker System\n\n### Background Execution\n\n`kapable-worker` — 8 independent workers (subcommands + combined `all`):\n\n| Worker | Poll Interval | Purpose |\n|--------|---------------|---------|\n| `webhook` | pg_notify + 60s fallback | Deliver pending webhook events (with exponential backoff) |\n| `email` | 5s | Send queued emails via Resend |\n| `functions` | pg_notify + 60s fallback | Execute WASM function invocations |\n| `function_triggers` | pg_notify | Listen for data changes, queue function invocations |\n| `scheduler` | 15s | Run cron-scheduled tasks (functions, webhooks) |\n| `status` | 30s | Check health of monitored services |\n| `warm_pool` | 30s | Maintain warm container pool (create, health, expire) |\n| `billing_reset` | 60s | Reset K8way consumer billing cycle counters |\n| `reconcile` | 60s | Detect + cleanup orphaned containers |\n| `usage` | 60s | Aggregate API call quotas, trigger usage alerts |\n\n### Webhook Delivery\n\nFlow:\n1. User creates webhook endpoint (POST to `/v1/webhooks`)\n2. Event occurs (e.g., data inserted)\n3. Row inserted into `webhook_events`\n4. `webhook` worker polls (via pg_notify trigger)\n5. POST to webhook URL with JSON payload\n6. Retry on failure (exponential backoff: 2s, 4s, 8s, 16s, 32s, 64s, 128s, max 3 times)\n7. Store result in `webhook_deliveries`\n\n---\n\n## 12. Common Tasks\n\n### Add a New Route\n\n1. **Create module** in `crates/kapable-api/src/routes/{domain}.rs`\n\n```rust\nuse axum::{Json, Router, extract::State, routing::get};\n\npub fn routes() -> Router<crate::state::AppState> {\n    Router::new()\n        .route(\"/v1/path\", get(handler_get).post(handler_post))\n}\n\nasync fn handler_get(State(state): State<AppState>) -> Json<Response> {\n    // impl\n}\n```\n\n2. **Register in** `crates/kapable-api/src/routes/mod.rs`:\n\n```rust\npub mod my_domain;\n\npub fn routes(prometheus_handle: PrometheusHandle) -> Router<AppState> {\n    Router::new()\n        // ... other routes\n        .merge(my_domain::routes())\n}\n```\n\n3. **Test:** Write `#[tokio::test]` in `routes/my_domain.rs`\n\n4. **Auth:** Add auth check at start of handler:\n\n```rust\nlet ctx = require_admin_key_or_session(&headers, &state.pool).await?;\n```\n\n### Create a Migration\n\n1. Create file: `crates/kapable-migrate/migrations/{YYYYMMDD}{NNNNN}_{description}.sql`\n\n2. Write SQL:\n\n```sql\nCREATE TABLE IF NOT EXISTS my_table (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    org_id UUID NOT NULL REFERENCES organizations(id),\n    name TEXT NOT NULL,\n    created_at TIMESTAMPTZ DEFAULT NOW(),\n    updated_at TIMESTAMPTZ DEFAULT NOW()\n);\n\nCREATE TRIGGER my_table_updated_at\n    BEFORE UPDATE ON my_table\n    FOR EACH ROW EXECUTE FUNCTION update_updated_at();\n\nCREATE INDEX idx_my_table_org_id ON my_table(org_id);\n```\n\n3. SQLx auto-discovers on startup; no manual registration needed\n\n### Add a New Crate\n\n1. `cargo new --lib crates/kapable-mylib`\n\n2. Update `Cargo.toml` workspace members:\n\n```toml\n[workspace]\nmembers = [\n    # ... existing\n    \"crates/kapable-mylib\",\n]\n```\n\n3. Add to workspace dependencies if shared:\n\n```toml\n[workspace.dependencies]\nkapable-mylib = { path = \"crates/kapable-mylib\" }\n```\n\n4. Reference in other crates:\n\n```toml\n[dependencies]\nkapable-mylib = { workspace = true }\n```\n\n### Query with sqlx::query_as!\n\nRequires `SQLX_OFFLINE=true cargo sqlx prepare` (generates `.sqlx` cache):\n\n```rust\n#[derive(sqlx::FromRow)]\npub struct User {\n    pub id: Uuid,\n    pub email: String,\n}\n\nlet user = sqlx::query_as::<_, User>(\n    \"SELECT id, email FROM org_members WHERE org_id = $1 LIMIT 1\"\n)\n    .bind(org_id)\n    .fetch_optional(&state.pool)\n    .await?;\n```\n\nOr use compile-time checked:\n\n```rust\nlet user = sqlx::query_as!(\n    User,\n    \"SELECT id, email FROM org_members WHERE org_id = $1\",\n    org_id\n)\n    .fetch_optional(&state.pool)\n    .await?;\n```\n\n### Test Route Handler\n\n```rust\n#[tokio::test]\nasync fn test_my_handler() {\n    let pool = db::create_pool(database_url).await.unwrap();\n    let state = AppState { pool, /* ... */ };\n    \n    let response = my_handler(State(state)).await;\n    assert_eq!(response.status(), StatusCode::OK);\n}\n```\n\n### Add Error Handling\n\nUse `AppError` enum + `ErrorCode`:\n\n```rust\nif !user.has_permission(\"write:data\") {\n    return Err(AppError::forbidden_code(\n        ErrorCode::AuthInsufficientPermissions,\n        \"Insufficient permissions for write:data\",\n    ));\n}\n```\n\nResponse automatically serialized to JSON with status code.\n\n---\n\n## 13. Gotchas\n\n### No `users` Table\n\nEVERY query references `org_members` directly, never `users`. Common mistake:\n\n```rust\n// WRONG\nsqlx::query(\"SELECT email FROM users WHERE id = $1\")\n\n// RIGHT\nsqlx::query(\"SELECT email FROM org_members WHERE id = $1\")\n```\n\n### Specific Routes Before Wildcards\n\nRouter matching order matters. Bad:\n\n```rust\nRouter::new()\n    .route(\"/v1/:table\", get(list_table))         // matches /v1/users, /v1/_meta\n    .route(\"/v1/_meta/tables\", get(meta_tables))  // NEVER HIT\n```\n\nGood:\n\n```rust\nRouter::new()\n    .route(\"/v1/_meta/tables\", get(meta_tables))\n    .route(\"/v1/:table\", get(list_table))\n```\n\n### COALESCE in UPDATE Queries\n\nNULL optional fields must NOT overwrite existing values:\n\n```rust\n// WRONG — NULL overwrites existing name\nsqlx::query(\n    \"UPDATE users SET email = $1, name = $2 WHERE id = $3\"\n)\n    .bind(new_email)\n    .bind(new_name_or_none)  // ← WRONG if None\n    .bind(user_id)\n\n// RIGHT — use COALESCE\nsqlx::query(\n    \"UPDATE users SET email = $1, name = COALESCE($2, name) WHERE id = $3\"\n)\n    .bind(new_email)\n    .bind(new_name_or_none)\n    .bind(user_id)\n```\n\n### DashMap Deadlock Pattern\n\nNEVER bind `.get()` result to a named variable if next code touches the same key:\n\n```rust\n// WRONG — deadlock risk on same-shard concurrent access\nlet guard = event_sinks.get(run_id);\nevent_sinks.insert(run_id, new_sink);  // ← DEADLOCK\n\n// RIGHT — drop guard before second operation\n{\n    let old = event_sinks.get(run_id);\n    drop(old);  // explicit\n}\nevent_sinks.insert(run_id, new_sink);\n\n// OR — single expression\nevent_sinks.remove(run_id).map(|(_, v)| v)\n```\n\n### RLS Not Applied by Default\n\nRow-level security in PostgreSQL requires explicit role setup. If querying as superuser (app does), RLS policies are BYPASSED. Must set proper role or use `current_setting()` gating:\n\n```sql\nSET ROLE {org_schema}_role;  -- Before querying\n```\n\nOr rely on app-level filtering (preferred, simpler).\n\n### No Outer Scope Variables in PL/pgSQL\n\nInside EXECUTE format() in PL/pgSQL functions, variables must be passed explicitly:\n\n```sql\n-- WRONG\nCREATE FUNCTION my_func(org_id UUID) AS $$\nDECLARE\n    result JSONB;\nBEGIN\n    EXECUTE format('SELECT * FROM %I WHERE org_id = %L', table_name, org_id);\n    -- ↑ org_id is IN SCOPE but EXECUTE string doesn't see it\nEND;\n$$ LANGUAGE plpgsql;\n\n-- RIGHT\nCREATE FUNCTION my_func(org_id UUID) AS $$\nDECLARE\n    result JSONB;\nBEGIN\n    EXECUTE format('SELECT * FROM %I WHERE org_id = %L', table_name, org_id)\n        INTO result;\n    -- ↑ INTO captures result\nEND;\n$$ LANGUAGE plpgsql;\n```\n\n### SSE Exponential Backoff\n\nBrowser auto-reconnects EventSource on close with ~3s fixed interval. Combined with frequent `last_used_at` DB updates, causes feedback loop:\n\nBad: SSE closes → browser reconnects 3s later → API updates `last_used_at` → next request → 429 rate limit\n\nGood: Use exponential backoff on client (min 2s, max 30s, double on error)\n\n### Cargo Process Discipline\n\nNever spawn two cargo processes in the same workspace simultaneously. They fight for build lock:\n\n```bash\n# Session A\ncargo build  # acquires lock\n\n# Session B\ncargo test   # waits for lock, never gets it, hangs forever\n```\n\nCheck `ps aux | grep cargo` before any build command.\n\n### ForeignKey Constraints in Migrations\n\nEvery FK needs explicit `ON DELETE` behavior. Missing it causes implicit CASCADE (dangerous):\n\n```sql\n-- WRONG — implicit CASCADE on delete\nALTER TABLE pipelines\n  ADD CONSTRAINT fk_pipeline_org\n  FOREIGN KEY (org_id) REFERENCES organizations(id);\n\n-- RIGHT — explicit behavior\nALTER TABLE pipelines\n  ADD CONSTRAINT fk_pipeline_org\n  FOREIGN KEY (org_id) REFERENCES organizations(id)\n  ON DELETE CASCADE\n  ON UPDATE CASCADE;\n```\n\n### Metrics Labels\n\nPrometheus doesn't support arbitrary label values (especially UUIDs). Normalize paths:\n\n```rust\n// WRONG\nmetrics::counter!(\"api_calls\", \"org_id\" => org_id.to_string()).increment(1);\n// ↑ Creates 10000s of series for 10000 orgs\n\n// RIGHT\nmetrics::counter!(\"api_calls\", \"endpoint\" => \"/v1/data/{table}\").increment(1);\n```\n\n---\n\n## 14. Deploy Checklist\n\nBefore `cargo zigbuild --release`:\n\n1. **`cargo fmt --all`** — format (required for CI)\n2. **`cargo clippy --workspace -- -D warnings`** — lint, fix warnings\n3. **`cargo test --workspace`** — run all 1700+ tests\n4. **`cargo check`** — verify compile\n5. **Verify cross-compile target:** `x86_64-unknown-linux-gnu` (not macOS)\n6. **Sign & commit** before deploy (Connect App Pipeline does `git clone`)\n7. **Verify deploy:**\n   - SSH to prod: `strings /usr/local/bin/kapable-worker | grep '<unique_marker>'`\n   - Check `/health` — should return 200\n   - Check `/metrics` — should return valid Prometheus format\n   - Smoke test at least one E2E curl\n\n---\n\n## 15. Test Count\n\n- **Rust tests:** 1700+ (across all crates, especially pipeline: 1280+)\n- **Console tests:** 82 (React Router testing)\n- **Pipeline-UI tests:** 82 (component tests)\n\nCoverage target: 80% for critical paths (auth, data API, pipeline execution).\n\n---\n\n## 16. Key Resources\n\n| Resource | Path |\n|----------|------|\n| REWRITE_SPEC | `docs/REWRITE_SPEC.md` (11K+ lines) |\n| Spec sections | `docs/rewrite-sections/` (per-domain) |\n| Pipeline tests | `crates/kapable-pipeline/src/**/*.rs` (integration tests) |\n| Migrations | `crates/kapable-migrate/migrations/` (102 files) |\n| Routes | `crates/kapable-api/src/routes/` (70+ files) |\n| Cargo workspace | `Cargo.toml` (workspace config) |\n| Build script | `.github/workflows/` (CI/CD) |\n\n---\n\nThis document provides a comprehensive reference for AI agents and developers working on the Kapable Rust API platform. It covers architecture, authentication, data APIs, pipelines, serverless functions, deployment, and common gotchas."}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":7,"cache_creation_input_tokens":2163,"cache_read_input_tokens":70100,"output_tokens":12205,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":2163},"inference_geo":"","iterations":[],"speed":"standard"}},"requestId":"req_011CZ68PoZhGrEw8DW7DjweG","type":"assistant","uuid":"e51a2fe8-de06-480d-b8f1-4b46373a9445","timestamp":"2026-03-16T04:30:27.822Z","userType":"external","cwd":"/Users/hgeldenhuys/WebstormProjects/kapable/dev.kapable.koncierge","sessionId":"ec7b47a1-b6c0-49e6-8669-8ddbac3d6856","version":"2.1.76","gitBranch":"main","slug":"ethereal-marinating-yeti"}
{"parentUuid":"e51a2fe8-de06-480d-b8f1-4b46373a9445","isSidechain":true,"agentId":"a868cfa46840504ac","type":"progress","data":{"type":"hook_progress","hookEvent":"SubagentStop","hookName":"SubagentStop","command":"bun $CLAUDE_PROJECT_DIR/.claude/claude-code-sdk/bin/hooks.ts --config $CLAUDE_PROJECT_DIR/hooks.yaml"},"parentToolUseID":"1833e09c-45a8-472c-8c43-e6a09a43bbf6","toolUseID":"1833e09c-45a8-472c-8c43-e6a09a43bbf6","timestamp":"2026-03-16T04:30:27.879Z","uuid":"120301fc-686a-40e6-ac9c-fb8579fb6e57","userType":"external","cwd":"/Users/hgeldenhuys/WebstormProjects/kapable/dev.kapable.koncierge","sessionId":"ec7b47a1-b6c0-49e6-8669-8ddbac3d6856","version":"2.1.76","gitBranch":"main","slug":"ethereal-marinating-yeti"}
---

# Kapable Frontend Subsystem — Comprehensive Knowledge Document\n\n## Overview\n\nThe Kapable platform frontend subsystem consists of three primary web applications (Console, Admin, Developer Portal) plus two shared packages (UI components, SDK). All are built with **React Router v7 + Bun** using a **Backend-for-Frontend (BFF)** pattern.\n\n### Three Frontend Apps\n\n1. **Console** (`console.kapable.dev`, `dev.kapable.console/`, port 3005)\n   - Primary org management UI for projects, apps, API keys, data browsing, team settings\n   - App ID for Connect App Pipeline: `9ee900e7-3d10-46f1-b59b-bade220cfaa4`\n   - Auth: Session-based (via BetterAuth bridge at `auth.kapable.dev`)\n\n2. **Admin** (`admin.kapable.dev`, `dev.kapable.admin/`, port 3007)\n   - Platform-wide administration UI for Kapable operators\n   - Manages all organizations, apps, billing, audit logs, platform settings\n   - App ID: `abee3d58-259b-4454-9147-df67c0b74de6`\n   - Auth: Admin API key (`sk_admin_*`) via session token\n\n3. **Developer Portal** (`developer.kapable.dev`, `dev.kapable.developer/`, port 3009)\n   - Developer-facing documentation, API reference, getting-started guides\n   - Public-facing; minimal backend interaction\n\n### Shared Packages\n\n- **@kapable/ui** — 25+ shadcn/ui components (button, dialog, input, sidebar, etc.)\n  - Tailwind CSS v4, Radix UI, Lucide React icons, sonner toast\n  - Exported via subpath exports in `package.json`\n  - Uses `file:` symlink linking in consuming apps' `vite.config.ts`: `preserveSymlinks: true`\n\n- **@kapable/sdk** — TypeScript client SDK for the Kapable API\n  - Built from `dev.kapable.sdk/` (separate build step required before frontends)\n  - Exports `KapableClient` class + resource classes (Projects, Apps, Flows, etc.)\n  - Supports both ESM and CommonJS via dual-build Bun scripts\n  - Used server-side only in BFF loaders/actions via `getClient(request)`\n\n- **@kapable/pipeline-ui** — Pipeline visualization components\n  - PipelineLogViewer, PipelineYamlEditor, PipelineCanvas (DAG), StageNode\n  - Uses @dagrejs/dagre for layout, @xyflow/react for rendering, Monaco Editor for YAML\n  - Supports CSS export: `@import \"@kapable/pipeline-ui/styles\"`\n\n---\n\n## BFF Pattern (Backend-for-Frontend)\n\nAll three frontends follow the **BFF pattern** — they are NOT static SPAs. They are **full-stack apps** that:\n\n1. **Use React Router v7 loaders for SSR (server-side data fetching)**\n   - Each route can export `async function loader({ request, params })`\n   - Loaders run on the Bun server before rendering\n   - Data is serialized and passed to the client component\n   - NO loading spinners — pages render fully hydrated\n\n2. **Use React Router actions for form handling**\n   - `async function action({ request, params })`\n   - Must call `await requireAuth(request)` or `await requireAdmin(request)` as FIRST line\n   - Handles POST/PUT/DELETE operations\n   - Returns data for toast feedback or redirects\n\n3. **Talk to Kapable API (kapable-api:3003) over HTTP**\n   - Never touch PostgreSQL directly\n   - Use the @kapable/sdk KapableClient for API calls\n   - Session-mode auth: pass `X-Session-Token` header\n   - API-key auth: pass `Authorization: Bearer {apiKey}` header\n\n4. **Handle session management via cookies**\n   - Session storage: React Router's `createCookieSessionStorage()`\n   - Cookie name: `__kapable_console_session` (or similar per app)\n   - Secure, httpOnly, 8-hour maxAge, sameSite=lax\n   - SESSION_SECRET env var required in production\n\n### Auth Flow: Two Modes\n\n#### 1. Session-Based Auth (User Login)\n```\nUser → BetterAuth (auth.kapable.dev) → OAuth flow\n  ↓\nPOST /v1/auth/oauth-bridge (via oauth-callback route)\n  ↓\nRust API returns: session_token (kses_*), user object, org object\n  ↓\nBFF stores in cookie: { authMode: \"session\", sessionToken, orgId, orgName, name, email, role }\n  ↓\nAll API calls use: X-Session-Token header (custom)\n  ↓\ndata.kapable.dev (data plane API) validates token and applies RLS\n```\n\n#### 2. API-Key Auth (Programmatic)\n```\nUser enters API key in Console login form\n  ↓\nBFF validates against API: GET /v1/_meta/keys?key_prefix=...\n  ↓\nStores in cookie: { authMode: \"apikey\", apiKey, orgId, orgName, keyType }\n  ↓\nAll API calls use: Authorization: Bearer {apiKey} header\n  ↓\ndata.kapable.dev validates key and applies RLS\n```\n\n**Critical:** Session and API-key auth cannot be mixed. Choose one mode per session.\n\n---\n\n## Real-Time Data (SSE Pipeline)\n\nThe console implements real-time updates via **Server-Sent Events (SSE)** using PostgreSQL WAL.\n\n### SSE Flow\n```\nPostgreSQL (kapable_platform db)\n  ↓ (WAL publication: kapable_platform_changes)\nRust API (WAL consumer service)\n  ↓ (event stream)\nGET /v1/sse?tables=projects,apps,... (public endpoint)\n  ↓ (requires auth via session token or API key)\nBFF proxy route: GET /api/sse\n  ↓ (TransformStream passthrough, no direct pipe)\nBrowser: new EventSource(\"/api/sse\")\n  ↓ (addEventListener for \"change\" events)\nuseOrgSSE() hook (in _app.tsx layout)\n  ↓ (2s debounce, IGNORED_TABLES filter)\nrevalidator.revalidate() (React Router)\n  ↓ (re-runs all nested loaders)\nFresh data in all pages\n```\n\n### Key Rules for SSE\n\n1. **Layout level only** — Place `useOrgSSE()` in `_app.tsx` layout, not per-page\n2. **Filtered tables** — Ignore `api_keys`, `sessions` (updated on every call, causes feedback loops)\n3. **Exponential backoff** — Start 2s, cap 30s, reset on successful open\n4. **TransformStream proxy** — Never pipe `upstream.body` directly; use TransformStream to avoid locking issues\n5. **No polling** — Never use `setInterval()` as a substitute for SSE\n\n---\n\n## Route Structure (Console as Exemplar)\n\n### Route Registration (MANDATORY)\n\n**Every new route file MUST be registered in `app/routes.ts`.** React Router v7 does NOT auto-discover routes by filename.\n\n```typescript\n// app/routes.ts — explicit registration\nexport default [\n  index(\"routes/_index.tsx\"),                     // / (unauthenticated landing)\n  route(\"login\", \"routes/login.tsx\"),             // /login\n  layout(\"routes/_app.tsx\", [                     // Authenticated layout\n    route(\"dashboard\", \"routes/_app.dashboard.tsx\"),\n    route(\"projects\", \"routes/_app.projects.tsx\"),\n    route(\"projects/:projectId\", \"routes/_app.projects.$projectId.tsx\", [\n      index(\"routes/_app.projects.$projectId._index.tsx\"),\n      route(\"tables\", \"routes/_app.projects.$projectId.tables.tsx\"),\n      // ... nested routes\n    ]),\n    // More authenticated routes...\n    route(\"api/sse\", \"routes/api.sse.ts\"),        // SSE proxy\n    route(\"api/flows/*\", \"routes/api.flows.$.ts\"),  // BFF proxy for /v1/flows/*\n  ]),\n] satisfies RouteConfig;\n```\n\n### Key Route Groups (Console)\n\n| Group | Purpose | Notable Routes |\n|-------|---------|-----------------|\n| **Org Console** | Dashboard + data management | `/dashboard`, `/projects`, `/apps` |\n| **Projects** | Data schema management | `/projects/:projectId/tables`, `/tables/:table` |\n| **Keys** | API key management | `/keys`, `/service-tokens` |\n| **Apps** | Deploy configuration | `/apps`, `/apps/:appId/environments/:envName` |\n| **Pipelines** | Deployment logs | `/pipelines`, `/pipelines/:runId` |\n| **Flows** | AI DAG editor | `/flows`, `/flows/:flowId` |\n| **Agents** | Agentic AI definitions | `/agents`, `/agents/:agentId` |\n| **KAIT** | AI IDE sessions | `/kait`, `/kait/:sessionId` |\n| **Backlog** | Epic Runner (Mission Control) | `/backlog/:productSlug/sprints/:sessionId` |\n| **Vault** | Org docs (git-backed) | `/vault`, `/vault/new`, `/vault/edit/*` |\n| **Settings** | Org-wide settings | `/settings`, `/settings/ai-provider` |\n| **API Routes** | BFF proxies + SSE | `/api/sse`, `/api/flows/*`, `/api/agents/*` |\n\n### Admin Route Structure\n\nSimilar but under `_dashboard` layout (not `_app`):\n- `/dashboard/orgs`\n- `/dashboard/apps`\n- `/dashboard/templates`\n- `/dashboard/keys`, `/dashboard/members`, `/dashboard/tokens`\n- `/dashboard/audit`, `/dashboard/metrics`, `/dashboard/logs`\n- `/dashboard/pipeline-definitions`\n- `/dashboard/paige` (PAIGE chat + work item integration)\n- `/dashboard/board` (backlog board)\n\n---\n\n## File Structure & Imports\n\n### Layout\n\n```\ndev.kapable.console/\n├── app/\n│   ├── routes.ts                 ← MANDATORY explicit route registration\n│   ├── routes/\n│   │   ├── _app.tsx              ← Authenticated layout (sidebar, org SSE hook)\n│   │   ├── _app.*.tsx            ← Pages under authenticated layout\n│   │   ├── login.tsx             ← Public page\n│   │   ├── api.sse.ts            ← BFF SSE proxy\n│   │   ├── api.flows.ts          ← BFF proxy entry\n│   │   └── api.flows.$.ts        ← BFF catch-all proxy\n│   ├── lib/\n│   │   ├── sdk.server.ts         ← KapableClient factory (server-only)\n│   │   ├── session.server.ts     ← Auth helpers (server-only)\n│   │   ├── api-helpers.server.ts ← URL/config helpers (server-only)\n│   │   └── utils.ts              ← Shared utilities (safe for client)\n│   ├── hooks/\n│   │   ├── use-org-sse.ts        ← Layout-level SSE subscription\n│   │   ├── use-current-context.ts ← Extract current project/app from URL\n│   │   ├── use-pipeline-logs.ts  ← Real-time pipeline logs\n│   │   └── useOpenRouterModels.ts ← AI model dropdown\n│   ├── components/\n│   │   ├── sidebar-nav.tsx       ← Left sidebar\n│   │   ├── header-breadcrumb.tsx ← Top breadcrumb\n│   │   ├── command-palette.tsx   ← Cmd+K palette\n│   │   ├── flow/                 ← AI Flows editor components\n│   │   ├── backlog/              ← Epic Runner UI components\n│   │   └── (others)\n│   ├── k8/                       ← KAIT (AI IDE) specific code\n│   ├── app.css                   ← Global styles (Tailwind + custom)\n│   └── root.tsx                  ← React Router root (HTML shell)\n├── public/\n├── vite.config.ts                ← Vite/React Router config\n├── tsconfig.json\n├── package.json\n└── server.ts                      ← Production Bun server\n```\n\n### Import Rules\n\n```typescript\n// ✅ CORRECT — in a loader or action\nimport { getClient } from \"~/lib/sdk.server\";\nimport { requireAuth } from \"~/lib/session.server\";\nimport { getApiBaseUrl } from \"~/lib/api-helpers.server\";\n\n// ❌ WRONG — in a client component\nimport { getClient } from \"~/lib/sdk.server\"; // Build error! Server-only import.\n\n// ❌ WRONG — importing a constant from .server module\nimport { baseUrl } from \"~/lib/sdk.server\"; // Build error! Module-level const.\n\n// ✅ CORRECT — wrap server constants in functions\n// in sdk.server.ts:\nexport function getApiBaseUrl() { return process.env.KAPABLE_API_URL || \"https://api.kapable.dev\"; }\n// in route:\nconst baseUrl = getApiBaseUrl();\n```\n\n---\n\n## SDK Client Usage (Server-Side)\n\n### Creating an Authenticated Client\n\n```typescript\n// In a loader or action:\nimport { getClient } from \"~/lib/sdk.server\";\n\nexport async function loader({ request, params }: Route.LoaderArgs) {\n  const { client, orgId, authMode, keyType } = await getClient(request);\n  \n  // Now use the client\n  const projects = await client.projects.list();\n  const app = await client.apps.get(appId);\n  const flows = await client.flows.list();\n  \n  return { projects, app, flows };\n}\n```\n\n### Client Resources (from @kapable/sdk)\n\n```typescript\nclient.projects.list(opts)          // Paginated list\nclient.projects.get(id)\nclient.projects.create(data)\nclient.projects.update(id, data)\nclient.projects.delete(id)\n\nclient.apps.list(opts)\nclient.apps.get(id)\nclient.apps.create(data)\nclient.apps.deploy(id, envName)\n\nclient.flows.list(opts)\nclient.flows.get(id)\nclient.flows.create(data)\nclient.flows.run(id)\n\nclient.pipelines.list(opts)\nclient.pipelines.get(runId)\nclient.pipelines.logs(runId)\n\nclient.apiKeys.list(orgId, opts)\nclient.apiKeys.create(orgId, data)\nclient.apiKeys.revoke(keyId)\n\nclient.health.check()\nclient.usage.get(orgId)\nclient.usage.auditLogs(opts)\n\n// ... many more\n```\n\n---\n\n## Common Pattern: Loader + Action Page\n\n```typescript\n// routes/_app.my-page.tsx\nimport type { Route } from \"./+types/_app.my-page\";\nimport { getClient } from \"~/lib/sdk.server\";\nimport { requireAdmin } from \"~/lib/session.server\";\nimport { toast } from \"sonner\";\nimport { Button } from \"@kapable/ui/button\";\n\nexport async function loader({ request, params }: Route.LoaderArgs) {\n  const { client } = await getClient(request);\n  const items = await client.someResource.list();\n  return { items };\n}\n\nexport async function action({ request, params }: Route.ActionArgs) {\n  await requireAdmin(request);  // ← FIRST LINE, not optional!\n  \n  const { client } = await getClient(request);\n  const formData = await request.formData();\n  const intent = formData.get(\"intent\");\n  \n  if (intent === \"delete\") {\n    const id = formData.get(\"id\");\n    await client.someResource.delete(id as string);\n    return { success: true };\n  }\n  \n  throw new Error(\"Unknown intent\");\n}\n\nexport default function MyPage() {\n  const { items } = useLoaderData<typeof loader>();\n  const actionData = useActionData<typeof action>();\n  \n  useEffect(() => {\n    if (actionData?.success) {\n      toast.success(\"Deleted successfully!\");\n    }\n  }, [actionData]);\n  \n  return (\n    <div>\n      {items.map(item => (\n        <Form key={item.id} method=\"post\">\n          <input type=\"hidden\" name=\"id\" value={item.id} />\n          <Button type=\"submit\" name=\"intent\" value=\"delete\">\n            Delete\n          </Button>\n        </Form>\n      ))}\n    </div>\n  );\n}\n```\n\n---\n\n## BFF Proxy Routes\n\nAll `/api/*` routes in the console are BFF proxies that forward requests to the Rust API with proper auth headers.\n\n### Example: `/api/flows` Proxy\n\n```typescript\n// routes/api.flows.$.ts\nimport type { LoaderFunctionArgs, ActionFunctionArgs } from \"react-router\";\nimport { getClient, baseUrl } from \"~/lib/sdk.server\";\nimport { getSessionToken } from \"~/lib/session.server\";\n\nasync function getAuthHeaders(request: Request): Promise<Record<string, string>> {\n  const { client: _c, ...authCtx } = await getClient(request);\n  const headers: Record<string, string> = {\n    \"Content-Type\": \"application/json\",\n  };\n  if (authCtx.authMode === \"session\") {\n    const token = await getSessionToken(request);\n    if (token) headers[\"X-Session-Token\"] = token;\n  } else if (authCtx.apiKey) {\n    headers[\"x-api-key\"] = authCtx.apiKey;  // ← Use x-api-key, NOT Authorization\n  }\n  return headers;\n}\n\nexport async function loader({ request, params }: LoaderFunctionArgs) {\n  const path = params[\"*\"] || \"\";\n  const search = new URL(request.url).search;\n  const apiUrl = (path ? `${baseUrl}/v1/flows/${path}` : `${baseUrl}/v1/flows`) + search;\n  const headers = await getAuthHeaders(request);\n  \n  const res = await fetch(apiUrl, { method: request.method, headers });\n  \n  return new Response(res.body, {\n    status: res.status,\n    headers: { \"Content-Type\": \"application/json\" },\n  });\n}\n\nexport async function action({ request, params }: ActionFunctionArgs) {\n  const path = params[\"*\"] || \"\";\n  const apiUrl = `${baseUrl}/v1/flows/${path}`;\n  const headers = await getAuthHeaders(request);\n  const body = await request.text();\n  \n  const res = await fetch(apiUrl, {\n    method: request.method,\n    headers,\n    body: request.method !== \"GET\" ? body : undefined,\n  });\n  \n  return new Response(res.body, {\n    status: res.status,\n    headers: { \"Content-Type\": res.headers.get(\"Content-Type\") || \"application/json\" },\n  });\n}\n```\n\n**Why?** Avoids CORS issues + centralizes auth logic.\n\n---\n\n## SSE Proxy Route\n\n```typescript\n// routes/api.sse.ts\nimport { requireAuth } from \"~/lib/session.server\";\nimport type { LoaderFunctionArgs } from \"react-router\";\n\nconst baseUrl = process.env.KAPABLE_API_URL || \"https://api.kapable.dev\";\n\nexport async function loader({ request }: LoaderFunctionArgs) {\n  const auth = await requireAuth(request);\n  \n  const url = new URL(request.url);\n  const tables = url.searchParams.get(\"tables\");\n  const projectId = url.searchParams.get(\"projectId\");\n  \n  const sseUrl = new URL(`${baseUrl}/v1/sse`);\n  if (tables) sseUrl.searchParams.set(\"tables\", tables);\n  \n  const headers: Record<string, string> = { Accept: \"text/event-stream\" };\n  \n  if (auth.authMode === \"apikey\") {\n    headers[\"Authorization\"] = `Bearer ${auth.apiKey}`;\n  } else {\n    headers[\"X-Session-Token\"] = auth.sessionToken;\n    if (projectId) sseUrl.searchParams.set(\"projectId\", projectId);\n  }\n  \n  const controller = new AbortController();\n  const upstream = await fetch(sseUrl.toString(), { headers, signal: controller.signal });\n  \n  if (!upstream.ok || !upstream.body) {\n    return new Response(\"SSE unavailable\", { status: 502 });\n  }\n  \n  const { readable, writable } = new TransformStream();\n  upstream.body.pipeTo(writable).catch(() => {});\n  \n  request.signal.addEventListener(\"abort\", () => controller.abort(), { once: true });\n  \n  return new Response(readable, {\n    status: 200,\n    headers: {\n      \"Content-Type\": \"text/event-stream\",\n      \"Cache-Control\": \"no-cache, no-store, must-revalidate\",\n      Connection: \"keep-alive\",\n      \"X-Accel-Buffering\": \"no\",\n    },\n  });\n}\n```\n\n---\n\n## Adding a New Page (Step-by-Step)\n\n### 1. Create the route file\n```typescript\n// app/routes/_app.my-new-page.tsx\nimport type { Route } from \"./+types/_app.my-new-page\";\nimport { getClient } from \"~/lib/sdk.server\";\nimport { requireAdmin } from \"~/lib/session.server\";\nimport { Button } from \"@kapable/ui/button\";\nimport { useLoaderData } from \"react-router\";\n\nexport async function loader({ request }: Route.LoaderArgs) {\n  const { client } = await getClient(request);\n  const data = await client.someResource.list();\n  return { data };\n}\n\nexport default function MyNewPage() {\n  const { data } = useLoaderData<typeof loader>();\n  return <div>Data: {data.length}</div>;\n}\n```\n\n### 2. Register in app/routes.ts\n```typescript\n// BEFORE:\nroute(\"settings\", \"routes/_app.settings.tsx\"),\nroute(\"account\", \"routes/_app.account.tsx\"),\n\n// AFTER:\nroute(\"settings\", \"routes/_app.settings.tsx\"),\nroute(\"my-new-page\", \"routes/_app.my-new-page.tsx\"),  // ← ADD HERE\nroute(\"account\", \"routes/_app.account.tsx\"),\n```\n\n### 3. Add to sidebar navigation\nEdit `app/components/sidebar-nav.tsx` to include a nav item linking to `/my-new-page`.\n\n### 4. Test locally\n```bash\nbun dev\n# Navigate to http://localhost:3005/my-new-page\n```\n\n### 5. Build verification\n```bash\nbun build\n# Ensure no TypeScript errors, no \"unknown route\" warnings\n```\n\n---\n\n## Auth Guards & Security\n\n### requireAuth() — Redirect to /login if not authenticated\n```typescript\nexport async function loader({ request }: Route.LoaderArgs) {\n  const auth = await requireAuth(request);\n  // If not authenticated, this throws a redirect\n  // auth.orgId, auth.sessionToken, auth.apiKey, etc. are now available\n}\n```\n\n### requireAdmin() — Throw 403 if not admin\n```typescript\nexport async function action({ request }: Route.ActionArgs) {\n  await requireAdmin(request);  // MUST be first line in actions!\n  // Only admins/owners (or admin API keys) reach here\n}\n```\n\n### canManageEnvironment() — Check if user can deploy\n```typescript\nexport async function action({ request }: Route.ActionArgs) {\n  const canDeploy = await canManageEnvironment(request);\n  if (!canDeploy) throw new Response(\"Forbidden\", { status: 403 });\n}\n```\n\n---\n\n## Environment Variables\n\n| Variable | Required | Example |\n|----------|----------|---------|\n| `KAPABLE_API_URL` | Yes | `http://localhost:3003` or `https://api.kapable.dev` |\n| `SESSION_SECRET` | Yes | 32+ char random string (never commit!) |\n| `AUTH_BASE_URL` | No | `https://auth.kapable.dev` (for OAuth providers) |\n| `APP_URL` | No | `https://console.kapable.dev` (for OAuth redirect) |\n| `PORT` | No | 3005 (default) |\n| `NODE_ENV` | No | `development` or `production` |\n\n**CRITICAL:** `.env` file is excluded from rsync deploys. Production `.env` is managed separately on the server.\n\n---\n\n## Shared Packages Integration\n\n### @kapable/ui Integration\n```typescript\nimport { Button } from \"@kapable/ui/button\";\nimport { Dialog, DialogContent, DialogTrigger } from \"@kapable/ui/dialog\";\nimport { Input } from \"@kapable/ui/input\";\nimport { Toaster } from \"@kapable/ui/sonner\";\n\n// In root.tsx:\nexport default function Root() {\n  return (\n    <>\n      <Outlet />\n      <Toaster />\n    </>\n  );\n}\n```\n\n### @kapable/pipeline-ui Integration\n```typescript\nimport {\n  PipelineYamlEditor,\n  PipelineLogViewer,\n  PipelineCanvas,\n  reconstructStagesFromEvents,\n} from \"@kapable/pipeline-ui\";\nimport \"@kapable/pipeline-ui/styles\";\n\n// In a page:\nexport default function PipelineEditor() {\n  return (\n    <PipelineYamlEditor\n      yaml={pipelineYaml}\n      onChange={setPipelineYaml}\n      readOnly={false}\n    />\n  );\n}\n```\n\n### @kapable/sdk Integration\n```typescript\nimport { KapableClient } from \"@kapable/sdk\";\n\n// Server-side only:\nconst client = new KapableClient({\n  baseUrl: \"http://localhost:3003\",\n  apiKey: \"pk_...\",\n});\nconst projects = await client.projects.list();\n```\n\n---\n\n## Deployment\n\n### Connect App Pipeline (Recommended)\n\nEach frontend is a \"Connect App\" deployed via the Platform's deployment pipeline.\n\n| App | Environment | App ID |\n|-----|-------------|--------|\n| Console | production | `9ee900e7-3d10-46f1-b59b-bade220cfaa4` |\n| Admin | production | `abee3d58-259b-4454-9147-df67c0b74de6` |\n| Developer | production | `81e66cfd-84fa-4cae-a497-2d7f07e8f801` |\n\n```bash\n# Deploy Console (after commit + push)\ncurl -X POST \"https://api.kapable.dev/v1/apps/9ee900e7-3d10-46f1-b59b-bade220cfaa4/environments/production/deploy\" \\\n  -H \"x-api-key: sk_admin_61af775f967c434dbace3877ade456b8\"\n\n# Pipeline will:\n# 1. git clone the repo\n# 2. bun install\n# 3. bun run build\n# 4. Start the server (server.ts via supervisor)\n```\n\n**CRITICAL:** Always commit and push before deploying. The pipeline clones from git.\n\n### Build Verification Before Deploy\n\n```bash\n# From dev.kapable.console/\nbun build\n# Should produce: build/ directory with no errors\n\n# Also check the SDK (if modified):\ncd ../dev.kapable.sdk && bun run build\ncd ../dev.kapable.console && bun install  # Re-link\nbun build\n```\n\n---\n\n## Common Gotchas & Troubleshooting\n\n### 1. \"Cannot find module ~/lib/sdk.server\"\n**Cause:** Trying to import `.server` module in a client component.\n**Fix:** Only import `.server` modules in loaders/actions, not in components.\n\n### 2. \"Module not found: baseUrl (from sdk.server.ts)\"\n**Cause:** Importing a module-level constant from `.server` in a route file.\n**Fix:** Wrap the constant in a function:\n```typescript\n// sdk.server.ts\nexport function getApiBaseUrl() {\n  return process.env.KAPABLE_API_URL || \"https://api.kapable.dev\";\n}\n\n// In route file:\nimport { getApiBaseUrl } from \"~/lib/sdk.server\";\nconst baseUrl = getApiBaseUrl();\n```\n\n### 3. \"404 Not Found\" for a new route\n**Cause:** Forgot to register the route in `app/routes.ts`.\n**Fix:** Add the route to `routes.ts` with the correct file path.\n\n### 4. SSE stops updating after 30 seconds\n**Cause:** Backoff timer maxed out; check browser console for error.\n**Fix:** Check CORS headers, auth token validity, and backend API health.\n\n### 5. \"ReferenceError: process is not defined\"\n**Cause:** Trying to use `process.env.FOO` in a client component.\n**Fix:** Only use env vars in `.server` files or loaders. For client-side: use `window.__env__` injected by server.\n\n### 6. \"Silent errors in toast notifications\"\n**Cause:** Catch block without `toast.error()`.\n**Fix:** Always report errors: `catch (e) { toast.error(e instanceof Error ? e.message : \"Error\"); }`\n\n### 7. \"Type mismatch: API returns { data: [...] } but I expected [...]\"\n**Cause:** SDK often wraps responses in `{ data: [...], pagination: {...} }`.\n**Fix:** Destructure: `const { data } = await client.projects.list(); for (const p of data) { ... }`\n\n### 8. \"Page shows loading skeleton forever\"\n**Cause:** Loader threw an error but didn't handle it.\n**Fix:** Catch errors in loaders, return fallback data or rethrow with proper status.\n\n### 9. \"x-api-key vs Authorization header confusion\"\n**Cause:** API expects `x-api-key` for admin calls but `Authorization: Bearer` for data calls.\n**Fix:** In BFF proxies:\n- Admin calls: `headers[\"x-api-key\"] = auth.apiKey`\n- Data calls: `headers[\"Authorization\"] = `Bearer ${auth.apiKey}``\n\n### 10. \"SSE lagged error, page stuck\"\n**Cause:** Too many tables subscribed or DB under heavy load.\n**Fix:** Filter to relevant tables only: `new EventSource(\"/api/sse?tables=projects,apps\")`\n\n---\n\n## Real-World Example: Add a \"Deployments\" Management Page\n\n### Step 1: Create loader + action\n```typescript\n// app/routes/_app.deployments-new.tsx\nimport type { Route } from \"./+types/_app.deployments-new\";\nimport { getClient } from \"~/lib/sdk.server\";\nimport { requireAdmin } from \"~/lib/session.server\";\nimport { redirect } from \"react-router\";\nimport { Button } from \"@kapable/ui/button\";\nimport { Input } from \"@kapable/ui/input\";\nimport { toast } from \"sonner\";\nimport { useActionData } from \"react-router\";\nimport { Form } from \"react-router\";\n\nexport async function loader({ request }: Route.LoaderArgs) {\n  // No data needed — just verify auth\n  await requireAdmin(request);\n  return {};\n}\n\nexport async function action({ request }: Route.ActionArgs) {\n  await requireAdmin(request);\n  \n  const { client } = await getClient(request);\n  const formData = await request.formData();\n  const appId = formData.get(\"appId\") as string;\n  const envName = formData.get(\"envName\") as string;\n  \n  if (!appId || !envName) {\n    return { error: \"appId and envName required\" };\n  }\n  \n  try {\n    const result = await client.apps.deploy(appId, envName);\n    return redirect(`/deployments/${result.deployment_id}`);\n  } catch (e) {\n    return { error: e instanceof Error ? e.message : \"Deploy failed\" };\n  }\n}\n\nexport default function DeploymentNew() {\n  const actionData = useActionData<typeof action>();\n  \n  return (\n    <div className=\"space-y-6\">\n      <h1 className=\"text-2xl font-semibold\">New Deployment</h1>\n      \n      {actionData?.error && (\n        <div className=\"bg-red-50 p-4 rounded\">\n          {actionData.error}\n        </div>\n      )}\n      \n      <Form method=\"post\" className=\"space-y-4\">\n        <div>\n          <label>App ID</label>\n          <Input name=\"appId\" required />\n        </div>\n        <div>\n          <label>Environment</label>\n          <Input name=\"envName\" required placeholder=\"production\" />\n        </div>\n        <Button type=\"submit\">Deploy</Button>\n      </Form>\n    </div>\n  );\n}\n```\n\n### Step 2: Register in routes.ts\n```typescript\nroute(\"deployments-new\", \"routes/_app.deployments-new.tsx\"),\n```\n\n### Step 3: Add to sidebar\nEdit `sidebar-nav.tsx` to include:\n```typescript\n{\n  icon: Zap,\n  label: \"New Deployment\",\n  href: \"/deployments-new\",\n}\n```\n\n---\n\n## Testing Checklist\n\nBefore claiming a feature is done:\n\n- [ ] Route registered in `app/routes.ts` ✓\n- [ ] `requireAuth(request)` or `requireAdmin(request)` as first line in actions ✓\n- [ ] Error handling with `toast.error()` for all API calls ✓\n- [ ] No `window.alert()` or `window.confirm()` — use shadcn dialogs ✓\n- [ ] SSR data fetching in loader, not client-side with `useState` ✓\n- [ ] No for-loops using `.forEach()` — use `for...of` ✓\n- [ ] No polling — use SSE where real-time is needed ✓\n- [ ] Mobile-responsive (test at 375px, 768px) ✓\n- [ ] No silent catch blocks — always log/toast errors ✓\n- [ ] `bun build` succeeds with no TypeScript errors ✓\n- [ ] Works locally at `http://localhost:3005` ✓\n- [ ] Commit + push before deploying ✓\n\n---\n\n## Summary\n\nThe Kapable frontend subsystem is a **modern, full-stack TypeScript BFF architecture** built on React Router v7 and Bun. Key principles:\n\n1. **Explicit routing** — Routes must be registered in `routes.ts`\n2. **Server-side rendering** — Data fetched in loaders before render\n3. **Real-time via SSE** — Not polling; PostgreSQL WAL → browser\n4. **Shared packages** — @kapable/ui, @kapable/sdk, @kapable/pipeline-ui via symlinks\n5. **Auth first** — Every action must guard with `requireAuth` or `requireAdmin`\n6. **Error transparency** — All errors reported via toast, never silent\n7. **Deployment via pipeline** — Use Connect App Pipeline, not manual SSH/rsync\n8. **Clean code** — Prefer for-loops, ban alert/confirm, no .server imports in components\n\nThis document provides the mental model needed to confidently navigate, extend, and deploy the Kapable frontend platform."}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":4,"cache_creation_input_tokens":264,"cache_read_input_tokens":73005,"output_tokens":8881,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":264},"inference_geo":"","iterations":[],"speed":"standard"}},"requestId":"req_011CZ68RioW4pSi3JLXk3KUG","type":"assistant","uuid":"1db222d8-a49a-4391-832b-b578b10614b2","timestamp":"2026-03-16T04:30:14.617Z","userType":"external","cwd":"/Users/hgeldenhuys/WebstormProjects/kapable/dev.kapable.koncierge","sessionId":"ec7b47a1-b6c0-49e6-8669-8ddbac3d6856","version":"2.1.76","gitBranch":"main","slug":"ethereal-marinating-yeti"}
{"parentUuid":"1db222d8-a49a-4391-832b-b578b10614b2","isSidechain":true,"agentId":"a1a7d023635f91e34","type":"progress","data":{"type":"hook_progress","hookEvent":"SubagentStop","hookName":"SubagentStop","command":"bun $CLAUDE_PROJECT_DIR/.claude/claude-code-sdk/bin/hooks.ts --config $CLAUDE_PROJECT_DIR/hooks.yaml"},"parentToolUseID":"5fcdb593-a3bf-4b90-9e18-e170f3049809","toolUseID":"5fcdb593-a3bf-4b90-9e18-e170f3049809","timestamp":"2026-03-16T04:30:14.661Z","uuid":"8b7c49fb-63c4-4dd5-8b06-81916366bb40","userType":"external","cwd":"/Users/hgeldenhuys/WebstormProjects/kapable/dev.kapable.koncierge","sessionId":"ec7b47a1-b6c0-49e6-8669-8ddbac3d6856","version":"2.1.76","gitBranch":"main","slug":"ethereal-marinating-yeti"}
---

## Summary\n\nI have completed a comprehensive exploration of the Kapable pipeline engine and agent daemon. Here's what I've documented:\n\n### **Document Created: 03-pipeline-engine.md**\n\n**Comprehensive Coverage (~20K tokens worth of content):**\n\n1. **Overview** — DAG-based orchestration, YAML definitions, 11+ step types, real-time event streaming, distributed agents\n\n2. **Core Types** — PipelineDefinition, StageDefinition, StepDefinition (enum), AgentStepDef, MatrixDefinition, runtime state types (PipelineRun, StageRun, StepRun), PipelineEvent\n\n3. **Executor (DAG Runtime)** — execution flow (validate → build DAG → group into levels → execute levels → handle retries → finally stages → emit events), concurrency limits, environment allowlist, cancellation, timeout handling\n\n4. **Step Runners** — BashStepRunner, GateStepRunner, ApprovalStepRunner, AgentStepRunner (Claude Code headless sessions), HTTP/Health/Artifact/Container/Deploy runners\n\n5. **Event System** — EventSink trait, 8 implementations (NoopEventSink, BroadcastEventSink, DatabaseEventSink, LoggingEventSink, MultiEventSink, FilteredEventSink, StageStepRunEventSink, StepLogEventSink), event routing, event replay for late subscribers\n\n6. **Agent Daemon** — architecture (register → heartbeat → long-poll → execute → report), daemon loop, job execution flow, workspace management (persistent vs ephemeral), GitHub token acquisition (connect app for read, develop app for write)\n\n7. **API Endpoints** — agent self-service (register, heartbeat, claim job, start job, complete job, clone token, ingest events), admin endpoints, pipeline viewing (list runs, get run detail, get logs, get event history)\n\n8. **GitHub Integration** — two-app model (Connect app read-only, Develop app read-write), clone token flow, push token flow\n\n9. **Database Schema** — 7 pipeline tables with full descriptions, indexes, row-level security (RLS) scoped to org\n\n10. **Template & Expression System** — `{{ VAR }}` interpolation, `${{ EXPR }}` boolean expressions, supported operators\n\n11. **Gotchas & Troubleshooting** — event table separation, stage counter updates, concurrency groups, matrix edge cases, agent heartbeat timeouts, workspace cleanup, secret masking\n\n12. **YAML Format Examples** — simple pipeline, variables & conditions, matrix expansion, agent steps\n\n13. **Performance & Limits** — table of key parameters and limits\n\n14. **Key Design Principles** — declarative YAML, DAG-based parallelism, real-time streaming, distributed execution, fault tolerance, multi-tenancy, immutability, composability\n\n15. **Testing** — 1000+ tests, unit/integration/E2E coverage\n\n---\n\n**Key Insights Discovered:**\n\n- **Slot DSL** is a platform-specific abstraction layer for Connect App deployments (slot-provision, slot-upload, slot-health, slot-cleanup) that injects infrastructure context at runtime\n- **AgentStepRunner** spawns Claude CLI with `--output-format stream-json`, heartbeat timeout (default 300s), hooks_settings injection for permission overrides\n- **Matrix expansion** uses cartesian product with deterministic ordering (sorted keys) + include/exclude filtering\n- **Two-event-table model**: `pipeline_events` (immutable log), `pipeline_step_logs` (line-by-line output with sequence counter)\n- **Workspace management** balances persistence (fast rebuilds) vs ephemeral (cleanup)\n- **GitHub tokens** are short-lived OAuth tokens acquired per-request, scoped by app (Connect for read, Develop for write)\n- **RLS enforcement** via `current_setting('kapable.org_id')` — admin sets to NULL for unrestricted queries\n\nThe document is ready to be written to `/Users/hgeldenhuys/WebstormProjects/kapable/dev.kapable.koncierge/knowledge/subsystems/03-pipeline-engine.md` once you're ready to receive file write operations."}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":3,"cache_creation_input_tokens":275,"cache_read_input_tokens":99127,"output_tokens":1019,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":275},"inference_geo":"","iterations":[],"speed":"standard"}},"requestId":"req_011CZ68WrENeWro2WjphedJr","type":"assistant","uuid":"04a9d24b-69e5-4d93-9540-862703ef779c","timestamp":"2026-03-16T04:30:23.567Z","userType":"external","cwd":"/Users/hgeldenhuys/WebstormProjects/kapable/dev.kapable.koncierge","sessionId":"ec7b47a1-b6c0-49e6-8669-8ddbac3d6856","version":"2.1.76","gitBranch":"main","slug":"ethereal-marinating-yeti"}
{"parentUuid":"04a9d24b-69e5-4d93-9540-862703ef779c","isSidechain":true,"agentId":"abaa63ad94b0c5a32","type":"progress","data":{"type":"hook_progress","hookEvent":"SubagentStop","hookName":"SubagentStop","command":"bun $CLAUDE_PROJECT_DIR/.claude/claude-code-sdk/bin/hooks.ts --config $CLAUDE_PROJECT_DIR/hooks.yaml"},"parentToolUseID":"a16a95ab-1229-43d0-8f5c-59188b3d501b","toolUseID":"a16a95ab-1229-43d0-8f5c-59188b3d501b","timestamp":"2026-03-16T04:30:23.589Z","uuid":"64363f88-90f8-4d91-9b50-a153b16ee541","userType":"external","cwd":"/Users/hgeldenhuys/WebstormProjects/kapable/dev.kapable.koncierge","sessionId":"ec7b47a1-b6c0-49e6-8669-8ddbac3d6856","version":"2.1.76","gitBranch":"main","slug":"ethereal-marinating-yeti"}
---

## Epic Runner — Autonomous Sprint Execution Engine\n\n**Epic Runner** is a Rust CLI for ceremony-as-data sprint execution on the Kapable platform. It orchestrates multi-sprint epics, dispatches Claude Code agents, evaluates verdicts, and persists results to the Data API.\n\nThe system was architected around two execution engines: a **pipeline engine** (now default) and a **ceremony engine** (legacy, removed). Only the pipeline engine remains active.\n\n**Binary location:** `~/.local/bin/epic-runner`  \n**Source:** `/Users/hgeldenhuys/WebstormProjects/kapable/dev.kapable.epic-runner/`  \n**Tests:** 131 integration tests + 7 agent definitions\n\n---\n\n## 1. Overview\n\n**Epic Runner** builds on ceremony-as-data: sprints are workflows defined as YAML DAGs, executed via Claude agents, verified by judges, and persisted to Kapable tables.\n\n**Key capabilities:**\n- Autonomous sprints: Select 3–5 ready stories, execute in parallel/serial via Claude, judge results\n- Multi-sprint epics: Loop until intent satisfied or blocker hit\n- Real-time Data API: All state lives in Kapable tables (stories, epics, sprints, events)\n- Distributed execution: Pipeline engine dispatches to kapable-agent daemon\n- Stop-gate enforcement: Builders cannot exit until tasks are done or story is blocked\n- Write-back: Builder output (task completion, AC verification) automatically patches stories\n- Retrospectives: Resume builder sessions post-sprint for learnings capture\n\n---\n\n## 2. Commands\n\n### Init\n```bash\nepic-runner init [--name NAME] [--project-id UUID] [--data-key sk_live_...]\n```\nCreates Kapable project, provisions 15 tables via `PUT /v1/_meta/tables/{name}`, writes `.epic-runner/config.toml`.\n\n### Product\n```bash\nepic-runner product create --name NAME --slug SLUG --repo-path /path\nepic-runner product list|show|update\n```\nManage codebases. Fields: name, slug, repo_path, story_prefix, brief, definition_of_done, deploy_profile, deploy_app_id.\n\n### Backlog\n```bash\nepic-runner backlog add --title \"...\" --product NAME --epic CODE [--intent \"so that\"] [--persona \"user\"]\nepic-runner backlog list|show|transition|delete\nepic-runner backlog task-done STORY_CODE INDEX [--outcome \"note\"]\nepic-runner backlog ac-verify STORY_CODE INDEX [--evidence \"...\"]\nepic-runner backlog block STORY_CODE --reason \"...\"\nepic-runner backlog park STORY_CODE\n```\nStory CRUD. Statuses: draft → ready → planned → in_progress → done/deployed/blocked/parked/rejected.\n\n### Epic\n```bash\nepic-runner epic create --product NAME --domain AUTH --title \"...\" --intent \"...\"\nepic-runner epic list|show|close|abandon|health\n```\nMulti-sprint narratives. Generates unique code: DOMAIN-NNN (e.g., AUTH-001).\n\n### Sprint\n```bash\nepic-runner sprint list|show\n```\nView sprint history (read-only). Stored in `er_sprints` table.\n\n### Orchestrate (Main)\n```bash\nepic-runner orchestrate AUTH-001 [--max-sprints 20] [--dry-run] [--log-dir .epic-runner/logs]\n```\nExecute epic: create sprints, select stories, run pipeline, judge verdict, write results, iterate.\n\n**Flow:**\n1. Pre-flight auth check\n2. For each sprint (up to --max-sprints):\n   - Create sprint record\n   - Select 3–5 eligible stories (ready > planned > draft, fewest attempts first)\n   - Generate pipeline YAML\n   - Submit to `/v1/pipelines/run` (admin key)\n   - Poll for completion\n   - Parse judge verdict\n   - Write builder results back to stories\n   - Evaluate: intent_satisfied → close epic; more work → sprint N+1; blocked → pause\n\n**Exit conditions:** Intent satisfied, no eligible stories, blocker found, max sprints reached.\n\n### Pipeline\n```bash\nepic-runner pipeline generate AUTH-001 [--sprint N] [--parallel] [--model opus] [--budget 5.0]\nepic-runner pipeline submit pipeline.yaml [--wait] [--repo-url git@...] [--repo-ref branch]\n```\nLow-level: generate YAML for inspection, submit pre-generated YAML.\n\n### Research\n```bash\nepic-runner research add|list|show|link|unlink\n```\nManage research notes linked to stories (injected into groomer via `{{research_notes}}`).\n\n### Impediment\n```bash\nepic-runner impediment add|list|resolve\n```\nCross-epic blockers. Blocks orchestration if open.\n\n### Status\n```bash\nepic-runner status\n```\nDashboard: active epics, recent sprints, open impediments, story counts, daemon health.\n\n---\n\n## 3. Orchestration Flow\n\n```\norchestrate AUTH-001\n├─ Pre-flight: claude CLI available, API credentials valid, acquire lock\n├─ Load epic (fail if not active or blocked)\n├─ For each sprint (up to --max-sprints):\n│  ├─ Create sprint record\n│  ├─ Select eligible stories (first 5, sorted by attempt_count, status, code)\n│  ├─ Transition stories to \"planned\"\n│  ├─ Generate pipeline YAML\n│  │  ├─ Load product brief, epic intent, DoD rules\n│  │  ├─ Load agent definitions (builder, judge, scrum-master)\n│  │  ├─ Generate stages: source, build-*, judge, commit, merge, deploy, retro-*, output\n│  │  └─ Inject hooks_settings (stop-gate, track-files)\n│  ├─ Submit pipeline to /v1/pipelines/run (admin key)\n│  ├─ Poll for completion (exponential backoff)\n│  ├─ Fetch builder output from completed build stages\n│  ├─ Write results back to stories (tasks done, ACs verified, changed files)\n│  ├─ Parse judge verdict JSON\n│  ├─ Evaluate verdict\n│  │  ├─ intent_satisfied=true OR mission_progress>=100 → SATISFIED (close epic, break)\n│  │  ├─ provisional=true → PROVISIONAL (code OK, deploy pending)\n│  │  └─ Otherwise → NOT_SATISFIED (ready incomplete stories, sprint N+1)\n│  └─ Handle outcome (close, continue, block, error)\n└─ Cleanup: release lock, mark daemon stopped\n```\n\n**Key points:**\n- Story selection: Greedy first 5, sorted by attempt_count (untried before retried), status, code\n- DoR warning: If stories lack ACs/tasks, warn but continue (builder self-grooms inline)\n- Sprint goal: First sprint inherits epic intent; later sprints use judge's `next_sprint_goal`\n- Daemon registration: Health monitoring for Platform Historian\n- Lock management: PID-based, dead-process recovery\n\n---\n\n## 4. Pipeline Engine\n\nGenerates a `PipelineDefinition` (DAG) executed by Kapable agent daemon.\n\n**Stages:**\n1. `source` — Git checkout epic branch, emit story JSON as output vars\n2. `build-{code}` — One agent step per story (serial or parallel)\n3. `judge-code` — Code quality review\n4. `commit-merge` — Git add, commit, push epic branch\n5. `merge-main` — Merge epic branch to default branch (graceful conflict handling)\n6. `deploy` — Conditional: curl to Connect App Pipeline\n7. `retro-{code}` — Resume builder session for retrospective\n8. `output` — Sprint summary\n\n**Execution:**\n- Agent daemon clones repo into `PIPELINE_WORKSPACE`\n- Kahn's topological sort schedules stages\n- Bash steps execute directly\n- Agent steps dispatch: `claude -p --session-id UUID --settings hooks_json --output-format stream-json`\n- Stream-json parsed into `ceremony_events` table\n- Output variables: `##kapable[set name=var]value`\n\n---\n\n## 5. Pipeline Generator\n\n**File:** `src/pipeline_generator.rs`\n\n**Input:** `SprintPipelineContext` — epic code, sprint number, session ID, 3–5 stories, product brief, epic intent, agent definitions, hooks, deploy profile, API credentials.\n\n**Per-story:**\n- Code, ID, title, description, ACs (display text), tasks (display text), full story JSON\n- Dependencies: serial → chain; parallel → all depend on source\n\n**System prompt injection:**\n- Builders get: builder.md + product brief + previous learnings\n- Judge gets: code-judge.md + product brief\n- Scrum-master gets: scrum-master.md\n\n**Output:** `PipelineDefinition` with all stages, steps, dependencies, env vars, hooks settings.\n\n---\n\n## 6. Write-Back System\n\n**File:** `src/builder.rs`, `src/judge.rs`\n\nBuilder output parsed and written back to story records.\n\n**Schema:**\n```rust\nBuilderOutput {\n    stories: [{\n        id: UUID,\n        code: \"AUTH-010\",\n        status: \"done|blocked|in_progress\",\n        blocked_reason: \"...\",\n        tasks: [{ description, done: true, outcome }],\n        acceptance_criteria: [{ criterion, verified: true, evidence }],\n        changed_files: [\"src/auth.rs\"],\n        log_entries: [{ summary, session_id, sprint_id }],\n        action_items: [{ description, source_story, status }],\n    }]\n}\n```\n\n**Process:**\n1. Fetch logs from `/v1/pipeline-runs/{run_id}/logs?stage_id=build-{code}`\n2. Extract JSON: bare, markdown-fenced, with preamble\n3. Deserialize to `BuilderOutput`\n4. For each story: build updated tasks array, ACs array, set changed_files, log_entries, action_items\n5. PATCH `/v1/stories/{id}` with all fields\n\n**Critical note:** Reads from pipeline logs, not `ceremony_events` table (which is for real-time only).\n\n---\n\n## 7. Agent Definitions\n\n**File:** `src/agents.rs` (embedded via `include_str!`)\n\nSeven roles in `agents/` directory:\n\n### builder.md (Opus)\nSprint execution. Responsibilities:\n- Implement stories end-to-end\n- Mark tasks done: `epic-runner backlog task-done STORY_CODE INDEX`\n- Verify ACs: `epic-runner backlog ac-verify STORY_CODE INDEX`\n- Output JSON: `{\"stories\": [...]}`\n\nHooks active: Stop-gate (blocks if tasks incomplete), Track-files (records changed files).\nModel: opus. Budget: 5 USD per story.\n\n### code-judge.md (Sonnet)\nCode review. Evaluate ACs, test coverage, product DoD.\nOutput JSON: `{\"intent_satisfied\": bool, \"mission_progress\": 0-100, \"action_items\": [...]}`\n\n### scrum-master.md (Sonnet)\nRetrospective. Interview builder: what went well, what to improve.\nOutput JSON: `{\"learnings\": \"...\", \"went_well\": [...], \"improve\": [...]}`\nResume: true (reconnects to builder session).\n\n### researcher.md (Sonnet)\nCodebase research (standalone, not in pipeline).\n\n### groomer.md (Sonnet)\nStory grooming (standalone, not in pipeline).\nTemplate var: `{{research_notes}}` injected.\n\n### ab-judge.md (Sonnet + Chrome)\nA/B browser testing (specialized judge).\n\n### rubber-duck.md (Haiku)\nDebugging stuck states (legacy ceremony engine).\n\n**Resolution:**\n1. Check `.claude/agents/{name}.md` in repo (user override)\n2. Write embedded agent to `/tmp/epic-runner-agents/{name}.md`\n3. Return absolute path for `--agent` flag\n\n**Variable substitution:** `resolve_agent_path_with_vars(\"groomer\", repo_path, &{\"research_notes\": \"...\"})`\n\n---\n\n## 8. Story Model\n\n**File:** `src/types.rs`\n\n```rust\nStory {\n    id: Uuid,\n    product_id: Uuid,\n    code: \"ER-042\",                        // product-scoped sequential\n    title: \"User logs in with email\",      // WHAT (verb-led outcome)\n    intent: \"so that users access org\",    // WHY (measurable outcome)\n    persona: \"app user\",                   // WHO\n    description: \"...\",\n    epic_code: \"AUTH-001\",\n    status: draft|ready|planned|in_progress|done|deployed|blocked|parked|rejected,\n    points: 8,\n    acceptance_criteria: [{criterion, title, given, when, then, testable_by, verified, evidence}],\n    tasks: [{description, persona, done, outcome}],\n    dependencies: [\"ER-016\", \"ER-017\"],    // Must complete first\n    planned_at: \"2026-03-15T...\",         // Grooming timestamp\n    attempt_count: 2,                      // Incremented each sprint\n    blocked_reason: \"...\",\n    changed_files: [\"src/auth.rs\"],\n    log_entries: [{summary, session_id, sprint_id}],\n    plan: {approach, risks, estimated_turns},\n    action_items: [{description, source_story, status}],\n}\n```\n\n**Statuses:**\n- Draft: ungroomed\n- Ready: groomed, eligible for sprint\n- Planned: selected for current sprint\n- In progress: builder working\n- Done: all tasks + ACs done\n- Deployed: merged to main\n- Blocked: impediment, escape hatch\n- Parked: shelved, not in rotation\n- Rejected: judge says no, won't retry\n\n**Eligibility for sprint:** Only draft, ready, planned.\n\n**Selection:** Greedy (first 5), sorted by attempt_count (untried first), status (ready > planned > draft), code (ascending).\n\n---\n\n## 9. Stop-Gate Hook\n\n**File:** `hooks/stop-gate.sh` (embedded, written to `/tmp/epic-runner-hooks/`)\n\nEnforces task completion before session exit.\n\n**Modes:**\n\nA. **Executor** (orchestration): `EPIC_RUNNER_STORIES_CACHE` env var set, fast local check.\n\nB. **Manual** (human-run session): No env vars, API fallback: `GET /v1/stories/{session_id}`.\n\n**Logic:**\n1. Read story (local or API)\n2. If blocked + reason set → allow stop\n3. If 0 tasks AND 0 ACs → ungroomed, BLOCK\n4. If N tasks, < N done → BLOCK with CLI instructions\n5. Max 3 iterations (safety valve)\n6. Exit 0 (allow) or 2 (block)\n\n**Output on block:** Lists incomplete tasks with indices, shows `epic-runner backlog task-done` commands.\n\n**Side effect:** Auto-commits staged changes with message including task count, changed files.\n\n---\n\n## 10. Data API Integration\n\n**Authentication:**\n- Admin key (`sk_admin_*`): Project provisioning, pipeline submission\n- Data key (`sk_live_*`): Story CRUD, table reads/writes\n- Service token (`st_ci_*`): CI/CD execution\n\n**Cascade:** CLI flag → env var → .epic-runner/config.toml → ~/.epic-runner/config.toml → error\n\n**Key-scoped routing:** All routes `/v1/{table_name}`. API key in `x-api-key` header determines project access.\n\n**Tables (created by init):**\n- products, stories, epics, er_sprints, impediments\n- sprint_assignments, ceremony_events, supervisor_decisions, rubber_duck_sessions\n- sprint_learnings, research_artifacts, research_notes, story_research_links, daemon_status\n\n**Request/response shapes:**\n- GET /v1/{table} → `{\"data\": [...], \"pagination\": {...}}`\n- GET /v1/{table}/{id} → bare JSON\n- POST /v1/{table} → bare JSON (created)\n- PATCH /v1/{table}/{id} → bare JSON (updated)\n- PUT /v1/_meta/tables/{name} → bare JSON\n\n**Retry logic:** Exponential backoff (base 1s, max 30s, 3 attempts). Retryable: timeout, connect error, 5xx. Non-retryable: 400, 401, 404.\n\n---\n\n## 11. Configuration\n\n**File:** `.epic-runner/config.toml`\n\n```toml\n[api]\nbase_url = \"https://api.kapable.dev\"\n\n[project]\nproject_id = \"uuid\"\ndata_key = \"sk_live_...\"\n```\n\n**Optional:**\n```toml\n[api]\nadmin_key = \"sk_admin_...\"\n\n[deploy]\napp_id = \"uuid\"\napi_key = \"sk_admin_...\"\ntimeout_secs = 300\n```\n\n**Cascade:**\n- API URL: --url flag → KAPABLE_API_URL → config → https://api.kapable.dev\n- Data key: --key flag → KAPABLE_DATA_KEY → config → KAPABLE_ADMIN_API_KEY → config → error\n\n**Project walk-up:** `find_project_config()` walks up from CWD looking for `.epic-runner/config.toml`, stops at `.git`. Falls back to `~/.epic-runner/config.toml`.\n\n---\n\n## 12. Gotchas\n\n1. **Admin key required for `/v1/pipelines/run`** — Set KAPABLE_ADMIN_API_KEY or [api] admin_key in config.\n\n2. **Stories must have codes** — Pipeline filters by code field; stories without codes silently excluded.\n\n3. **ceremony_events table missing** — Non-fatal; real-time streaming won't work, but sprint completes.\n\n4. **Git push URL resolved at runtime** — Agent daemon sets GIT_PUSH_URL; falls back to origin (may fail if unauthenticated).\n\n5. **Ephemeral workspaces lack .epic-runner/config.toml** — Source stage generates minimal config; builders also get KAPABLE_DATA_KEY env var.\n\n6. **Merge conflicts graceful** — merge-main uses `set +e`; conflicts don't fail pipeline, but manual resolution needed.\n\n7. **Claude Code hooks disabled in build** — CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1 prevents builder commits outside controlled flow.\n\n8. **Max stop iterations = 3** — Safety valve prevents infinite loops; builder forced exit after 3 stop attempts.\n\n9. **Judge verdict requires JSON** — Plain text output = no verdict = next sprint. Ensure structured output.\n\n10. **Write-back reads pipeline logs, not ceremony_events** — Logs are authoritative; real-time table is streaming-only.\n\n11. **Story code required for pipeline stages** — Stage IDs: `build-{code.to_lowercase()}`; missing code causes panic.\n\n12. **Credentials forwarded via env vars** — KAPABLE_DATA_KEY visible in process listings; use service tokens for CI.\n\n13. **Orchestrate requires lock** — Only one run per epic. Dead locks auto-recovered; manual cleanup: `rm .epic-runner/locks/{epic_code}.lock`.\n\n14. **Impediments block entire epic** — Any open impediment blocks orchestration; must manually resolve.\n\n15. **Config cascade prefers data keys over admin keys** — KAPABLE_DATA_KEY > KAPABLE_ADMIN_API_KEY (least privilege).\n\n16. **Serial vs. parallel execution** — Serial (default): deterministic; parallel: faster but increased contention.\n\n---\n\n## Summary Table\n\n| Component | File | Purpose |\n|-----------|------|---------|\n| Main CLI | src/main.rs | clap derive, command dispatch |\n| Commands | src/commands/ | init, product, backlog, epic, sprint, orchestrate, pipeline, research, impediment, status |\n| Types | src/types.rs | Story, Epic, Product, AcceptanceCriterion, StoryTask, JudgeVerdict |\n| API Client | src/api_client.rs | HTTP wrapper, retry logic, auth cascade |\n| Pipeline Gen | src/pipeline_generator.rs | YAML DAG generation |\n| Pipeline Submit | src/pipeline_submitter.rs | API submission, polling, log fetching |\n| Builder | src/builder.rs | Output parsing, write-back to stories |\n| Judge | src/judge.rs | Verdict parsing, evaluation (Satisfied/Provisional/NotSatisfied) |\n| Agents | src/agents.rs | Embedded agent resolution, temp file writing |\n| Hooks | src/hooks.rs | Embedded stop-gate + track-files hooks |\n| Config | src/config.rs | TOML parsing, file walk-up, cascade |\n| Tests | tests/ | 131 integration tests |\n| Agents | agents/ | builder.md, code-judge.md, scrum-master.md, researcher.md, groomer.md, ab-judge.md, rubber-duck.md |\n| Hooks | hooks/ | stop-gate.sh, track-files.sh |\n\n---\n\nYou can now save this comprehensive document to `/Users/hgeldenhuys/WebstormProjects/kapable/dev.kapable.koncierge/knowledge/subsystems/04-epic-runner.md`. The document covers all requested topics at the ~20K token scale you specified."}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":5,"cache_creation_input_tokens":12074,"cache_read_input_tokens":88596,"output_tokens":5285,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":12074},"inference_geo":"","iterations":[],"speed":"standard"}},"requestId":"req_011CZ68dfkHTy2sumeJMne5c","type":"assistant","uuid":"18ab89eb-ba2b-4206-8ff1-ed78df4ad03e","timestamp":"2026-03-16T04:32:42.049Z","userType":"external","cwd":"/Users/hgeldenhuys/WebstormProjects/kapable/dev.kapable.koncierge","sessionId":"ec7b47a1-b6c0-49e6-8669-8ddbac3d6856","version":"2.1.76","gitBranch":"main","slug":"ethereal-marinating-yeti"}
{"parentUuid":"18ab89eb-ba2b-4206-8ff1-ed78df4ad03e","isSidechain":true,"agentId":"a9bc829ffed874124","type":"progress","data":{"type":"hook_progress","hookEvent":"SubagentStop","hookName":"SubagentStop","command":"bun $CLAUDE_PROJECT_DIR/.claude/claude-code-sdk/bin/hooks.ts --config $CLAUDE_PROJECT_DIR/hooks.yaml"},"parentToolUseID":"848e754f-a472-453c-b223-dfd2e0608726","toolUseID":"848e754f-a472-453c-b223-dfd2e0608726","timestamp":"2026-03-16T04:32:42.074Z","uuid":"eceb0f64-b36a-494f-86b3-d3d8f095e3d8","userType":"external","cwd":"/Users/hgeldenhuys/WebstormProjects/kapable/dev.kapable.koncierge","sessionId":"ec7b47a1-b6c0-49e6-8669-8ddbac3d6856","version":"2.1.76","gitBranch":"main","slug":"ethereal-marinating-yeti"}
---

# AI Flows, KAIT, and k8way — Knowledge Document

## 1. AI Flows Overview

Visual DAG editor with 33 node types for orchestrating AI workflows. Phase-based rollout (Phase 1: 8 core nodes, Phase 2: 8 integration nodes, Phase 3+: advanced).

**Node Types**: Source, LLM, Judge, Committee, Gate, Output, Transform, Code, HTTP, Data, Function, Human, Loop, Decision, Harness, Subflow, Batch, Voice, Image, Video, Embedding, Merge, Ranker, Artifact, Debate, Schema, Guardrail, Assert, Collection, Vault, Agent, Log, Documentation.

**Key Features**: Real-time execution with event streaming via pg_notify, budget tracking (cost_usd per run), variables, snapshots, human-in-the-loop approval gates, cycle detection (client-side DAG validation).

## 2. Flow Execution Pipeline

```
User creates flow → POST /v1/flows/{id}/run
  → Run inserted with status='queued'
  → pg_notify fires on 'flow_run_queued' channel
  → kapable-worker flow_executor subprocess picks up
  → FlowEngine (kapable-core/src/flows/engine.rs) executes DAG
  → Node results stored in ai_flow_node_results table
  → SSE events streamed in real-time
```

**Execution runs in kapable-worker, NOT kapable-api.** Changes to flow engine require worker deploy.

## 3. Forge Daemon (kapable-forge)

NOT just flows — it's the unified pipeline engine for both AI Flows AND Bootstrap Pipeline (Rust deploy).

**Architecture**:
- Binary has two HTTP modes: `/serve` (flow API) and `/deploy-serve` (deploy daemon)
- Uses `kapable-pipeline` library for ALL execution logic (1280+ tests, 14K+ lines)
- Supports 8 step types: bash, http, health, artifact, gate, approval, container, deploy
- Real-time event streaming via broadcast channels
- PostgreSQL persistence for run history and artifact dedup

**Deploy Features**: Artifact storage, service locks, zero-downtime blue-green, rollback.

## 4. KAIT (AI IDE Sessions)

Headless Claude CLI processes spawned per message for AI-assisted development.

**Architecture**:
- Per-message spawns: `claude -p <text> --output-format stream-json`
- Session continuity via `--resume <claude_session_id>` on subsequent messages
- Optional Incus containers for project isolation
- System prompt append for platform awareness
- Broadcast event sink for streaming messages/tokens/cost

**Session Pool**: Semaphore-gated (max_concurrent_sessions), idle timeout reaper.
**Monitoring**: Prometheus metrics (active sessions, queue depth, cost tracking).
**WebSocket**: Real-time session interaction.

## 5. k8way (AI API Proxy Gateway)

AI API proxy with consumer billing and token management.

- Translates OpenAI/Anthropic protocols to upstream providers
- Consumer store (in-memory + PostgreSQL) with usage tracking
- Credential pool (accounts from TOML + DB)
- Periodic jobs: harvest (5m), token refresh (4h), consumer reload (5m), usage flush (30s)
- BYOLLM support (org-provided provider keys)
- Weekly token limits per consumer, enforce_limits flag

**Provider Registry**: Routes by model (e.g., `gpt-4` → OpenAI, `claude-*` → Anthropic).

## 6. API Endpoints

### Flows
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/flows` | Create flow |
| GET | `/v1/flows` | List flows (pagination, filter) |
| GET | `/v1/flows/{id}` | Get flow with nodes + edges |
| PUT | `/v1/flows/{id}` | Update metadata |
| DELETE | `/v1/flows/{id}` | Delete (cascades nodes, edges, runs) |
| PUT | `/v1/flows/{id}/canvas` | Batch update nodes + edges (cycle detection) |
| POST | `/v1/flows/{id}/run` | Queue execution (202 Accepted) |
| GET | `/v1/flows/{id}/runs` | List runs |
| GET | `/v1/flows/{id}/runs/{run_id}` | Get run with node results |
| POST | `/v1/flows/{id}/runs/{run_id}/cancel` | Cancel run |
| GET | `/v1/flows/{id}/runs/{run_id}/stream` | SSE event stream |
| POST | `/v1/flows/{id}/runs/{run_id}/human-input/{node_id}` | Submit approval |

### KAIT Sessions
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/sessions` | Create (spawns Incus container) |
| GET | `/sessions` | List active |
| GET | `/sessions/{id}` | Get info |
| DELETE | `/sessions/{id}` | Kill + cleanup |
| POST | `/sessions/{id}/pause` | Dormant (no process, keeps state) |
| POST | `/sessions/{id}/wake` | Resume from dormant |
| POST | `/sessions/{id}/message` | Send text (spawns claude) |
| GET | `/ws` | WebSocket real-time |

## 7. Gotchas

- **Flow execution runs in worker, not API** — deploy worker for flow engine changes
- **Node types need migration** — `trigger_type` CHECK constraint must include new types
- **LLM nodes strip markdown** — `strip_markdown_code_block()` before parsing JSON
- **KAIT per-message model** — each message spawns NEW process; `--resume` persists session
- **Cycle detection** — client-side DAG validation before persistence; cycles = 400 error
- **Budget tracking** — per-run cap_usd, per-node cost_usd in results table
- **Human gates** — Gate nodes pause execution, wait for POST human-input with approval

---

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


---

