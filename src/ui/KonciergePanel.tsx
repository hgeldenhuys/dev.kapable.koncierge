import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useMessagePartText,
} from "@assistant-ui/react";
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { parseToolCalls, type KonciergeToolCall } from "./tool-calls";

// ─── localStorage persistence ────────────────────────────────────────────────

const STORAGE_KEY = "koncierge:collapsed";

function readCollapsed(fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    // SSR or storage unavailable — fall through
  }
  return fallback;
}

function writeCollapsed(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // quota exceeded or unavailable — silently ignore
  }
}

// ─── Inline styles (self-contained, no external CSS required) ────────────────

const panelContainerStyle: CSSProperties = {
  position: "fixed",
  bottom: 16,
  right: 16,
  zIndex: 40,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  fontFamily: "system-ui, -apple-system, sans-serif",
  maxWidth: "calc(100vw - 32px)",
  boxSizing: "border-box",
  overflow: "hidden",
};

const panelStyle: CSSProperties = {
  width: "min(380px, calc(100vw - 32px))",
  maxHeight: "70vh",
  display: "flex",
  flexDirection: "column",
  borderRadius: 12,
  border: "1px solid var(--k-border)",
  backgroundColor: "var(--k-bg)",
  boxShadow: "var(--k-shadow)",
  overflow: "hidden",
  marginBottom: 8,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 16px",
  borderBottom: "1px solid var(--k-border)",
  backgroundColor: "var(--k-bg-subtle)",
};

const headerTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "var(--k-text)",
  margin: 0,
};

const collapseButtonStyle: CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 18,
  color: "var(--k-text-muted)",
  padding: "0 4px",
  lineHeight: 1,
  minWidth: 44,
  minHeight: 44,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const viewportStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "12px 16px",
  minHeight: 200,
  maxHeight: "50vh",
};

const emptyStyle: CSSProperties = {
  textAlign: "center",
  color: "var(--k-text-muted)",
  fontSize: 13,
  padding: "32px 16px",
};

const emptyIconStyle: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: "50%",
  backgroundColor: "var(--k-accent)",
  color: "var(--k-accent-text)",
  fontSize: 18,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  margin: "0 auto 12px",
};

const emptyHeadingStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: "var(--k-text)",
  marginBottom: 8,
};

const userMessageStyle: CSSProperties = {
  marginBottom: 12,
  display: "flex",
  justifyContent: "flex-end",
};

const userBubbleStyle: CSSProperties = {
  backgroundColor: "var(--k-accent)",
  color: "var(--k-accent-text)",
  borderRadius: "12px 12px 4px 12px",
  padding: "8px 12px",
  fontSize: 13,
  maxWidth: "85%",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const assistantMessageStyle: CSSProperties = {
  marginBottom: 12,
  display: "flex",
  justifyContent: "flex-start",
};

const assistantBubbleStyle: CSSProperties = {
  backgroundColor: "var(--k-bg-muted)",
  color: "var(--k-text)",
  borderRadius: "12px 12px 12px 4px",
  padding: "8px 12px",
  fontSize: 13,
  maxWidth: "85%",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const composerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  borderTop: "1px solid var(--k-border)",
  backgroundColor: "var(--k-bg)",
};

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: "1px solid var(--k-border)",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  outline: "none",
  resize: "none",
  fontFamily: "inherit",
  lineHeight: 1.4,
  maxHeight: 100,
  boxSizing: "border-box",
  color: "var(--k-text)",
  backgroundColor: "var(--k-bg)",
};

const sendButtonStyle: CSSProperties = {
  backgroundColor: "var(--k-accent)",
  color: "var(--k-accent-text)",
  border: "none",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
  minHeight: 44,
  minWidth: 44,
};

const fabStyle: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: "50%",
  backgroundColor: "var(--k-accent, #3b82f6)",
  color: "var(--k-accent-text, #ffffff)",
  border: "none",
  cursor: "pointer",
  fontSize: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "var(--k-fab-shadow, 0 4px 12px rgba(59, 130, 246, 0.4))",
};

