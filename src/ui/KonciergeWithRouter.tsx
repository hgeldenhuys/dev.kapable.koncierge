/**
 * KonciergeWithRouter — drop-in integration component for React Router apps.
 *
 * Wires together KonciergeRuntimeProvider, KonciergePanel, useKonciergeTools,
 * and useReactRouterRoute so the consumer just renders one component:
 *
 * ```tsx
 * import { KonciergeWithRouter } from "@kapable/koncierge/ui";
 *
 * function AppLayout() {
 *   return (
 *     <>
 *       <Outlet />
 *       <KonciergeWithRouter endpoint="/api/koncierge/message" />
 *     </>
 *   );
 * }
 * ```
 *
 * Requires react-router v6/v7 as a peer dependency.
 */

import { useNavigate, useLocation } from "react-router";
import { KonciergeRuntimeProvider } from "./KonciergeRuntimeProvider";
import { KonciergePanel, type KonciergePanelProps } from "./KonciergePanel";
import { useKonciergeTools } from "./useKonciergeTools";
import { useReactRouterRoute } from "./route-context";
import type { ReactNode } from "react";

export interface KonciergeWithRouterProps {
  /** BFF proxy endpoint, e.g. "/api/koncierge/message" */
  endpoint: string;
  /** Additional headers (e.g. auth tokens) */
  headers?: Record<string, string>;
  /** Called when a non-recoverable error occurs (e.g. for toast notifications) */
  onError?: (message: string) => void;
  /** Optional notification callback (e.g. toast). Called when a tool executes. */
  onNotify?: (message: string) => void;
  /** Override the panel title. Default: "Koncierge" */
  title?: KonciergePanelProps["title"];
  /** Start collapsed? Default: true */
  defaultCollapsed?: KonciergePanelProps["defaultCollapsed"];
  /** Custom empty state content */
  emptyContent?: KonciergePanelProps["emptyContent"];
  /** Custom CSS class for the panel container */
  className?: KonciergePanelProps["className"];
  /** Optional children rendered alongside the panel inside the provider */
  children?: ReactNode;
}

/**
 * Drop-in Koncierge component for React Router apps.
 *
 * Automatically wires:
 * - `useNavigate()` → tool-based navigation (no full page reloads)
 * - `useLocation()` → route context injected into every message
 * - `useKonciergeTools()` → highlight, tooltip, showSection DOM effects
 * - `useReactRouterRoute()` → stable getRoute/getPageTitle callbacks
 *
 * Renders a KonciergeRuntimeProvider wrapping a KonciergePanel with full
 * tool execution support.
 */
export function KonciergeWithRouter({
  endpoint,
  headers,
  onError,
  onNotify,
  title,
  defaultCollapsed,
  emptyContent,
  className,
  children,
}: KonciergeWithRouterProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const routeCtx = useReactRouterRoute(pathname);

  const { executeTools, handleToolUseEvent } = useKonciergeTools({
    navigate,
    onNotify,
  });

  return (
    <KonciergeRuntimeProvider
      config={{
        endpoint,
        headers,
        onError,
        getRoute: routeCtx.getRoute,
        getPageTitle: routeCtx.getPageTitle,
      }}
      onToolCall={handleToolUseEvent}
    >
      <KonciergePanel
        title={title}
        defaultCollapsed={defaultCollapsed}
        emptyContent={emptyContent}
        className={className}
        onToolCalls={executeTools}
      />
      {children}
    </KonciergeRuntimeProvider>
  );
}
