// Koncierge Chat Panel — UI components for embedding in the console
//
// Usage in the console app:
//
//   import {
//     KonciergeRuntimeProvider,
//     KonciergePanel,
//   } from "@kapable/koncierge/ui";
//
//   <KonciergeRuntimeProvider config={{ endpoint: "/api/koncierge/message" }}>
//     <KonciergePanel />
//   </KonciergeRuntimeProvider>

export { KonciergeRuntimeProvider } from "./KonciergeRuntimeProvider";
export type { KonciergeRuntimeProviderProps } from "./KonciergeRuntimeProvider";

export { KonciergePanel } from "./KonciergePanel";
export type { KonciergePanelProps } from "./KonciergePanel";

export { createKonciergeAdapter } from "./koncierge-adapter";
export type { KonciergeAdapterConfig, KonciergeToolUseEvent } from "./koncierge-adapter";

export { parseSSE } from "./parse-sse";

export { getRouteFromLocation, getPageTitleFromDocument, useReactRouterRoute } from "./route-context";
export type { RouteContextCallbacks } from "./route-context";

export { parseToolCalls } from "./tool-calls";
export type {
  KonciergeToolCall,
  NavigateToolCall,
  HighlightToolCall,
  TooltipToolCall,
  ShowSectionToolCall,
  ParsedMessage,
} from "./tool-calls";

export { useKonciergeTools } from "./useKonciergeTools";
export type { UseKonciergeToolsConfig, UseKonciergeToolsReturn } from "./useKonciergeTools";
