# Voice Agent Design: ElevenLabs Conversational AI Integration

**Date:** 2026-03-16
**Status:** Research Complete / Ready for Implementation
**Size:** L (estimated 3-4 sessions)

---

## 1. Executive Summary

Add a voice mode to the Koncierge onboarding assistant so new team members can be onboarded verbally. The design uses ElevenLabs Conversational AI with a **hybrid architecture**: ElevenLabs handles speech-to-text (STT), text-to-speech (TTS), and audio transport via WebRTC, while our existing Koncierge backend remains the LLM brain via ElevenLabs' Custom LLM feature. This preserves the 131K-char knowledge base, conversation history, and tool capabilities without duplication.

Key insight: ElevenLabs' Custom LLM mode lets us keep our Anthropic/Gemini LLM and full system prompt. ElevenLabs becomes a "voice transport layer" — it handles audio I/O and routes the text through our backend. We do NOT need to recreate the agent inside ElevenLabs.

---

## 2. Architecture

### 2.1 High-Level Architecture

```
                        ┌─────────────────────────────────────────────┐
                        │              Browser (Console)               │
                        │                                              │
                        │  ┌──────────────────────────────────────┐   │
                        │  │         KonciergePanel                │   │
                        │  │  ┌──────────┐    ┌────────────────┐  │   │
                        │  │  │ Chat Mode │    │  Voice Mode    │  │   │
                        │  │  │ (text)    │    │  (WebRTC)      │  │   │
                        │  │  │           │    │                │  │   │
                        │  │  │ SSE ──────┼────┼─► Shared       │  │   │
                        │  │  │ stream    │    │   History      │  │   │
                        │  │  └─────┬─────┘    └───────┬────────┘  │   │
                        │  └────────┼──────────────────┼───────────┘   │
                        │           │                  │                │
                        └───────────┼──────────────────┼────────────────┘
                                    │                  │
                     ┌──────────────┘                  └──────────────┐
                     │ POST /api/koncierge/message        WebRTC      │
                     │ (existing SSE flow)                audio       │
                     ▼                                    ▼           │
          ┌──────────────────┐              ┌─────────────────────┐   │
          │  Console BFF     │              │  ElevenLabs Cloud   │   │
          │  (proxy layer)   │              │                     │   │
          │                  │              │  STT ──► text ──►   │   │
          └────────┬─────────┘              │  ┌─────────────┐    │   │
                   │                        │  │ Custom LLM   │    │   │
                   │ X-Koncierge-Key        │  │ Proxy        │────┼───┘
                   │ X-Session-Token        │  └──────┬──────┘    │
                   ▼                        │         │           │
          ┌──────────────────┐              │         │ POST      │
          │  Koncierge       │◄─────────────┼─────────┘           │
          │  Server (:3101)  │              │  /v1/chat/          │
          │                  │──response──►│  completions        │
          │  Claude/Gemini   │              │         │           │
          │  + Knowledge Base│              │         ▼           │
          │  + Tools         │              │  text ──► TTS ──►   │
          │  + History       │              │  audio back to      │
          └──────────────────┘              │  browser via WebRTC │
                                            └─────────────────────┘
```

### 2.2 Data Flow: Voice Mode

```
1. User speaks into microphone
   │
2. Browser captures audio via WebRTC (echo-cancelled, noise-reduced)
   │
3. Audio streams to ElevenLabs cloud via WebRTC
   │
4. ElevenLabs STT converts speech to text
   │
5. ElevenLabs sends text to our Custom LLM endpoint
   │  POST /v1/koncierge/voice-completions
   │  Body: OpenAI-compatible chat/completions format
   │  Includes: conversation history, system prompt reference, tools
   │
6. Koncierge server processes with Claude/Gemini (same as chat mode)
   │  - Appends to shared conversation history
   │  - May invoke tools (navigate, highlight, etc.)
   │  - Returns SSE stream in OpenAI format
   │
7. ElevenLabs receives text stream, converts to speech via TTS
   │
8. Audio streams back to browser via WebRTC
   │
9. Client tools executed locally (navigate, highlight, tooltip)
```

