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
