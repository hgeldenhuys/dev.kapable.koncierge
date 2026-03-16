import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import { createKonciergeAdapter, type KonciergeAdapterConfig, type KonciergeToolUseEvent } from "./koncierge-adapter";
import { getRouteFromLocation, getPageTitleFromDocument } from "./route-context";
import { useMemo, useRef, type ReactNode } from "react";
import type { ChatModelAdapter } from "@assistant-ui/react";

export interface KonciergeRuntimeProviderProps {
  /** Configuration for the Koncierge adapter */
  config: KonciergeAdapterConfig;
  /**
   * Callback invoked when the agent emits a tool call (navigate, highlight, etc.).
   * Use with useKonciergeTools() to wire up React Router navigation and DOM effects.
   */
  onToolCall?: (toolCall: KonciergeToolUseEvent) => void;
  children: ReactNode;
}

/**
 * Wraps children with the assistant-ui runtime connected to the Koncierge backend.
 *
 * Automatically injects route context (current pathname + page title) into every
 * message unless the consumer provides explicit getRoute/getPageTitle callbacks.
 *
 * The adapter is created once and cached for the lifetime of the component to
 * avoid resetting the conversation on re-renders.
 *
 * Usage:
 * ```tsx
 * <KonciergeRuntimeProvider config={{
 *   endpoint: "/api/koncierge/message",
 *   onError: (msg) => toast.error(msg),
 * }}>
 *   <KonciergePanel />
 * </KonciergeRuntimeProvider>
 * ```
 */
export function KonciergeRuntimeProvider({
  config,
  onToolCall,
  children,
}: KonciergeRuntimeProviderProps) {
  // Stable ref for onToolCall so the adapter doesn't get recreated on callback changes
  const onToolCallRef = useRef(onToolCall);
  onToolCallRef.current = onToolCall;

  const configWithRouteContext = useMemo(() => ({
    ...config,
    getRoute: config.getRoute ?? getRouteFromLocation,
    getPageTitle: config.getPageTitle ?? getPageTitleFromDocument,
    onToolCall: (tc: KonciergeToolUseEvent) => onToolCallRef.current?.(tc),
  }), [config]);

  // Cache the adapter in a ref so it persists across re-renders
  // (avoids resetting the assistant-ui conversation thread)
  const adapterRef = useRef<ChatModelAdapter | null>(null);
  if (!adapterRef.current) {
    adapterRef.current = createKonciergeAdapter(configWithRouteContext);
  }

  const runtime = useLocalRuntime(adapterRef.current);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
