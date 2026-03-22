## 2026-03-22 - Async File Existence Checks in Express Routes
**Learning:** Synchronous file system checks (`fs.existsSync`) in `async` Express route handlers block the Node.js event loop, preventing the server from handling other concurrent requests. This is especially problematic in high-traffic endpoints like log retrieval.
**Action:** Replace `fs.existsSync(path)` with `await fs.promises.access(path).then(() => true).catch(() => false)` or similar asynchronous patterns to ensure the event loop remains non-blocking.

## 2024-03-22 - V8 Engine Memory Leak with IPFS Queries
**Learning:** Querying `/api/v0/pin/ls?type=recursive` scales poorly in JSON payload size linearly with the number of IPFS pins. In memory-constrained environments, `JSON.parse` on large payloads causes V8 Out of Memory (OOM) crashes.
**Action:** Replace `pin/ls` with `/api/v0/repo/stat` and extract the `NumObjects` property to achieve an O(1) performance measurement for data sizes and pinned items counts.
