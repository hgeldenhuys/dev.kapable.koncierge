import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import { createKonciergeAdapter, type KonciergeAdapterConfig } from "./koncierge-adapter";
import { getRouteFromLocation, getPageTitleFromDocument } from "./route-context";
import { useMemo, type ReactNode } from "react";

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
 * Usage:
 * ```tsx
 * <KonciergeRuntimeProvider config={{
 *   endpoint: "/api/koncierge/message",
 *   sessionToken: konciergeToken, // from auth layer / generateSessionTokenFromEnv()
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

  const adapter = useMemo(() => createKonciergeAdapter(configWithRouteContext), [configWithRouteContext]);
  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