### 2.3 Data Flow: Chat Mode (existing, unchanged)

```
1. User types message in chat input
   │
2. POST /api/koncierge/message (via BFF proxy)
   │
3. Koncierge server processes with Claude/Gemini
   │  - Same conversation history as voice mode
   │  - Same tools
   │
4. SSE stream back to browser
   │
5. Text rendered in chat bubble + tools executed
```

### 2.4 Conversation History Sharing

The critical design decision: **one conversation history, two input modes**.

```
ConversationSession {
  history: MessageParam[]      // Shared between chat and voice
  createdAt: number
  lastMode: "chat" | "voice"   // Track which mode was last used
  voiceConversationId?: string // ElevenLabs conversation ID (for transcript sync)
}
```

The Koncierge server already maintains per-session conversation history keyed by session token. Both chat mode (existing SSE endpoint) and voice mode (new OpenAI-compatible endpoint) write to the same history array. When the user switches modes:

- **Chat to Voice**: ElevenLabs session starts. The Custom LLM endpoint receives the call with the same session token. History is already populated from chat messages.
- **Voice to Chat**: ElevenLabs session ends. User types in chat. History includes all voice-mode exchanges (appended by the Custom LLM endpoint). Chat continues seamlessly.

---

## 3. ElevenLabs Integration Details

### 3.1 Custom LLM (The Core Strategy)

Instead of using ElevenLabs' built-in LLM, we use the **Custom LLM** feature to route all reasoning through our Koncierge server. This means:

- ElevenLabs handles ONLY: STT (speech-to-text), TTS (text-to-speech), WebRTC audio transport
- Our server handles: LLM inference, knowledge base, conversation history, tool definitions
- The 131K-char knowledge base stays in our system prompt, NOT uploaded to ElevenLabs

**Configuration on ElevenLabs Dashboard:**
1. Create agent with "Custom LLM" selected
2. Set URL to our endpoint: `https://api.kapable.dev/v1/koncierge/voice-completions` (or via Caddy proxy)
3. Set model name to any string (our server ignores it, uses its own model selection)
4. Enable "Custom LLM extra body" to receive session tokens
5. Enable overrides for: system prompt, first message, voice

**Our endpoint must implement OpenAI Chat Completions format:**

```typescript
// Request from ElevenLabs:
POST /v1/koncierge/voice-completions
Content-Type: application/json

{
  "model": "koncierge-voice",
  "messages": [
    { "role": "system", "content": "..." },   // ElevenLabs may send a minimal system prompt
    { "role": "user", "content": "Show me where the AI flows are" }
  ],
  "tools": [...],                              // System tools from ElevenLabs
  "stream": true,
  "elevenlabs_extra_body": {
    "session_token": "kses_...",               // Our session token for history lookup
    "conversation_id": "el_conv_..."           // ElevenLabs conversation ID
  }
}

// Response (SSE stream):
data: {"choices":[{"delta":{"content":"Let me take you to the "}}]}
data: {"choices":[{"delta":{"content":"AI Flows editor..."}}]}
data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"navigate","arguments":"{\"route\":\"/flows\"}"}}]}}]}
data: [DONE]
```

### 3.2 Client Tools via ElevenLabs

ElevenLabs supports three tool types. For Koncierge, we need **client tools**:

| Koncierge Tool | ElevenLabs Tool Type | Execution |
|---------------|---------------------|-----------|
| `navigate` | Client tool | Browser-side via `useConversation` clientTools |
| `highlight` | Client tool | Browser-side DOM manipulation |
| `tooltip` | Client tool | Browser-side DOM manipulation |
| `showSection` | Client tool | Browser-side DOM manipulation |

**Client tools are registered in the React SDK:**

