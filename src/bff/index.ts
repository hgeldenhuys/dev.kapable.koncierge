// BFF proxy for Koncierge — import from "@kapable/koncierge/bff"
//
// Usage in the console server:
//
//   import { handleKonciergeProxy, configFromEnv } from "@kapable/koncierge/bff";
//
//   const proxyConfig = configFromEnv();
//
//   Bun.serve({
//     async fetch(req) {
//       const url = new URL(req.url);
//       if (req.method === "POST" && url.pathname === "/api/koncierge/message") {
//         const sessionToken = await getSessionToken(req);
//         return handleKonciergeProxy(req, proxyConfig, sessionToken);
//       }
//     }
//   });

export {
  handleKonciergeProxy,
  proxyKonciergeMessage,
  configFromEnv,
} from "./proxy";

export type { BffProxyConfig, ProxyResult } from "./proxy";

export {
  generateSessionToken,
  generateSessionTokenFromEnv,
} from "./session-token";

export {
  extractKonciergeToken,
  extractKonciergeTokenFromEnv,
} from "./extract-user-token";

export type { AuthIdentity } from "./extract-user-token";

export {
  createKonciergeHandler,
  createKonciergeRoute,
} from "./api.koncierge.message";

export type {
  RequireAuth,
  KonciergeRouteOptions,
} from "./api.koncierge.message";
