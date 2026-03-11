## 2025-05-27 - Parallelizing I/O in Storage Adapter
**Learning:** `FsStorageAdapter.getStorageStats` was using a sequential `for...of` loop for recursive directory traversal, which is an anti-pattern for I/O-bound operations. Even though `listDirectory` was optimized, this method was missed.
**Action:** Audit all recursive file system operations for sequential loops and refactor to use `Promise.all` to leverage Node.js non-blocking I/O.

## 2025-05-27 - Parallelizing Network Requests in Frontend
**Learning:** Even if the backend storage adapter correctly handles I/O concurrently, sequential network requests from the frontend (e.g. `for (const file of files) await fetch(...)` for uploads) become a severe bottleneck for large operations like directory uploads.
**Action:** Use chunked `Promise.all` (e.g., chunks of 5) for multi-file operations in the frontend to parallelize network transfers without exceeding browser connection limits or overwhelming the backend server.