```typescript
const conversation = useConversation();

await conversation.startSession({
  agentId: ELEVENLABS_AGENT_ID,
  clientTools: {
    navigate: async ({ route }: { route: string }) => {
      reactRouterNavigate(route);
      return `Navigated to ${route}`;
    },
    highlight: async ({ selector, durationMs }: { selector: string; durationMs?: number }) => {
      highlightElement(selector, durationMs ?? 3000);
      return `Highlighted ${selector}`;
    },
    tooltip: async ({ selector, text, durationMs }: { selector: string; text: string; durationMs?: number }) => {
      showTooltip(selector, text, durationMs ?? 3000);
      return `Showed tooltip on ${selector}`;
    },
    showSection: async ({ selector }: { selector: string }) => {
      highlightElement(selector, 3000);
      return `Showing section ${selector}`;
    },
  },
  overrides: {
    agent: {
      prompt: { prompt: "" },  // We handle system prompt on our server
    },
    conversation: {
      textOnly: false,
    },
  },
});
```

When ElevenLabs' LLM proxy calls a tool, the agent pauses speech, the client tool executes, returns a result string, and ElevenLabs appends the result to the conversation context. The agent then continues.

**Important:** Tool definitions must be configured BOTH in the ElevenLabs dashboard (so the agent knows about them) AND in the `clientTools` object (so the browser can execute them). The names must match exactly.

### 3.3 React SDK Integration

**Package:** `@elevenlabs/react` (provides `useConversation` hook)

```typescript
import { useConversation } from "@elevenlabs/react";

// In component:
const conversation = useConversation({
  onConnect: () => setVoiceStatus("connected"),
  onDisconnect: () => setVoiceStatus("disconnected"),
  onMessage: ({ message, source }) => {
    // Append to shared chat history display
    appendMessage(source === "user" ? "user" : "assistant", message);
  },
  onError: (error) => {
    toast.error(`Voice error: ${error.message}`);
    // Auto-fallback to chat mode
    setMode("chat");
  },
  onStatusChange: ({ status }) => setVoiceStatus(status),
  onModeChange: ({ mode }) => {
    // mode: "speaking" | "listening"
    setAgentMode(mode);
  },
});

// Start voice session:
await conversation.startSession({
  agentId: process.env.ELEVENLABS_AGENT_ID,
  connectionType: "webrtc",  // Better echo cancellation than websocket
  clientTools: { ... },
});

// Send text message while in voice session (hybrid mode):
conversation.sendMessage("Navigate to flows");

// End voice session:
await conversation.endSession();
```

### 3.4 WebRTC vs WebSocket

**Use WebRTC.** Reasons:
- Native browser echo cancellation and noise removal (critical for hands-free use)
- Lower audio latency (peer-to-peer-like, vs server-round-trip for WebSocket)
- Works in all modern browsers natively
- No microphone permission issues beyond initial grant

WebSocket mode is only needed for server-side integrations (phone calls, etc.).

### 3.5 Signed URLs (Security)

For private agents, the browser must NOT expose the ElevenLabs API key. The flow:

```
1. Browser: POST /api/koncierge/voice-session (to console BFF)
2. BFF: Validates user session, calls ElevenLabs API to get signed URL
3. BFF: Returns signed URL to browser
4. Browser: Uses signed URL in conversation.startSession({ signedUrl: "..." })
```

This requires a new BFF endpoint and a server-side ElevenLabs API call.

---

## 4. Chat <-> Voice Continuity Design

### 4.1 Shared Conversation State

The key to seamless mode switching is that both modes write to the same `ConversationSession.history` array on the Koncierge server.

