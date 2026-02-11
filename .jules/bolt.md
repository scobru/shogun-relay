# Bolt's Journal

## 2024-05-24 - Optimized dashboard asset caching
**Learning:** The dashboard SPA was served with `Cache-Control: no-cache, no-store` for all files, preventing browser caching of hashed assets. Vite produces hashed filenames for assets, which are safe to cache indefinitely.
**Action:** Implemented intelligent caching in `express.static`: HTML files get `no-cache`, while other files (hashed assets) get `immutable, max-age=1 year`. This significantly improves load time for repeat visits.
