import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  type FC,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouteContext } from "./useRouteContext";

// ── Types ──────────────────────────────────────────────────

export interface ToolCall {
  tool: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  timestamp: number;
}

export interface KonciergePanelProps {
  /** SSE endpoint, e.g. "/bff/koncierge/message" or full URL */
  endpoint: string;
  /** Extra headers (auth, session token) */
  headers?: Record<string, string>;
  /** Current route for context injection */
  currentRoute?: string;
  /** Current page title for context */
  pageTitle?: string;
  /** Callback when agent emits a navigate tool call */
  onNavigate?: (route: string) => void;
  /** Callback for highlight tool calls */
  onHighlight?: (selector: string, message: string) => void;
  /** Callback for tooltip tool calls */
  onTooltip?: (target: string, text: string) => void;
  /** Whether the panel is collapsed */
  collapsed?: boolean;
  /** Custom className for the outer container */
  className?: string;
}

// ── Tool call extraction ───────────────────────────────────

const TOOL_CALL_RE = /\{"tool"\s*:\s*"(\w+)"[^}]*\}/g;

function extractToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const matches = text.matchAll(TOOL_CALL_RE);
  for (const match of matches) {
    try {
      calls.push(JSON.parse(match[0]));
    } catch {
      // skip malformed
    }
  }
  return calls;
}