```
┌─────────────────────────────────────────────────────────┐
│                  ConversationSession                      │
│                                                           │
│  history: [                                               │
│    { role: "user",      content: "What is Kapable?" }    │  ← Chat msg
│    { role: "assistant", content: "Kapable is an AI..." } │  ← Chat response
│    { role: "user",      content: "Show me the flows" }   │  ← Voice msg (via Custom LLM)
│    { role: "assistant", content: "Here are the..." }     │  ← Voice response
│    { role: "user",      content: "How do I deploy?" }    │  ← Chat msg (switched back)
│    { role: "assistant", content: "To deploy, go to..." } │  ← Chat response
│  ]                                                        │
│                                                           │
│  sessionToken: "kses_abc123..."                           │
│  lastMode: "chat"                                         │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Mode Switching Protocol

```
State Machine:
                              ┌──────────┐
          ┌──────────────────►│  CHAT    │◄──────────────────┐
          │  endSession()     │  MODE    │  (default)        │
          │                   └────┬─────┘                   │
          │                        │                         │
          │                        │ toggleVoice()           │
          │                        ▼                         │
          │                   ┌──────────┐                   │
          │                   │CONNECTING│                   │
          │                   │ (WebRTC) │                   │
          │                   └────┬─────┘                   │
          │                        │                         │
          │              onConnect │        onError          │
          │                        ▼           │             │
          │                   ┌──────────┐     │             │
          └───────────────────│  VOICE   │─────┘             │
             toggleChat()     │  MODE    │───────────────────┘
                              └──────────┘   timeout/error
                                                (auto-fallback)
```

**Switching from Chat to Voice:**
1. User clicks mic button
2. Request microphone permission (if not granted)
3. Call BFF to get signed URL (if using private agent)
4. `conversation.startSession()` with WebRTC
5. Hide chat input, show voice waveform/indicator
6. ElevenLabs agent speaks a transition message: "I'm listening. Go ahead."
7. All further exchanges go through voice until user switches back

**Switching from Voice to Chat:**
1. User clicks chat button (or types in the input, which auto-switches)
2. `conversation.endSession()`
3. Show chat input, hide voice indicator
4. Chat mode resumes with full history visible

**Error Fallback:**
If WebRTC connection fails or ElevenLabs returns an error, automatically fall back to chat mode with a toast: "Voice unavailable, switching to text chat."

### 4.3 Transcript Synchronization

When in voice mode, ElevenLabs transcribes both user speech and agent responses. We need to display these in the chat panel for continuity:

```typescript
// In useConversation callbacks:
onMessage: ({ message, source }) => {
  // source: "user" (transcribed speech) or "ai" (agent response)
  // Append to the visible chat thread so user can see what was said
  appendTranscriptMessage({
    role: source === "user" ? "user" : "assistant",
    content: message,
    mode: "voice",  // Visual indicator: spoken not typed
  });
}
```

This means the chat panel shows ALL messages regardless of mode, with a small icon indicating whether it was typed or spoken.

---

## 5. Tool Calling Bridge

### 5.1 Current Tool Flow (Chat Mode)

```
Claude response ──► SSE stream ──► Browser parses tool_use events ──► useKonciergeTools executes
```

### 5.2 Voice Mode Tool Flow

```
Koncierge server response ──► ElevenLabs receives ──► Detects tool call ──►
  Sends to browser via WebRTC ──► clientTools callback executes ──►
  Returns result to ElevenLabs ──► ElevenLabs sends result to Custom LLM ──►
  Koncierge server sees tool result ──► Continues response
```

### 5.3 Unified Tool Executor

Both modes use the same DOM manipulation functions. Create a shared tool executor:

```typescript
// src/ui/tool-executor.ts — shared between chat and voice modes
export interface ToolExecutorConfig {
  navigate: (to: string) => void;
  onNotify?: (message: string) => void;
}

