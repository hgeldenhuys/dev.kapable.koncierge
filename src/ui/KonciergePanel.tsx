import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useMessagePartText,
} from "@assistant-ui/react";
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { parseToolCalls, type KonciergeToolCall } from "./tool-calls";

// ─── Inline styles (self-contained, no external CSS required) ────────────────

const panelContainerStyle: CSSProperties = {
  position: "fixed",
  bottom: 16,
  right: 16,
  zIndex: 9999,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const panelStyle: CSSProperties = {
  width: 380,
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
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  outline: "none",
  resize: "none",
  fontFamily: "inherit",
  lineHeight: 1.4,
  maxHeight: 100,
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
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <KonciergeToolsContext.Provider value={onToolCalls ?? null}>
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
                    {emptyContent ?? "Ask me anything about Kapable!"}
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
