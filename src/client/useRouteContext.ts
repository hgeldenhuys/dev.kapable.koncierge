import { useLocation } from "react-router-dom";
import { useMemo } from "react";

export interface RouteContext {
  /** Current React Router pathname, e.g. "/projects" */
  route: string;
  /** Page title derived from document.title or route pathname */
  pageTitle: string;
}

/**
 * Extracts the current route path and page title so they can be
 * sent alongside every Koncierge message.
 *
 * - `route` comes from React Router's `useLocation().pathname`
 * - `pageTitle` comes from `document.title`, falling back to
 *   a humanised version of the pathname if the title is generic.
 */
export function useRouteContext(): RouteContext {
  const { pathname } = useLocation();

  const pageTitle = useMemo(() => {
    const docTitle = typeof document !== "undefined" ? document.title : "";
    // If document.title is set and isn't just the app name, use it
    if (docTitle && !isGenericTitle(docTitle)) {
      return docTitle;
    }
    // Fall back to humanising the pathname
    return humanisePathname(pathname);
  }, [pathname]);

  return { route: pathname, pageTitle };
}

/** Titles that are just the app name / empty — not page-specific */
const GENERIC_TITLES = new Set(["", "kapable", "kapable console"]);

function isGenericTitle(title: string): boolean {
  return GENERIC_TITLES.has(title.trim().toLowerCase());
}

/**
 * Turn "/projects/abc-123/settings" into "Projects / Settings"
 */
function humanisePathname(pathname: string): string {
  const segments = pathname
    .split("/")
    .filter(Boolean)
    // Drop segments that look like UUIDs or numeric IDs
    .filter((s) => !isIdSegment(s));

  if (segments.length === 0) return "Dashboard";

  const parts: string[] = [];
  for (const seg of segments) {
    parts.push(capitalise(seg.replace(/-/g, " ")));
  }
  return parts.join(" / ");
}

function isIdSegment(segment: string): boolean {
  // UUID pattern or pure digits
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(segment) || /^\d+$/.test(segment);
}

function capitalise(str: string): string {
  if (str.length === 0) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export { humanisePathname, isGenericTitle };
