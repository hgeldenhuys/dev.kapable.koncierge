import { useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { ToolCall } from "./parseToolCalls";

/**
 * Minimal driver.js interface — only the methods we actually use.
 * The consumer passes in a real driver.js Driver instance; we don't
 * import the library ourselves (it's a peer dep of the console app).
 */
export interface DriverLike {
  highlight(config: {
    element: string;
    popover?: { title?: string; description?: string };
  }): void;
  destroy(): void;
}

export interface UseToolCallExecutorOptions {
  /**
   * A driver.js Driver instance for highlight/tooltip rendering.
   * If not provided, highlight and tooltip tool calls are no-ops.
   */
  driver?: DriverLike | null;

  /**
   * Optional callback fired after each tool call is executed.
   * Useful for logging or analytics.
   */
  onExecuted?: (toolCall: ToolCall) => void;
}

export interface ToolCallExecutor {
  /**
   * Execute an array of tool calls. Navigations happen immediately;
   * highlights/tooltips are scheduled with a short delay so the
   * target page has time to render.
   */
  execute: (toolCalls: ToolCall[]) => void;
}

/**
 * React hook that returns a function to execute Koncierge tool calls.
 *
 * - `navigate` → calls `useNavigate()` to change routes
 * - `highlight` → calls `driver.highlight()` on a CSS selector
 * - `tooltip` → calls `driver.highlight()` with a popover message
 * - `showSection` → scrolls the matching element into view
 */
export function useToolCallExecutor(
  options: UseToolCallExecutorOptions = {},
): ToolCallExecutor {
  const navigate = useNavigate();
  const driverRef = useRef(options.driver);
  driverRef.current = options.driver;

  const onExecutedRef = useRef(options.onExecuted);
  onExecutedRef.current = options.onExecuted;

  const execute = useCallback(
    (toolCalls: ToolCall[]) => {
      // Separate navigation calls (must run first) from UI calls
      const navCalls: ToolCall[] = [];
      const uiCalls: ToolCall[] = [];

      for (const tc of toolCalls) {
        if (tc.tool === "navigate") {
          navCalls.push(tc);
        } else {
          uiCalls.push(tc);
        }
      }

      // Execute navigation immediately (only the last one wins if multiple)
      if (navCalls.length > 0) {
        const lastNav = navCalls[navCalls.length - 1];
        if (lastNav.tool === "navigate") {
          navigate(lastNav.route);
          onExecutedRef.current?.(lastNav);
        }
      }

      // Schedule UI calls with a delay so the navigated page can render
      if (uiCalls.length > 0) {
        const delay = navCalls.length > 0 ? 500 : 0;

        setTimeout(() => {
          for (const tc of uiCalls) {
            executeUiCall(tc, driverRef.current);
            onExecutedRef.current?.(tc);
          }
        }, delay);
      }
    },
    [navigate],
  );

  return { execute };
}

/**
 * Execute a single UI-related tool call (highlight, tooltip, showSection).
 */
function executeUiCall(
  tc: ToolCall,
  driver: DriverLike | null | undefined,
): void {
  switch (tc.tool) {
    case "highlight": {
      if (!driver) return;
      // Destroy any existing highlight before showing new one
      driver.destroy();
      driver.highlight({
        element: tc.selector,
        popover: tc.message ? { description: tc.message } : undefined,
      });
      break;
    }

    case "tooltip": {
      if (!driver) return;
      driver.destroy();
      driver.highlight({
        element: tc.selector,
        popover: { description: tc.message },
      });
      break;
    }

    case "showSection": {
      if (typeof document === "undefined") return;
      const el = document.querySelector(`[data-section="${tc.section}"]`)
        ?? document.getElementById(tc.section);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      break;
    }
  }
}

export { executeUiCall };
