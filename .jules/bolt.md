## 2024-03-22 - Node.js Express Event Loop Blocking
**Learning:** Using synchronous `fs` methods (`fs.existsSync`, `fs.readdirSync`, `fs.readFileSync`) within Express route handlers or global heartbeat functions blocks the main Node.js Event Loop, completely destroying concurrency and performance for a relay.
**Action:** Always refactor blocking `fs.*Sync` operations to their `fs.promises` equivalents inside `async` route handler wrappers. Specifically, use `await fs.promises.access(path).then(()=>true).catch(()=>false)` as a replacement for `fs.existsSync`.

## 2024-03-22 - V8 Engine Memory Leak with IPFS Queries
**Learning:** Querying `/api/v0/pin/ls?type=recursive` scales poorly in JSON payload size linearly with the number of IPFS pins. In memory-constrained environments, `JSON.parse` on large payloads causes V8 Out of Memory (OOM) crashes.
**Action:** Replace `pin/ls` with `/api/v0/repo/stat` and extract the `NumObjects` property to achieve an O(1) performance measurement for data sizes and pinned items counts.
