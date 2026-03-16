/**
 * Route context getters for the Koncierge adapter.
 *
 * Default getters read from browser globals (window.location, document.title)
 * and are SSR-safe — they return empty strings when globals are unavailable.
 * The adapter calls these at request time, so they always return current values.
 *
 * For React Router SPAs, use `useReactRouterRoute()` to get callbacks that
 * always reflect the latest React Router pathname instead of window.location.
 */

import { useCallback, useRef } from "react";

/**
 * Returns the current pathname from window.location.
 * SSR-safe: returns empty string when window is unavailable.
 */
export function getRouteFromLocation(): string {
  return typeof window !== "undefined" ? window.location.pathname : "";
}

/**
 * Returns the current page title from document.title.
 * SSR-safe: returns empty string when document is unavailable.
 */
export function getPageTitleFromDocument(): string {
  return typeof document !== "undefined" ? document.title : "";
}

export interface RouteContextCallbacks {
  getRoute: () => string;
  getPageTitle: () => string;
}

/**
 * React hook that returns stable `getRoute` / `getPageTitle` callbacks
 * driven by a React Router pathname instead of window.location.
 *
 * Usage in the console app:
 * ```tsx
 * import { useLocation } from "react-router";
 * import { useReactRouterRoute, KonciergeRuntimeProvider } from "@kapable/koncierge/ui";
 *
 * function App() {
 *   const location = useLocation();
 *   const routeCtx = useReactRouterRoute(location.pathname);
 *
 *   return (
 *     <KonciergeRuntimeProvider config={{
 *       endpoint: "/api/koncierge/message",
 *       getRoute: routeCtx.getRoute,
 *       getPageTitle: routeCtx.getPageTitle,
 *     }}>
 *       <KonciergePanel />
 *     </KonciergeRuntimeProvider>
 *   );
 * }
 * ```
 */
export function useReactRouterRoute(pathname: string): RouteContextCallbacks {
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const getRoute = useCallback(() => pathnameRef.current, []);
  const getPageTitle = useCallback(() => {
    return typeof document !== "undefined" ? document.title : "";
  }, []);

  return { getRoute, getPageTitle };
}
