import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import { createKonciergeAdapter, type KonciergeAdapterConfig } from "./koncierge-adapter";
import { getRouteFromLocation, getPageTitleFromDocument } from "./route-context";
import { useMemo, useRef, type ReactNode } from "react";
import type { ChatModelAdapter } from "@assistant-ui/react";

export interface KonciergeRuntimeProviderProps {
  /** Configuration for the Koncierge adapter */
  config: KonciergeAdapterConfig;
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
  children,
}: KonciergeRuntimeProviderProps) {
  const configWithRouteContext = useMemo(() => ({
    ...config,
    getRoute: config.getRoute ?? getRouteFromLocation,
    getPageTitle: config.getPageTitle ?? getPageTitleFromDocument,
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