// ─── Scoped styles for pseudo-selectors (can't be done with inline styles) ───

const SCOPED_CLASS = "koncierge-panel";

const scopedCSS = `
/* ─── Theme variables ─────────────────────────────────────────────────── */
.${SCOPED_CLASS} {
  --k-bg: #ffffff;
  --k-bg-subtle: #f8fafc;
  --k-bg-muted: #f1f5f9;
  --k-text: #1e293b;
  --k-text-muted: #94a3b8;
  --k-border: #e2e8f0;
  --k-accent: #3b82f6;
  --k-accent-text: #ffffff;
  --k-code-bg: #e2e8f0;
  --k-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  --k-fab-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
  color-scheme: light dark;
}
/* Dark mode: .dark ancestor (shadcn/ui) or OS preference */
.dark .${SCOPED_CLASS},
[data-theme="dark"] .${SCOPED_CLASS} {
  --k-bg: #1e1e2e;
  --k-bg-subtle: #252538;
  --k-bg-muted: #2a2a3e;
  --k-text: #e2e8f0;
  --k-text-muted: #64748b;
  --k-border: #3a3a52;
  --k-accent: #60a5fa;
  --k-accent-text: #ffffff;
  --k-code-bg: #3a3a52;
  --k-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  --k-fab-shadow: 0 4px 12px rgba(96, 165, 250, 0.4);
}
@media (prefers-color-scheme: dark) {
  .${SCOPED_CLASS}:not(.koncierge-light) {
    --k-bg: #1e1e2e;
    --k-bg-subtle: #252538;
    --k-bg-muted: #2a2a3e;
    --k-text: #e2e8f0;
    --k-text-muted: #64748b;
    --k-border: #3a3a52;
    --k-accent: #60a5fa;
    --k-accent-text: #ffffff;
    --k-code-bg: #3a3a52;
    --k-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    --k-fab-shadow: 0 4px 12px rgba(96, 165, 250, 0.4);
  }
}
/* ─── Scoped pseudo-selectors ─────────────────────────────────────────── */
.${SCOPED_CLASS} textarea::placeholder,
.${SCOPED_CLASS} input::placeholder {
  color: var(--k-text-muted) !important;
  -webkit-text-fill-color: var(--k-text-muted) !important;
  opacity: 1;
}
.${SCOPED_CLASS} textarea,
.${SCOPED_CLASS} input {
  color: var(--k-text) !important;
  -webkit-text-fill-color: var(--k-text) !important;
  background-color: var(--k-bg) !important;
}
@media (max-width: 480px) {
  .${SCOPED_CLASS} {
    max-height: 60vh;
    width: calc(100vw - 16px) !important;
  }
}
@media (max-width: 375px) {
  .${SCOPED_CLASS} {
    max-height: 55vh;
    width: calc(100vw - 8px) !important;
    border-radius: 8px !important;
  }
  .${SCOPED_CLASS} [data-koncierge-composer] {
    padding: 6px 8px !important;
    gap: 4px !important;
  }
  .${SCOPED_CLASS} [data-koncierge-header] {
    padding: 8px 12px !important;
  }
}
`;

// ─── Tool execution context ──────────────────────────────────────────────────

type ToolExecutor = (toolCalls: KonciergeToolCall[]) => void;

const KonciergeToolsContext = createContext<ToolExecutor | null>(null);

// ─── Minimal markdown → HTML ─────────────────────────────────────────────────

function renderSimpleMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code style="background:var(--k-code-bg);padding:1px 4px;border-radius:3px;font-size:12px">$1</code>')
    .replace(/\n/g, "<br/>");
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TextPart() {
  const { text } = useMessagePartText();
  const executeTools = useContext(KonciergeToolsContext);
  const executedRef = useRef<string>("");

  const { displayText, toolCalls } = parseToolCalls(text);

  // Execute tool calls once when they appear (deduplicate by JSON key)
  useEffect(() => {
    if (toolCalls.length === 0 || !executeTools) return;
    const key = JSON.stringify(toolCalls);
    if (executedRef.current === key) return;
    executedRef.current = key;
    executeTools(toolCalls);
  }, [toolCalls, executeTools]);

  return <span dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(displayText) }} />;
}

