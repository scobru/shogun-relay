## 2025-02-12 - Timing Attack in Admin Auth
**Vulnerability:** Direct string comparison (`===`) was used for checking admin tokens against the configuration.
**Learning:** Even in high-level languages, timing attacks are possible when comparing secrets. This was missed because the "secure" logic was implemented in one place but not reused consistently.
**Prevention:** Always use `crypto.timingSafeEqual` (or a wrapper like `secureCompare`) for comparing secrets. Centralize auth logic to avoid inconsistent implementation.

## 2025-02-12 - Timing Attack in API Key Validation
**Vulnerability:** API key hashes were compared using direct string equality (`===`) in `ApiKeysManager`, exposing a timing attack vulnerability.
**Learning:** Security utilities like `secureCompare` must be used for ALL secret comparisons, not just passwords. The presence of a "hash" doesn't automatically make `===` safe if the hash is derived from user input and compared to a stored secret.
**Prevention:** Audit all equality checks involving secrets or hashes of secrets. Enforce usage of `secureCompare`.