export function createToolExecutor(config: ToolExecutorConfig) {
  return {
    navigate: async ({ route }: { route: string }) => {
      config.navigate(route);
      config.onNotify?.(`Navigating to ${route}`);
      return `Navigated to ${route}`;
    },
    highlight: async ({ selector, durationMs }: { selector: string; durationMs?: number }) => {
      highlightElement(selector, durationMs ?? 3000);
      return `Highlighted ${selector}`;
    },
    tooltip: async ({ selector, text, durationMs }: { selector: string; text: string; durationMs?: number }) => {
      showTooltip(selector, text, durationMs ?? 3000);
      return `Showed tooltip near ${selector}`;
    },
    showSection: async ({ selector }: { selector: string }) => {
      highlightElement(selector, 3000);
      return `Scrolled to and highlighted ${selector}`;
    },
  };
}
```

This same object is passed to both:
- `useKonciergeTools` (chat mode, existing)
- `conversation.startSession({ clientTools: ... })` (voice mode, new)

### 5.4 OpenAI-Compatible Tool Definitions

The Custom LLM endpoint must return tool calls in OpenAI format, not Anthropic format. Translation layer:

```typescript
// Anthropic tool_use block:
{ type: "tool_use", id: "toolu_01", name: "navigate", input: { route: "/flows" } }

