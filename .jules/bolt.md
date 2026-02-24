## 2025-05-27 - Parallelizing I/O in Storage Adapter
**Learning:** `FsStorageAdapter.getStorageStats` was using a sequential `for...of` loop for recursive directory traversal, which is an anti-pattern for I/O-bound operations. Even though `listDirectory` was optimized, this method was missed.
**Action:** Audit all recursive file system operations for sequential loops and refactor to use `Promise.all` to leverage Node.js non-blocking I/O.
