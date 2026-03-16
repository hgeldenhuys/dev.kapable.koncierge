# Theme Runner Session: THM-001 — Koncierge Onboarding Assistant

## Instructions

You are executing the theme runner loop for THM-001. This is a strategic blind loop:
observe → find gap → create epic → execute → extract skills → repeat.

## Theme

**Code:** THM-001
**Product:** Koncierge (slug: koncierge, prefix: KN)
**Objective:** A new Kapable team member can open console.kapable.dev, see a chat panel,
ask any question about the platform in natural language, receive accurate answers with
contextual awareness of their current page, follow agent-suggested navigation links to
relevant sections, and optionally use voice input/output — all without any human needing
to be online to assist them.

**Max Iterations:** 15
**Budget per Iteration:** $10
**Status:** active

## Execution Loop

For each iteration:

### 1. Observe Reality
Run the adversary agent against the Koncierge and Console codebases:
```bash
cd /Users/hgeldenhuys/WebstormProjects/kapable/dev.kapable.koncierge
```

Check:
- Does the console have a chat panel? (`dev.kapable.console/app/routes.ts`, layout)
- Is there an agent backend? (API endpoint, warm session)
- Does the knowledge base load? (`knowledge/KAPABLE_KNOWLEDGE_BASE.md`)
- Is route context injected? (per-message context)
- Do navigation tools work? (highlight, navigate)
- Does voice work? (STT input, TTS output)

### 2. Find Gap
The adversary produces a verdict:
- `"gap"` → create an epic with suggested stories
- `"satisfied"` → theme complete, exit loop

### 3. Create Epic
```bash
epic-runner epic create --product koncierge --domain ONBOARD --title "..." --intent "..."
```
Then create stories from the adversary's suggestions:
```bash
epic-runner backlog add --product koncierge --epic ONBOARD-NNN --title "..."
```
Groom each story with ACs and tasks.

### 4. Execute Epic
```bash
KAPABLE_ADMIN_API_KEY=$KAPABLE_ADMIN_API_KEY \
KAPABLE_ORG_ID=$KAPABLE_ORG_ID \
epic-runner orchestrate ONBOARD-NNN --max-sprints 3
```

### 5. Record Observation
Update the theme record with the iteration result:
```bash
# PATCH /v1/themes/{id} with new observation in observations array
```

### 6. Extract Skills (if applicable)
If the epic produced reusable patterns, save as skills:
```bash
# Write to .claude/skills/ in the koncierge or console repo
```

### 7. Repeat
Go back to step 1 with fresh eyes. You have NO memory of previous iterations
(except what's committed to git and the observations log).

## Prerequisites

Before first iteration:
- [x] Product created (koncierge, KN prefix)
- [x] Knowledge base distilled (133K chars, 6 subsystems)
- [x] Adversary agent defined (agents/adversary.md)
- [x] Koncierge agent defined (agents/koncierge.md)
- [x] Theme record created (THM-001, active)
- [ ] ER-078 merged (merge-to-main step) — needed so builder code lands on main
- [ ] Console changes possible (dev.kapable.console/ is a separate repo)

## Repos Involved

| Repo | What Changes | Purpose |
|------|-------------|---------|
| dev.kapable.koncierge/ | Knowledge base, agent defs, server code | Koncierge-specific |
| dev.kapable.console/ | Chat panel, BFF routes, layout | Where the UI lives |
| dev.kapable/ | API endpoints (if needed) | Agent message API |

## Auth & Credentials

Credentials are resolved from environment variables or `.epic-runner/config.toml`:
- `KAPABLE_DATA_KEY` — project-scoped data key (from config)
- `KAPABLE_ADMIN_API_KEY` — admin key for pipeline submission (from env)
- `KAPABLE_ORG_ID` — organization ID (from env)
- Console App ID — see parent CLAUDE.md for Connect App Pipeline IDs
