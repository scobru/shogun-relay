## 2025-03-21 - Read Large Logs Asynchronously Backwards
**Learning:** Using `fs.readFileSync` for large log files blocks the event loop and loads the entire file into memory, causing severe performance issues.
**Action:** When needing to read the last N lines of a large file, use `fs.promises.open` and read it backwards in chunks without loading the entire file into memory to achieve massive performance improvements (100x+).
