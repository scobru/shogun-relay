## 2026-03-22 - Async File Existence Checks in Express Routes
**Learning:** Synchronous file system checks (`fs.existsSync`) in `async` Express route handlers block the Node.js event loop, preventing the server from handling other concurrent requests. This is especially problematic in high-traffic endpoints like log retrieval.
**Action:** Replace `fs.existsSync(path)` with `await fs.promises.access(path).then(() => true).catch(() => false)` or similar asynchronous patterns to ensure the event loop remains non-blocking.

## 2024-03-22 - V8 Engine Memory Leak with IPFS Queries
**Learning:** Querying `/api/v0/pin/ls?type=recursive` scales poorly in JSON payload size linearly with the number of IPFS pins. In memory-constrained environments, `JSON.parse` on large payloads causes V8 Out of Memory (OOM) crashes.
**Action:** Replace `pin/ls` with `/api/v0/repo/stat` and extract the `NumObjects` property to achieve an O(1) performance measurement for data sizes and pinned items counts.

## 2024-03-24 - Optimizing GunDB Record Fetching
**Learning:** Fetching an entire list of user uploads from GunDB using `.map()` just to `.find()` a single known hash is highly inefficient (O(N) network/memory cost) and unnecessarily slow as data grows.
**Action:** Always fetch specific items from GunDB directly by chaining `.get(key)` and using `.once()` to retrieve the single node in O(1) time. Include a short timeout as a fallback mechanism to prevent hanging on missing data.

## 2026-03-28 - Optimized Recursive Directory Traversal
**Learning:** Sequential processing of directory entries in a recursive `walkDir` function using `for...of` with `await` leads to high cumulative I/O latency as each `stat` or recursive call blocks the next.
**Action:** Use `Promise.all` with `Array.prototype.map` to initiate file system operations concurrently. This significantly reduces total execution time, especially for directories with many small files.
