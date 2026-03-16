import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useMessagePartText,
  useThreadRuntime,
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

// ─── Scoped CSS for pseudo-elements (inline styles can't target ::placeholder) ─

const KONCIERGE_INPUT_CLASS = "koncierge-composer-input";

const scopedCSS = `
.${KONCIERGE_INPUT_CLASS} {
  color: #1e293b !important;
  background-color: #ffffff !important;
}
.${KONCIERGE_INPUT_CLASS}::placeholder {
  color: #94a3b8 !important;
}
`;

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
};

const panelStyle: CSSProperties = {
  width: "min(380px, calc(100vw - 32px))",
  maxHeight: "70vh",
  display: "flex",
  flexDirection: "column",
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  backgroundColor: "#ffffff",
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.12)",
  overflow: "hidden",
  marginBottom: 8,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 16px",
  borderBottom: "1px solid #e2e8f0",
  backgroundColor: "#f8fafc",
};

const headerTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#1e293b",
  margin: 0,
};

const collapseButtonStyle: CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 18,
  color: "#64748b",
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
  color: "#94a3b8",
  fontSize: 13,
  padding: "32px 16px",
};

const emptyIconStyle: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: "50%",
  backgroundColor: "#3b82f6",
  color: "#ffffff",
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
  color: "#1e293b",
  marginBottom: 8,
};

const suggestedQuestionsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginTop: 12,
};

const suggestedQuestionBtnStyle: CSSProperties = {
  background: "none",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 12,
  color: "#3b82f6",
  cursor: "pointer",
  textAlign: "left",
  lineHeight: 1.4,
  fontFamily: "inherit",
};

const userMessageStyle: CSSProperties = {
  marginBottom: 12,
  display: "flex",
  justifyContent: "flex-end",
};

const userBubbleStyle: CSSProperties = {
  backgroundColor: "#3b82f6",
  color: "#ffffff",
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
  backgroundColor: "#f1f5f9",
  color: "#1e293b",
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
  borderTop: "1px solid #e2e8f0",
  backgroundColor: "#ffffff",
};

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  outline: "none",
  resize: "none",
  fontFamily: "inherit",
  lineHeight: 1.4,
  maxHeight: 100,
  boxSizing: "border-box",
  color: "#1e293b",
  backgroundColor: "#ffffff",
};

const sendButtonStyle: CSSProperties = {
  backgroundColor: "#3b82f6",
  color: "#ffffff",
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
  backgroundColor: "#3b82f6",
  color: "#ffffff",
  border: "none",
  cursor: "pointer",
  fontSize: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 4px 12px rgba(59, 130, 246, 0.4)",
};

// ─── Tool execution context ──────────────────────────────────────────────────

type ToolExecutor = (toolCalls: KonciergeToolCall[]) => void;

const KonciergeToolsContext = createContext<ToolExecutor | null>(null);

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

  return <span>{displayText}</span>;
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

const SUGGESTED_QUESTIONS = [
  "What can Kapable do?",
  "Show me around the platform",
  "How do I create my first workflow?",
];

function SuggestedQuestions() {
  const threadRuntime = useThreadRuntime();
  const handleClick = (text: string) => {
    threadRuntime.append({ role: "user", content: [{ type: "text", text }] });
  };
  return (
    <div style={suggestedQuestionsStyle}>
      {SUGGESTED_QUESTIONS.map((q) => (
        <button
          key={q}
          type="button"
          style={suggestedQuestionBtnStyle}
          onClick={() => handleClick(q)}
        >
          {q}
        </button>
      ))}
    </div>
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
  // Always start with the defaultCollapsed prop to match the server render.
  // Hydrating with a localStorage-derived value would cause React error #418
  // because the server snapshot has no access to localStorage.
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // Sync from localStorage on mount (client-only) — this runs AFTER hydration
  // so no mismatch occurs. If the stored value differs from defaultCollapsed,
  // React batches the state update into the first paint.
  useEffect(() => {
    const stored = readCollapsed(defaultCollapsed);
    if (stored !== defaultCollapsed) {
      setCollapsed(stored);
    }
  }, [defaultCollapsed]);

  useEffect(() => {
    writeCollapsed(collapsed);
  }, [collapsed]);

  return (
    <KonciergeToolsContext.Provider value={onToolCalls ?? null}>
      <style dangerouslySetInnerHTML={{ __html: scopedCSS }} />
      <div style={panelContainerStyle} className={className}>
        {!collapsed && (
          <div style={panelStyle}>
            {/* Header */}
            <div style={headerStyle}>
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
                          Hi, I'm Koncierge
                        </div>
                        <div>
                          I can help you explore the Kapable platform.
                          Try one of these to get started:
                        </div>
                        <SuggestedQuestions />
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
              <ComposerPrimitive.Root style={composerStyle}>
                <ComposerPrimitive.Input
                  placeholder="Type a message..."
                  className={KONCIERGE_INPUT_CLASS}
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