// Must be translated to OpenAI delta format for ElevenLabs:
{ "choices": [{ "delta": { "tool_calls": [{ "id": "call_01", "type": "function", "function": { "name": "navigate", "arguments": "{\"route\":\"/flows\"}" } }] } }] }
```

---

## 6. UI Design

### 6.1 Mode Toggle

Add a mic button to the existing KonciergePanel composer area:

```
┌──────────────────────────────────────┐
│  Koncierge                      [x]  │
├──────────────────────────────────────┤
│                                      │
│  (chat messages / transcript)        │
│                                      │
│  [user] What is Kapable?            │
│  [bot]  Kapable is an AI-native...  │
│  [user] Show me the flows    [mic]  │  ← mic icon = spoken message
│  [bot]  Here are the AI Flows...    │
│                                      │
├──────────────────────────────────────┤
│  [Type a message...    ] [mic] [->] │  ← mic button toggles voice
│                                      │
│  OR (when in voice mode):            │
│                                      │
│  [ ~~~~~ Listening... ~~~~~ ] [kbd] │  ← waveform + keyboard toggle
└──────────────────────────────────────┘
```

### 6.2 Voice Mode States

| State | Visual | Audio |
|-------|--------|-------|
| Idle (chat mode) | Mic button in composer, grey | None |
| Connecting | Mic button pulsing blue | None |
| Listening | Waveform animation, "Listening..." label | Mic active |
| Agent speaking | Waveform animation (different color), "Speaking..." | TTS audio playing |
| Error | Red mic button, toast notification | None, fallback to chat |

### 6.3 Push-to-Talk vs Always Listening

**Default: Always listening** (once voice mode is activated). Reasons:
- ElevenLabs WebRTC has built-in voice activity detection (VAD)
- Echo cancellation handles agent audio bleeding into mic
- More natural for onboarding conversation ("just talk")
- Push-to-talk can be added later as an option for noisy environments

**Microphone Permission:**
- Request on first mic button click
- Show explanatory text: "Koncierge needs microphone access for voice mode"
- Remember permission state in localStorage
- If denied, disable mic button with tooltip: "Microphone access required for voice mode"

### 6.4 Visual Feedback During Speech

```typescript
// Voice mode indicator component
function VoiceIndicator({ status, agentMode }: {
  status: "connected" | "connecting" | "disconnected";
  agentMode: "listening" | "speaking";
}) {
  if (status === "connecting") return <PulsingDot color="blue" label="Connecting..." />;
  if (agentMode === "speaking") return <Waveform color="blue" label="Koncierge is speaking..." />;
  if (agentMode === "listening") return <Waveform color="green" label="Listening..." />;
  return null;
}
```

---

## 7. Knowledge Base Strategy

### 7.1 Do NOT Upload to ElevenLabs

The 131K-char knowledge base should NOT be uploaded to ElevenLabs' RAG system. Reasons:

1. **We already have it in context.** The Koncierge server loads `KAPABLE_KNOWLEDGE_BASE.md` as the system prompt with Anthropic prompt caching. Adding RAG would add 500ms latency for worse results.
2. **Size limit concern.** The free/starter ElevenLabs tiers limit RAG documents to 1-2MB. Our knowledge base is 131K chars, which fits, but leaves no room for growth.
3. **Custom LLM means we control the prompt.** ElevenLabs Custom LLM sends text to our server. Our server already has the full knowledge base loaded. No need to duplicate.
4. **Prior-art research confirms this.** From `research/prior-art.md`: "Don't Use RAG for a Known, Bounded Knowledge Base... Full-context with prompt caching is simpler, faster, and more accurate for this use case."

### 7.2 System Prompt Handling

When using Custom LLM, ElevenLabs may send a minimal system prompt in its requests. Our server should:
1. Ignore ElevenLabs' system prompt
2. Use our own cached system prompt (knowledge base + agent instructions)
3. Extract the user message from ElevenLabs' request and append to our conversation history

---

## 8. Server Changes Required

### 8.1 New Endpoint: OpenAI-Compatible Voice Completions

```
POST /v1/koncierge/voice-completions
```

This endpoint receives requests from ElevenLabs in OpenAI Chat Completions format and responds with SSE in OpenAI format.

**File:** `src/server.ts` (add new route)
**New file:** `src/voice-bridge.ts` (OpenAI <-> Anthropic format translation)

### 8.2 New Endpoint: Signed URL for Private Agent

```
POST /v1/koncierge/voice-session
```

Called by the console BFF to get a signed URL for the ElevenLabs WebRTC connection.

### 8.3 New BFF Endpoints

**File:** `src/bff/proxy.ts` (extend)
- `POST /api/koncierge/voice-session` — proxy to get signed URL

### 8.4 Environment Variables

```bash
# Add to .env:
ELEVENLABS_API_KEY=sk-...              # ElevenLabs API key (server-side only)
ELEVENLABS_AGENT_ID=agent_...          # ElevenLabs agent ID (can be public)
ELEVENLABS_VOICE_ID=iP95p4xoKVk53GoZ742B  # Chris voice (already configured)
```

Note: `ELEVENLABS_API_KEY` is already configured on production (per memory: "FAL_KEY, ELEVENLABS_API_KEY, DEPLOY_SECRET -- configured").

---

## 9. Implementation File Map

| File | Change | Description |
|------|--------|-------------|
| `src/server.ts` | Modify | Add `/v1/koncierge/voice-completions` and `/v1/koncierge/voice-session` routes |
| `src/session.ts` | Modify | Add `lastMode` and `voiceConversationId` to ConversationSession; add `chatStreamOpenAI()` method |
| `src/voice-bridge.ts` | **New** | OpenAI <-> Anthropic format translator for Custom LLM integration |
| `src/bff/proxy.ts` | Modify | Add `proxyVoiceSession()` for signed URL endpoint |
| `src/bff/index.ts` | Modify | Export new voice session proxy |
| `src/ui/KonciergePanel.tsx` | Modify | Add mic button, voice mode toggle, waveform indicator |
| `src/ui/VoiceIndicator.tsx` | **New** | Voice mode visual feedback component |
| `src/ui/useKonciergeVoice.ts` | **New** | Hook wrapping `useConversation` with Koncierge-specific config |
| `src/ui/tool-executor.ts` | **New** | Shared tool execution logic for both chat and voice |
| `src/ui/useKonciergeTools.ts` | Modify | Refactor to use shared tool-executor |
| `src/ui/KonciergeRuntimeProvider.tsx` | Modify | Add voice state context |
| `src/ui/index.ts` | Modify | Export new voice components/hooks |
| `package.json` | Modify | Add `@elevenlabs/react` dependency |
| `.env` | Modify | Add ElevenLabs env vars |
| `agents/koncierge.md` | Modify | Add voice-specific instructions (shorter responses, verbal cues) |

---

## 10. Cost Estimates

### 10.1 ElevenLabs Costs

| Item | Cost | Notes |
|------|------|-------|
| Voice mode per minute | $0.08-0.10/min | Business plan: $0.08/min; Pro: $0.10/min |
| Typical onboarding session | 5-10 minutes | ~$0.50-1.00 per new member |
| Monthly estimate (10 new members) | $5-10/month | Minimal for onboarding use case |
| RAG latency overhead | N/A | Not using ElevenLabs RAG |

**Note:** ElevenLabs currently absorbs LLM costs but will eventually pass them on. Since we use Custom LLM, there is no ElevenLabs LLM cost -- we pay Anthropic/OpenRouter directly.

### 10.2 Anthropic/OpenRouter Costs (unchanged)

| Item | Cost | Notes |
|------|------|-------|
| Prompt cache hit (knowledge base) | ~$0.0015/request | 131K chars cached, 90% discount |
| Response tokens | ~$0.001-0.003/response | 200-500 tokens typical |
| Per voice turn | ~$0.003 | Same as chat turn |

### 10.3 Total Per Onboarding Session

```
Voice mode (10 min):  $0.80-1.00  (ElevenLabs)
LLM turns (20 turns): $0.06       (Anthropic)
Total:                $0.86-1.06 per new team member
```

This is negligible. Even at 100 new members/month, it's under $110/month.

---

## 11. Risk Assessment

### 11.1 High Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Custom LLM latency** — ElevenLabs -> our server -> Claude -> back adds round trips | Voice feels slow (>2s response) | Use Gemini Flash for voice mode (350ms TTFB vs 700ms+ for Claude). ElevenLabs supports buffer words for natural pauses. |
| **Tool call reliability in voice** — Agent must generate valid tool calls via Custom LLM proxy | Navigation/highlight fails | Extensive testing of OpenAI format translation. Fallback: if tool call fails, agent verbally describes where to go instead. |
| **WebRTC browser compatibility** — Safari/Firefox edge cases | Voice mode unavailable for some users | Feature-detect WebRTC. Fall back to WebSocket mode, then to chat-only with clear messaging. |

### 11.2 Medium Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Conversation history divergence** — Voice and chat histories get out of sync | Confusing context switches | Single history array on server. Both modes write to same array. Verify with integration tests. |
| **ElevenLabs rate limits** — Concurrent voice sessions | Onboarding blocked | ElevenLabs scales well. Monitor usage. Add queue/waitlist if needed. |
| **Microphone permission UX** — Users deny permission, then confused | Voice mode appears broken | Clear permission request UI. Graceful fallback to chat with explanation. |
| **Echo/feedback in shared office** — Multiple people onboarding simultaneously | Audio quality issues | WebRTC echo cancellation handles this. Recommend headphones in noisy environments. |

### 11.3 Low Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **ElevenLabs API changes** — Breaking changes to Custom LLM format | Need to update bridge | Pin SDK version. OpenAI format is stable. |
| **Cost overrun** — Unexpected voice usage | Higher bill | Usage monitoring. Set ElevenLabs spending cap. |
| **Voice quality** — Accent/language issues for Afrikaans speakers | Poor STT accuracy | Claude handles multilingual. ElevenLabs STT supports 70+ languages. Test with Afrikaans. |

---

## 12. Latency Budget

```
Target: < 2 seconds from end-of-speech to start-of-speech

