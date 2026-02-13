## 2025-02-12 - Timing Attack in Admin Auth
**Vulnerability:** Direct string comparison (`===`) was used for checking admin tokens against the configuration.
**Learning:** Even in high-level languages, timing attacks are possible when comparing secrets. This was missed because the "secure" logic was implemented in one place but not reused consistently.
**Prevention:** Always use `crypto.timingSafeEqual` (or a wrapper like `secureCompare`) for comparing secrets. Centralize auth logic to avoid inconsistent implementation.
