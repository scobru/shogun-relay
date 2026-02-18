# Sentinel Journal

## 2025-02-12 - Timing Attack in Admin Auth
**Vulnerability:** Direct string comparison (`===`) was used for checking admin tokens against the configuration.
**Learning:** Even in high-level languages, timing attacks are possible when comparing secrets. This was missed because the "secure" logic was implemented in one place but not reused consistently.
**Prevention:** Always use `crypto.timingSafeEqual` (or a wrapper like `secureCompare`) for comparing secrets. Centralize auth logic to avoid inconsistent implementation.

## 2025-02-12 - Timing Attack in API Key Validation
**Vulnerability:** API key hashes were compared using direct string equality (`===`) in `ApiKeysManager`, exposing a timing attack vulnerability.
**Learning:** Security utilities like `secureCompare` must be used for ALL secret comparisons, not just passwords. The presence of a "hash" doesn't automatically make `===` safe if the hash is derived from user input and compared to a stored secret.
**Prevention:** Audit all equality checks involving secrets or hashes of secrets. Enforce usage of `secureCompare`.

## 2025-02-13 - Widespread Insecure Admin Token Comparison
**Vulnerability:** Direct string comparison (`===`) was used for validating admin tokens in multiple route handlers (`uploads.ts`, `x402.ts`, `network.ts`, `chat.ts`), exposing the application to timing attacks.
**Learning:** Security fixes must be applied systematically. A helper function `validateAdminToken` was created to centralize and enforce secure comparison, preventing future regressions and code duplication.
**Prevention:** Use `validateAdminToken` from `relay/src/utils/auth-utils.ts` for all admin authentication checks. Avoid ad-hoc comparisons of sensitive tokens.

## 2025-05-15 - Unprotected Debug Endpoints
**Vulnerability:** Critical debug endpoints (including data reset and sensitive data exposure) were mounted publicly without authentication.
**Learning:** The `debug.ts` router was imported and used in `index.ts` without any middleware applied at the mount point or within the router file itself, despite having sensitive operations like `reset`.
**Prevention:** Always apply authentication middleware at the router level (using `router.use()`) for any router file containing administrative or debug functions, or verify that the mounting point in `index.ts` applies the middleware.

## 2025-05-16 - Unauthenticated System Routes & SSRF
**Vulnerability:** Critical system endpoints (`/rpc/execute`, `/node/*`, `/logs`, etc.) were exposed without authentication, allowing unauthenticated SSRF, arbitrary GunDB data manipulation, and sensitive information disclosure.
**Learning:** Mixing public and private routes in the same router file (`system.ts`) without careful middleware application can lead to critical exposure. The `/rpc/execute` endpoint was particularly dangerous as it allowed unauthenticated users to make arbitrary POST requests from the server.
**Prevention:** Separate public and private routes into different router files or apply middleware explicitly to sensitive route groups. Always audit new endpoints for authentication requirements, especially those performing external requests (SSRF risk) or database operations.

## 2025-05-18 - Unauthenticated Delete Endpoint via Fake Middleware
**Vulnerability:** A critical DELETE endpoint (`/user-uploads/:identifier/:hash`) was exposed due to a "fake" middleware `(req, res, next) => { next(); }` being used as a placeholder.
**Learning:** Developers sometimes use placeholder functions during development and forget to replace them with real security controls. This pattern of explicitly defining a middleware that does nothing is a huge red flag.
**Prevention:** Audit codebase for empty middleware functions or "TODO" comments in route definitions. Use specific linting rules or code reviews to catch no-op middlewares in security-critical paths.