function UserMessage() {
  return (
    <MessagePrimitive.Root style={userMessageStyle}>
      <div style={userBubbleStyle}>
        <MessagePrimitive.Parts
          components={{ Text: TextPart }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root style={assistantMessageStyle}>
      <div style={assistantBubbleStyle}>
        <MessagePrimitive.Parts
          components={{ Text: TextPart }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export interface KonciergePanelProps {
  /** Override the panel title. Default: "Koncierge" */
  title?: string;
  /** Start collapsed? Default: true */
  defaultCollapsed?: boolean;
  /** Custom empty state content */
  emptyContent?: ReactNode;
  /** Custom CSS class for the container */
  className?: string;
  /**
   * Callback to execute tool calls extracted from assistant messages.
   * Typically provided by useKonciergeTools().executeTools.
   * If omitted, tool calls are parsed and stripped but not executed.
   */
  onToolCalls?: (toolCalls: KonciergeToolCall[]) => void;
}

/**
 * Collapsible chat panel for the Koncierge onboarding assistant.
 *
 * Must be rendered inside a `<KonciergeRuntimeProvider>`.
 * Renders a floating panel with:
 * - Collapsible header with title
 * - Message thread with auto-scroll
 * - Text input with send button
 * - FAB toggle when collapsed
 *
 * When `onToolCalls` is provided, embedded tool call JSON is stripped from
 * displayed messages and dispatched for execution (navigate, highlight, etc.).
 */
export function KonciergePanel({
  title = "Koncierge",
  defaultCollapsed = true,
  emptyContent,
  className,
  onToolCalls,
}: KonciergePanelProps) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(defaultCollapsed));

  useEffect(() => {
    writeCollapsed(collapsed);
  }, [collapsed]);

  return (
    <KonciergeToolsContext.Provider value={onToolCalls ?? null}>
      <style dangerouslySetInnerHTML={{ __html: scopedCSS }} />
      <div style={panelContainerStyle} className={className}>
        {!collapsed && (
          <div style={panelStyle} className={SCOPED_CLASS}>
            {/* Header */}
            <div style={headerStyle} data-koncierge-header>
              <h3 style={headerTitleStyle}>{title}</h3>
              <button
                type="button"
                style={collapseButtonStyle}
                onClick={() => setCollapsed(true)}
                aria-label="Collapse chat"
              >
                &times;
              </button>
            </div>

            {/* Thread viewport with auto-scroll */}
            <ThreadPrimitive.Root>
              <ThreadPrimitive.Viewport style={viewportStyle}>
                <ThreadPrimitive.Empty>
                  <div style={emptyStyle}>
                    {emptyContent ?? (
                      <>
                        <div style={emptyIconStyle} aria-hidden="true">K</div>
                        <div style={emptyHeadingStyle}>
                          Hi, I'm Koncierge — ask me anything about the Kapable platform
                        </div>
                        <div>
                          Say <strong>"show me around"</strong> to get started.
                        </div>
                      </>
                    )}
                  </div>
                </ThreadPrimitive.Empty>

                <ThreadPrimitive.Messages
                  components={{
                    UserMessage,
                    AssistantMessage,
                  }}
                />
              </ThreadPrimitive.Viewport>

              {/* Composer: input + send */}
              <ComposerPrimitive.Root style={composerStyle} data-koncierge-composer>
                <ComposerPrimitive.Input
                  placeholder="Type a message..."
                  style={inputStyle as unknown as Record<string, unknown>}
                  autoFocus
                />
                <ComposerPrimitive.Send style={sendButtonStyle}>
                  Send
                </ComposerPrimitive.Send>
              </ComposerPrimitive.Root>
            </ThreadPrimitive.Root>
          </div>
        )}

        {/* FAB toggle */}
        <button
          type="button"
          style={fabStyle}
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Open chat" : "Close chat"}
        >
          {collapsed ? "?" : "\u2013"}
        </button>
      </div>
    </KonciergeToolsContext.Provider>
  );
}
