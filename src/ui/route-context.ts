/**
 * Default route context getters for the Koncierge adapter.
 *
 * These read from browser globals (window.location, document.title)
 * and are SSR-safe — they return empty strings when globals are unavailable.
 * The adapter calls these at request time, so they always return current values.
 */

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