function stripToolCallJson(text: string): string {
  return text.replace(TOOL_CALL_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

// ── SSE parser hook ────────────────────────────────────────

function useKonciergeStream(props: {
  endpoint: string;
  headers?: Record<string, string>;
  currentRoute?: string;
  pageTitle?: string;
}) {
  // Auto-detect route context, with prop overrides taking precedence
  const routeCtx = useRouteContext(props.currentRoute, props.pageTitle);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messageIdRef = useRef(0);

  const sendMessage = useCallback(
    async (text: string) => {
      // Cancel any in-flight request
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const userMsg: ChatMessage = {
        id: `msg_${++messageIdRef.current}`,
        role: "user",
        content: text,
        timestamp: Date.now(),
      };

      // Optimistically add user message and placeholder assistant message
      const assistantId = `msg_${++messageIdRef.current}`;
      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
        },
      ]);

      setIsStreaming(true);

      try {
        const response = await fetch(props.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...props.headers,
          },
          body: JSON.stringify({
            message: text,
            route: routeCtx.route,
            pageTitle: routeCtx.pageTitle,
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "Unknown error");
          throw new Error(`Request failed (${response.status}): ${errText}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;

            try {
              const event = JSON.parse(payload);
              if (event.delta) {
                fullText += event.delta;
                const toolCalls = extractToolCalls(fullText);
                const cleanText = stripToolCallJson(fullText);

                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  if (lastIdx >= 0 && updated[lastIdx].id === assistantId) {
                    updated[lastIdx] = {
                      ...updated[lastIdx],
                      content: cleanText,
                      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                    };
                  }
                  return updated;
                });
              }
              if (event.error) {
                throw new Error(event.error);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;

        // Show error in the assistant message
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].id === assistantId) {
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: `⚠ Error: ${(err as Error).message}`,
            };
          }
          return updated;
        });
      } finally {
        setIsStreaming(false);
      }
    },
    [props.endpoint, props.headers, routeCtx.route, routeCtx.pageTitle],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { messages, isStreaming, sendMessage, cancel, routeCtx };
}

// ── Components ─────────────────────────────────────────────

const ToolCallButton: FC<{
  toolCall: ToolCall;
  onNavigate?: (route: string) => void;
  onHighlight?: (selector: string, message: string) => void;
  onTooltip?: (target: string, text: string) => void;
}> = ({ toolCall, onNavigate, onHighlight, onTooltip }) => {
  const handleClick = () => {
    switch (toolCall.tool) {
      case "navigate":
        onNavigate?.(toolCall.route as string);
        break;
      case "highlight":
        onHighlight?.(toolCall.selector as string, toolCall.message as string);
        break;
      case "tooltip":
        onTooltip?.(toolCall.target as string, toolCall.text as string);
        break;
      case "showSection":
        // Scroll to section
        const el = document.getElementById(toolCall.id as string);
        el?.scrollIntoView({ behavior: "smooth" });
        break;
    }
  };

  const labels: Record<string, string> = {
    navigate: `Go to ${toolCall.route}`,
    highlight: `Show: ${toolCall.message || toolCall.selector}`,
    tooltip: `Tip: ${toolCall.text}`,
    showSection: `Jump to ${toolCall.id}`,
  };

  const icons: Record<string, string> = {
    navigate: "→",
    highlight: "◉",
    tooltip: "💬",
    showSection: "↓",
  };

  return (
    <button
      onClick={handleClick}
      className="koncierge-tool-btn"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 12px",
        marginTop: "6px",
        marginRight: "6px",
        border: "1px solid hsl(var(--border, 220 13% 91%))",
        borderRadius: "6px",
        backgroundColor: "hsl(var(--secondary, 210 40% 96.1%))",
        color: "hsl(var(--secondary-foreground, 222.2 47.4% 11.2%))",
        fontSize: "13px",
        cursor: "pointer",
        transition: "background-color 0.15s",
      }}
      onMouseOver={(e) =>
        (e.currentTarget.style.backgroundColor =
          "hsl(var(--accent, 210 40% 93%))")
      }
      onMouseOut={(e) =>
        (e.currentTarget.style.backgroundColor =
          "hsl(var(--secondary, 210 40% 96.1%))")
      }
    >
      <span>{icons[toolCall.tool] || "⚙"}</span>
      <span>{labels[toolCall.tool] || `${toolCall.tool}`}</span>
    </button>
  );
};

const MessageBubble: FC<{
  message: ChatMessage;
  isStreaming?: boolean;
  onNavigate?: (route: string) => void;
  onHighlight?: (selector: string, message: string) => void;
  onTooltip?: (target: string, text: string) => void;
}> = ({ message, isStreaming, onNavigate, onHighlight, onTooltip }) => {
  const isUser = message.role === "user";

  return (
    <div
      className={`koncierge-msg koncierge-msg-${message.role}`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        marginBottom: "12px",
        maxWidth: "100%",
      }}
    >
      <div
        style={{
          maxWidth: "85%",
          padding: "10px 14px",
          borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
          backgroundColor: isUser
            ? "hsl(var(--primary, 222.2 47.4% 11.2%))"
            : "hsl(var(--muted, 210 40% 96.1%))",
          color: isUser
            ? "hsl(var(--primary-foreground, 210 40% 98%))"
            : "hsl(var(--foreground, 222.2 84% 4.9%))",
          fontSize: "14px",
          lineHeight: "1.5",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {message.content || (isStreaming ? "" : "...")}
        {isStreaming && !message.content && (
          <span className="koncierge-typing" style={{ opacity: 0.6 }}>
            ●●●
          </span>
        )}
        {isStreaming && message.content && (
          <span
            className="koncierge-cursor"
            style={{
              display: "inline-block",
              width: "2px",
              height: "1em",
              backgroundColor: "currentColor",
              marginLeft: "2px",
              animation: "koncierge-blink 1s step-end infinite",
              verticalAlign: "text-bottom",
            }}
          />
        )}
      </div>

      {/* Tool call action buttons */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", marginTop: "4px" }}>
          {message.toolCalls.map((tc, i) => (
            <ToolCallButton
              key={`${message.id}-tool-${i}`}
              toolCall={tc}
              onNavigate={onNavigate}
              onHighlight={onHighlight}
              onTooltip={onTooltip}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main Panel ─────────────────────────────────────────────

export const KonciergePanel: FC<KonciergePanelProps> = ({
  endpoint,
  headers,
  currentRoute,
  pageTitle,
  onNavigate,
  onHighlight,
  onTooltip,
  collapsed = false,
  className,
}) => {
  const { messages, isStreaming, sendMessage, routeCtx } = useKonciergeStream({
    endpoint,
    headers,
    currentRoute,
    pageTitle,
  });

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when panel expands
  useEffect(() => {
    if (!collapsed) {
      inputRef.current?.focus();
    }
  }, [collapsed]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    sendMessage(trimmed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  };

  if (collapsed) return null;

  return (
    <div
      className={`koncierge-panel ${className || ""}`}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        borderLeft: "1px solid hsl(var(--border, 220 13% 91%))",
        backgroundColor: "hsl(var(--background, 0 0% 100%))",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "12px 16px",
          borderBottom: "1px solid hsl(var(--border, 220 13% 91%))",
          fontSize: "14px",
          fontWeight: 600,
          color: "hsl(var(--foreground, 222.2 84% 4.9%))",
        }}
      >
        <span style={{ fontSize: "18px" }}>🔔</span>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 }}>
          <span>Koncierge</span>
          {routeCtx.route && (
            <span
              style={{
                fontSize: "11px",
                color: "hsl(var(--muted-foreground, 215.4 16.3% 46.9%))",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontWeight: 400,
              }}
              title={routeCtx.route}
            >
              {routeCtx.route}
            </span>
          )}
        </div>
        {isStreaming && (
          <span
            style={{
              fontSize: "11px",
              color: "hsl(var(--muted-foreground, 215.4 16.3% 46.9%))",
              flexShrink: 0,
            }}
          >
            typing…
          </span>
        )}
      </div>

      {/* Messages area */}
      <div
        className="koncierge-messages"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flex: 1,
              gap: "8px",
              color: "hsl(var(--muted-foreground, 215.4 16.3% 46.9%))",
              fontSize: "14px",
              textAlign: "center",
              padding: "20px",
            }}
          >
            <span style={{ fontSize: "32px" }}>🔔</span>
            <p style={{ fontWeight: 500 }}>Welcome to Koncierge</p>
            <p style={{ fontSize: "13px" }}>
              Ask me anything about the Kapable platform.
              I can help you navigate, explain features, and get you started.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isStreaming={
              isStreaming &&
              msg.role === "assistant" &&
              i === messages.length - 1
            }
            onNavigate={onNavigate}
            onHighlight={onHighlight}
            onTooltip={onTooltip}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "8px",
          padding: "12px 16px",
          borderTop: "1px solid hsl(var(--border, 220 13% 91%))",
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything about Kapable…"
          disabled={isStreaming}
          rows={1}
          style={{
            flex: 1,
            resize: "none",
            border: "1px solid hsl(var(--border, 220 13% 91%))",
            borderRadius: "8px",
            padding: "8px 12px",
            fontSize: "14px",
            lineHeight: "1.4",
            backgroundColor: "hsl(var(--background, 0 0% 100%))",
            color: "hsl(var(--foreground, 222.2 84% 4.9%))",
            outline: "none",
            fontFamily: "inherit",
            maxHeight: "120px",
            overflowY: "auto",
          }}
          onFocus={(e) =>
            (e.currentTarget.style.borderColor =
              "hsl(var(--ring, 222.2 84% 4.9%))")
          }
          onBlur={(e) =>
            (e.currentTarget.style.borderColor =
              "hsl(var(--border, 220 13% 91%))")
          }
        />
        <button
          type="submit"
          disabled={!input.trim() || isStreaming}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            border: "none",
            backgroundColor: "hsl(var(--primary, 222.2 47.4% 11.2%))",
            color: "hsl(var(--primary-foreground, 210 40% 98%))",
            fontSize: "14px",
            fontWeight: 500,
            cursor: !input.trim() || isStreaming ? "not-allowed" : "pointer",
            opacity: !input.trim() || isStreaming ? 0.5 : 1,
            transition: "opacity 0.15s",
          }}
        >
          Send
        </button>
      </form>

      {/* Cursor blink animation */}
      <style>{`
        @keyframes koncierge-blink {
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export { useKonciergeStream };
export default KonciergePanel;
