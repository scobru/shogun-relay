# Bolt's Journal

## 2024-05-24 - Optimized dashboard asset caching
**Learning:** The dashboard SPA was served with `Cache-Control: no-cache, no-store` for all files, preventing browser caching of hashed assets. Vite produces hashed filenames for assets, which are safe to cache indefinitely.
**Action:** Implemented intelligent caching in `express.static`: HTML files get `no-cache`, while other files (hashed assets) get `immutable, max-age=1 year`. This significantly improves load time for repeat visits.

## 2025-02-18 - FsStorageAdapter Blocking
**Learning:** `FsStorageAdapter` was using synchronous `fs.*Sync` methods, causing significant event loop blocking (up to 150ms for 10k files) during file operations.
**Action:** Migrated to `fs/promises` for all operations. This increased the total duration of operations slightly due to overhead but completely eliminated event loop blocking, improving server responsiveness under load.
