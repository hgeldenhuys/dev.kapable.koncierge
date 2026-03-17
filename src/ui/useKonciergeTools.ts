/**
 * useKonciergeTools — executes Koncierge tool calls in the browser.
 *
 * Accepts a navigate function (from React Router's useNavigate) and
 * provides an `executeTool` callback that dispatches tool calls:
 *   - navigate  → React Router programmatic navigation (no full reload)
 *   - highlight  → CSS pulse animation on target element via querySelector
 *   - tooltip    → Floating tooltip near a DOM element
 *   - showSection → Scroll element into view and highlight it
 */

import { useCallback, useRef } from "react";
import type { KonciergeToolCall } from "./tool-calls";
import type { KonciergeToolUseEvent } from "./koncierge-adapter";

const DEFAULT_HIGHLIGHT_MS = 3000;
const HIGHLIGHT_CLASS = "koncierge-highlight";
const TOOLTIP_CLASS = "koncierge-tooltip";

// ─── CSS injection (once) ─────────────────────────────────────────────────────

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  if (typeof document === "undefined") return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    @keyframes koncierge-pulse {
      0%   { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.6); }
      50%  { box-shadow: 0 0 0 6px rgba(59, 130, 246, 0.2); }
      100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
    }
    .${HIGHLIGHT_CLASS} {
      outline: 2px solid #3b82f6 !important;
      outline-offset: 2px;
      animation: koncierge-pulse 1s ease-in-out 3;
      position: relative;
      z-index: 9998;
    }
    .${TOOLTIP_CLASS} {
      position: absolute;
      background: #1e293b;
      color: #ffffff;
      font-size: 13px;
      padding: 6px 12px;
      border-radius: 6px;
      z-index: 9999;
      max-width: 280px;
      pointer-events: none;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      white-space: pre-wrap;
    }
    .${TOOLTIP_CLASS}::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 16px;
      border: 6px solid transparent;
      border-top-color: #1e293b;
    }
  `;
  document.head.appendChild(style);
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function highlightElement(selector: string, durationMs: number): void {
  let el: Element | null;
  try {
    el = document.querySelector(selector);
  } catch {
    return; // Invalid selector — silently ignore
  }
  if (!el) return;

  injectStyles();
  el.classList.add(HIGHLIGHT_CLASS);
  el.scrollIntoView({ behavior: "smooth", block: "center" });

  setTimeout(() => {
    el.classList.remove(HIGHLIGHT_CLASS);
  }, durationMs);
}

function showTooltip(selector: string, text: string, durationMs: number): void {
  let el: Element | null;
  try {
    el = document.querySelector(selector);
  } catch {
    return; // Invalid selector — silently ignore
  }
  if (!el) return;

  injectStyles();
  el.scrollIntoView({ behavior: "smooth", block: "center" });

  const rect = el.getBoundingClientRect();
  const tooltip = document.createElement("div");
  tooltip.className = TOOLTIP_CLASS;
  tooltip.textContent = text;
  tooltip.style.top = `${window.scrollY + rect.top - 40}px`;
  tooltip.style.left = `${window.scrollX + rect.left}px`;
  document.body.appendChild(tooltip);

  // Also highlight the element
  el.classList.add(HIGHLIGHT_CLASS);

  setTimeout(() => {
    tooltip.remove();
    el.classList.remove(HIGHLIGHT_CLASS);
  }, durationMs);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseKonciergeToolsConfig {
  /** React Router's navigate function for SPA navigation */
  navigate: (to: string) => void;
  /** Optional notification callback (e.g. toast). Called when a tool executes. */
  onNotify?: (message: string) => void;
}

export interface UseKonciergeToolsReturn {
  /** Execute a single tool call */
  executeTool: (toolCall: KonciergeToolCall) => void;
  /** Execute an array of tool calls in sequence */
  executeTools: (toolCalls: KonciergeToolCall[]) => void;
  /**
   * Handle a tool_use SSE event from the adapter.
   * Maps the server event shape to KonciergeToolCall and executes it.
   * Pass this as `onToolCall` to KonciergeRuntimeProvider.
   */
  handleToolUseEvent: (event: KonciergeToolUseEvent) => void;
}

/** Route labels for toast messages */
const ROUTE_LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/projects": "Projects",
  "/flows": "AI Flows",
  "/apps": "Apps",
  "/settings": "Settings",
  "/pipelines": "Pipelines",
  "/deployments": "Deployments",
};

function labelForRoute(route: string): string {
  return ROUTE_LABELS[route] ?? route;
}

export function useKonciergeTools(
  config: UseKonciergeToolsConfig,
): UseKonciergeToolsReturn {
  const navigateRef = useRef(config.navigate);
  navigateRef.current = config.navigate;
  const onNotifyRef = useRef(config.onNotify);
  onNotifyRef.current = config.onNotify;

  const executeTool = useCallback((tc: KonciergeToolCall) => {
    try {
      switch (tc.tool) {
        case "navigate":
          navigateRef.current(tc.args.route);
          onNotifyRef.current?.(`Navigating to ${labelForRoute(tc.args.route)}...`);
          break;

        case "highlight":
          highlightElement(
            tc.args.selector,
            tc.args.durationMs ?? DEFAULT_HIGHLIGHT_MS,
          );
          break;

        case "tooltip":
          showTooltip(
            tc.args.selector,
            tc.args.text,
            tc.args.durationMs ?? DEFAULT_HIGHLIGHT_MS,
          );
          break;

        case "showSection":
          highlightElement(tc.args.selector, DEFAULT_HIGHLIGHT_MS);
          break;
      }
    } catch (err) {
      // Log but don't throw — the chat panel must never crash from a failed tool call.
      console.error("[Koncierge] Tool execution failed:", tc.tool, err);
    }
  }, []);

  const executeTools = useCallback(
    (toolCalls: KonciergeToolCall[]) => {
      for (const tc of toolCalls) {
        executeTool(tc);
      }
    },
    [executeTool],
  );

  /**
   * Bridge between the SSE tool_use event shape and the KonciergeToolCall shape.
   * The server emits {name, input} while KonciergeToolCall uses {tool, args}.
   */
  const handleToolUseEvent = useCallback(
    (event: KonciergeToolUseEvent) => {
      const tc = {
        tool: event.name,
        args: event.input,
      } as KonciergeToolCall;
      executeTool(tc);
    },
    [executeTool],
  );

  return { executeTool, executeTools, handleToolUseEvent };
}
