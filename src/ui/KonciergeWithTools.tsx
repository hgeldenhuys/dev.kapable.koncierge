/**
 * KonciergeWithTools — batteries-included integration wrapper.
 *
 * Composes KonciergeRuntimeProvider, KonciergePanel, useKonciergeTools,
 * and useReactRouterRoute into a single drop-in component. The consumer
 * only needs to supply a `navigate` function (from React Router's
 * useNavigate) and the BFF endpoint — everything else is wired internally.
 *
 * Usage in the console dashboard layout:
 * ```tsx
 * import { useNavigate, useLocation } from "react-router";
 * import { KonciergeWithTools } from "@kapable/koncierge/ui";
 *
 * function DashboardLayout() {
 *   const navigate = useNavigate();
 *   const location = useLocation();
 *
 *   return (
 *     <>
 *       <Outlet />
 *       <KonciergeWithTools
 *         navigate={navigate}
 *         pathname={location.pathname}
 *         endpoint="/api/koncierge/message"
 *       />
 *     </>
 *   );
 * }
 * ```
 */

import { useMemo, type ReactNode } from "react";
import { KonciergeRuntimeProvider } from "./KonciergeRuntimeProvider";
import type { KonciergeAdapterConfig } from "./koncierge-adapter";
import { KonciergePanel, type KonciergePanelProps } from "./KonciergePanel";
import { useKonciergeTools } from "./useKonciergeTools";
import { useReactRouterRoute } from "./route-context";

export interface KonciergeWithToolsProps {
  /** React Router's navigate function (from useNavigate()) */
  navigate: (to: string) => void;
  /** Current pathname from React Router (location.pathname) */
  pathname: string;
  /** BFF proxy endpoint, e.g. "/api/koncierge/message" */
  endpoint: string;
  /** Additional headers (e.g. auth tokens) */
  headers?: Record<string, string>;
  /** Called when a non-recoverable error occurs (e.g. for toast notifications) */
  onError?: (message: string) => void;
  /** Notification callback for tool actions (e.g. "Navigating to Dashboard...") */
  onNotify?: (message: string) => void;
  /** Override the panel title. Default: "Koncierge" */
  title?: string;
  /** Start collapsed? Default: true */
  defaultCollapsed?: boolean;
  /** Custom empty state content */
  emptyContent?: ReactNode;
  /** Custom CSS class for the panel container */
  className?: string;
}

/**
 * Fully-wired Koncierge panel: drops into any React Router layout and
 * immediately supports navigate, highlight, tooltip, and showSection
 * tool calls from the agent.
 *
 * Internally wires:
 *   useReactRouterRoute(pathname) → adapter config (route context)
 *   useKonciergeTools({ navigate }) → handleToolUseEvent → RuntimeProvider.onToolCall
 *                                   → executeTools → Panel.onToolCalls
 */
export function KonciergeWithTools({
  navigate,
  pathname,
  endpoint,
  headers,
  onError,
  onNotify,
  title,
  defaultCollapsed,
  emptyContent,
  className,
}: KonciergeWithToolsProps) {
  // Wire route context from React Router
  const routeCtx = useReactRouterRoute(pathname);

  // Wire tool execution with the navigate function
  const { executeTools, handleToolUseEvent } = useKonciergeTools({
    navigate,
    onNotify,
  });

  // Build adapter config — memoize to avoid recreating adapter on every render
  const adapterConfig: KonciergeAdapterConfig = useMemo(
    () => ({
      endpoint,
      headers,
      onError,
      getRoute: routeCtx.getRoute,
      getPageTitle: routeCtx.getPageTitle,
    }),
    [endpoint, headers, onError, routeCtx.getRoute, routeCtx.getPageTitle],
  );

  // Panel props
  const panelProps: KonciergePanelProps = {
    title,
    defaultCollapsed,
    emptyContent,
    className,
    onToolCalls: executeTools,
  };

  return (
    <KonciergeRuntimeProvider
      config={adapterConfig}
      onToolCall={handleToolUseEvent}
    >
      <KonciergePanel {...panelProps} />
    </KonciergeRuntimeProvider>
  );
}
