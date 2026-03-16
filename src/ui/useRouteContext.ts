import { useState, useEffect, useCallback, useSyncExternalStore } from "react";

export interface RouteContext {
  /** Current pathname, e.g. "/projects/abc/apps" */
  route: string;
  /** Current document title */
  pageTitle: string;
}

/**
 * Snapshot functions for useSyncExternalStore.
 * Reading location.pathname + document.title is cheap and safe.
 */
function getRouteSnapshot(): RouteContext {
  return {
    route: window.location.pathname,
    pageTitle: document.title,
  };
}

/** SSR fallback — return empty context */
function getServerSnapshot(): RouteContext {
  return { route: "", pageTitle: "" };
}

/**
 * Subscribe to navigation changes.
 * Listens for popstate (back/forward) and a custom "routechange" event
 * that SPA routers (React Router, etc.) can dispatch on pushState/replaceState.
 *
 * Also patches pushState/replaceState to fire "routechange" automatically
 * so it works without any cooperation from the router.
 */
let patched = false;

function patchHistoryMethods() {
  if (patched) return;
  patched = true;

  const originalPush = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);

  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    originalPush(...args);
    window.dispatchEvent(new Event("routechange"));
  };

  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    originalReplace(...args);
    window.dispatchEvent(new Event("routechange"));
  };
}

function subscribeToRouteChanges(callback: () => void): () => void {
  // Patch history methods on first subscription
  if (typeof window !== "undefined") {
    patchHistoryMethods();
  }

  window.addEventListener("popstate", callback);
  window.addEventListener("routechange", callback);

  // Also observe title changes via MutationObserver on <title>
  let observer: MutationObserver | null = null;
  const titleEl = document.querySelector("title");
  if (titleEl) {
    observer = new MutationObserver(callback);
    observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("routechange", callback);
    observer?.disconnect();
  };
}

/**
 * Hook that returns the current route context (pathname + page title),
 * automatically updating when the user navigates.
 *
 * Accepts optional overrides — if `routeOverride` or `titleOverride` is
 * provided, those values take precedence over auto-detection. This lets
 * consumers pass values from React Router's useLocation() if preferred.
 */
export function useRouteContext(
  routeOverride?: string,
  titleOverride?: string,
): RouteContext {
  const detected = useSyncExternalStore(
    subscribeToRouteChanges,
    getRouteSnapshot,
    getServerSnapshot,
  );

  return {
    route: routeOverride ?? detected.route,
    pageTitle: titleOverride ?? detected.pageTitle,
  };
}

export default useRouteContext;
