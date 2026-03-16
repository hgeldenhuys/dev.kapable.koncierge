# Koncierge — Kapable Onboarding Assistant

## Vision

An AI-powered onboarding concierge embedded in the Kapable console that guides new team members through the platform using conversational interaction, contextual navigation, and eventually voice.

## Architecture

```
Browser (Console)                    Mac Studio
┌────────────────────┐              ┌──────────────────────────┐
│ Chat panel (inline) │──SSE/WS───▶│ Koncierge Agent          │
│ Route context       │             │ (dedicated Claude session)│
│ Navigation tools    │             │                           │
│ Onboarding widgets  │◀──actions──│ Pre-loaded with:          │
│ Voice I/O (phase 3) │             │ KAPABLE_KNOWLEDGE_BASE.md │
└────────────────────┘              └──────────────────────────┘
```

## Phases

### Phase 0: Knowledge Distillation (prerequisite)

Spawn explorer agents (one per subsystem) that produce structured documentation. Merge into a single `KAPABLE_KNOWLEDGE_BASE.md` (~150K tokens). This is the Koncierge's brain — pre-computed once, refreshed periodically.

Subsystem agents:
1. **rust-api** — Crates, routes, auth tiers, data API, migrations, key patterns
2. **frontends** — Console, admin, developer portal — routes, BFF, SDK, components
3. **pipeline-engine** — Pipeline crate, agent daemon, stages, events, execution flow
4. **epic-runner** — Orchestrate, pipeline generator, stories, write-back, autonomous loop
5. **ai-flows-kait** — DAG editor, node types, KAIT sessions, k8way proxy
6. **infrastructure** — Hetzner, Caddy, containers, deploy pipelines, monitoring

Output per agent: structured markdown with concepts, workflows, common tasks, gotchas.

### Phase 1: Pre-Onboarding (email + invite)

- Check `org_members` for invitation acceptance
- Send follow-up email via Resend if no response
- Greet by name on first console login
- Personalized onboarding flow based on role

### Phase 2: In-Console Chat (MVP)

**Frontend (in dev.kapable.console):**
- Chat panel component (sidebar or overlay, accessible from every route)
- Route context injection — tell the agent what page the user is on
- Action rendering — navigate user, highlight elements, show tooltips
- SSE streaming for real-time responses
- Reference: GrowthFin onboarding widgets pattern (../realtime-db/)

**Backend (dedicated agent on Mac Studio):**
- Long-lived Claude session with KAPABLE_KNOWLEDGE_BASE.md as system prompt
- Message API: POST message → SSE response stream
- Tools: navigate, highlight, tooltip, showSection
- No cold start — session stays warm between messages

**API integration:**
- `POST /v1/koncierge/message` — send message with route context
- `GET /v1/koncierge/stream` — SSE response stream
- Or: integrate via console BFF with direct WebSocket to agent

### Phase 3: Voice Mode (enhancement)

- **TTS output**: ElevenLabs streaming (eleven_v3) — speak as response tokens arrive
- **STT input**: Whisper.cpp (local, free) or browser Web Speech API
- Mic button in chat panel, toggle voice mode
- Fallback: always show text alongside audio

## Key Design Decisions

1. **Single knowledge document, not runtime sub-agents** — pre-compute exploration, serve from context. Simpler, faster, cheaper per-query.

2. **Inline in console, not separate app** — leverages existing auth, gives route context, no new deployment surface.

3. **Dedicated agent, not shared with pipelines** — Koncierge is always-on, pipeline agent processes batch jobs. No contention.

4. **GrowthFin widget pattern** — proven UX for guided onboarding. Reuse the highlight/tooltip/navigate pattern from `../realtime-db/`.

5. **Staged voice** — text chat first (validate routing + quality), then TTS, then STT. Don't build the hard part before the easy part works.

## File Structure

```
dev.kapable.koncierge/
  PLAN.md                          ← this file
  CLAUDE.md                        ← agent instructions
  knowledge/
    KAPABLE_KNOWLEDGE_BASE.md      ← merged knowledge (the brain)
    subsystems/
      01-rust-api.md               ← per-subsystem exploration output
      02-frontends.md
      03-pipeline-engine.md
      04-epic-runner.md
      05-ai-flows-kait.md
      06-infrastructure.md
  agents/
    koncierge.md                   ← Koncierge agent system prompt
    explorer.md                    ← Explorer agent prompt (for distillation)
  src/                             ← future: agent server code
  package.json                     ← project config
```

## Running the Koncierge Server

### Prerequisites

```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY and KONCIERGE_SECRET
```

### Development (auto-restart on crash)

```bash
# Standalone — starts with --watch and auto-restart
bun run dev:managed

# Or the simpler watch-only mode (no crash recovery)
bun run dev
```

**From the console project**, add to `dev.kapable.console/package.json`:

```json
{
  "scripts": {
    "dev:koncierge": "bun run ../dev.kapable.koncierge/scripts/dev-with-koncierge.ts",
    "dev:all": "bun run dev & bun run dev:koncierge"
  }
}
```

Then `bun run dev:all` starts both the console and Koncierge concurrently. The managed runner:
- Loads `.env` from the Koncierge project root
- Auto-restarts on crash (up to 5 times per 60s window)
- Waits for `/health` to respond before printing "ready"
- Forwards SIGINT/SIGTERM for clean shutdown

### Always-On Service (Mac Studio via launchd)

For production/always-on availability on the Mac Studio, install as a launchd user agent:

```bash
# Install and start (reads .env for ANTHROPIC_API_KEY and KONCIERGE_SECRET)
bun run service:install

# Check status + health
bun run service:status

# View logs
bun run service:logs

# Stop and remove
bun run service:uninstall
```

The installer creates `~/Library/LaunchAgents/dev.kapable.koncierge.plist` with:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.kapable.koncierge</string>

  <key>ProgramArguments</key>
  <array>
    <string>/path/to/bun</string>
    <string>run</string>
    <string>src/server.ts</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/path/to/dev.kapable.koncierge</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>ANTHROPIC_API_KEY</key>
    <string>sk-ant-...</string>
    <key>KONCIERGE_SECRET</key>
    <string>your-shared-secret</string>
    <key>PORT</key>
    <string>3101</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>StandardOutPath</key>
  <string>/path/to/dev.kapable.koncierge/logs/koncierge.stdout.log</string>

  <key>StandardErrorPath</key>
  <string>/path/to/dev.kapable.koncierge/logs/koncierge.stderr.log</string>

  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
```

Key launchd behaviours:
- **RunAtLoad** — starts automatically on login
- **KeepAlive.SuccessfulExit=false** — restarts if the process exits with a non-zero code
- **ThrottleInterval=10** — waits 10s between restart attempts to avoid tight loops
- Logs go to `logs/koncierge.{stdout,stderr}.log`

## Open Questions

- [ ] WebSocket vs SSE for chat streaming?
- [ ] Should Koncierge have write access (create stories, deploy) or read-only?
- [ ] How to refresh knowledge base automatically when platform evolves?
- [ ] Multi-language support (colleague may prefer Afrikaans)?