Budget breakdown:
  VAD detection (end of speech):   200ms
  STT (speech to text):            300ms
  Network (ElevenLabs -> us):       50ms
  LLM first token:                 350ms  (Gemini Flash)
  Network (us -> ElevenLabs):       50ms
  TTS first audio chunk:           200ms
  WebRTC audio delivery:            50ms
  ─────────────────────────────────────
  Total:                          1200ms  (well within budget)

With Claude Sonnet instead of Gemini Flash:
  LLM first token:                 700ms
  Total:                          1550ms  (still acceptable)
```

---

## 13. Phase Plan

### Phase 3a: Voice Output Only (TTS) — 1 session

- Add ElevenLabs TTS streaming to assistant responses
- "Read aloud" button on each assistant message
- No microphone needed, no Custom LLM needed
- Uses ElevenLabs Text-to-Speech API directly
- Validates voice quality and latency

### Phase 3b: Full Voice Mode — 2-3 sessions

- ElevenLabs agent with Custom LLM pointing to Koncierge server
- OpenAI-compatible voice-completions endpoint
- `@elevenlabs/react` integration with `useConversation`
- Client tools bridge
- Mode toggle UI
- Signed URL flow for security
- Chat <-> Voice continuity

### Phase 3c: Polish — 1 session

- Voice-optimized agent instructions (shorter responses)
- Waveform visualization
- Keyboard shortcut for mode toggle
- Error recovery and auto-fallback
- Usage analytics
- Afrikaans/multilingual testing

---

## 14. ElevenLabs Agent Configuration Checklist

1. [ ] Create agent in ElevenLabs dashboard
2. [ ] Select "Custom LLM" as the model
3. [ ] Set Custom LLM URL to Koncierge voice-completions endpoint
4. [ ] Configure voice: "Chris" (voice ID: `iP95p4xoKVk53GoZ742B`)
5. [ ] Add client tools: navigate, highlight, tooltip, showSection (with parameter schemas matching our definitions)
6. [ ] Enable overrides in Security tab: system prompt, first message, text-only mode
7. [ ] Set connection type preference: WebRTC
8. [ ] Configure VAD sensitivity
9. [ ] Set idle timeout (10 minutes for text, 5 minutes for voice)
10. [ ] Test with a simple "Hello" conversation
11. [ ] Generate signed URL endpoint for private access

---

## Appendix A: ElevenLabs API Reference Summary

| Feature | Endpoint/Method | Notes |
|---------|----------------|-------|
| React SDK | `@elevenlabs/react` | `useConversation` hook |
| WebSocket | `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=X` | Direct connection |
| WebRTC | Via SDK `connectionType: "webrtc"` | Preferred for browser |
| Signed URL | `POST /v1/convai/conversation/get_signed_url` | Server-side, requires API key |
| Custom LLM | Dashboard config | OpenAI-compatible endpoint |
| Client Tools | `startSession({ clientTools: {...} })` | Browser-side execution |
| Server Tools | Dashboard webhook config | For API calls from ElevenLabs |
| RAG | Dashboard knowledge base | NOT recommended for our use case |
| Chat Mode | `overrides: { conversation: { textOnly: true } }` | Text-only fallback |
| Conversation History | `GET /v1/convai/conversations/{id}` | Transcript retrieval |
| Pricing | $0.08-0.10/min | LLM costs separate (ours via Custom LLM) |

## Appendix B: Key Source References

- [ElevenLabs WebSocket API](https://elevenlabs.io/docs/agents-platform/libraries/web-sockets)
- [ElevenLabs React SDK](https://elevenlabs.io/docs/agents-platform/libraries/react)
- [ElevenLabs Client Tools](https://elevenlabs.io/docs/conversational-ai/customization/tools/client-tools)
- [ElevenLabs Custom LLM](https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm)
- [ElevenLabs Overrides](https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides)
- [ElevenLabs RAG](https://elevenlabs.io/docs/eleven-agents/customization/knowledge-base/rag)
- [ElevenLabs Chat Mode](https://elevenlabs.io/blog/elevenlabs-agents-now-support-chat-mode)
- [ElevenLabs WebRTC](https://elevenlabs.io/blog/conversational-ai-webrtc)
- [ElevenLabs Pricing](https://elevenlabs.io/pricing/api)
- [ElevenLabs Packages (GitHub)](https://github.com/elevenlabs/packages)
- [Koncierge Prior Art Research](../research/prior-art.md)
