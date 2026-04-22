import { describe, it, expect, vi, afterEach } from "vitest";
import { checkMemoryPressure } from "./memory-utils";

describe("memory-utils", () => {
  describe("checkMemoryPressure", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    // The default heap limit is 4096 MB.
    const HEAP_LIMIT = 4096 * 1024 * 1024; // 4096 MB in bytes

    it("should return false when memory usage is below the default threshold (80%)", () => {
      vi.spyOn(process, "memoryUsage").mockReturnValue({
        heapUsed: Math.floor(HEAP_LIMIT * 0.7), // 70% used
        heapTotal: HEAP_LIMIT,
        external: 0,
        rss: HEAP_LIMIT,
        arrayBuffers: 0,
      });

      expect(checkMemoryPressure()).toBe(false);
    });

    it("should return true when memory usage is exactly at the default threshold (80%)", () => {
      vi.spyOn(process, "memoryUsage").mockReturnValue({
        heapUsed: Math.floor(HEAP_LIMIT * 0.8), // 80% used
        heapTotal: HEAP_LIMIT,
        external: 0,
        rss: HEAP_LIMIT,
        arrayBuffers: 0,
      });

      expect(checkMemoryPressure()).toBe(true);
    });

    it("should return true when memory usage is above the default threshold (80%)", () => {
      vi.spyOn(process, "memoryUsage").mockReturnValue({
        heapUsed: Math.floor(HEAP_LIMIT * 0.9), // 90% used
        heapTotal: HEAP_LIMIT,
        external: 0,
        rss: HEAP_LIMIT,
        arrayBuffers: 0,
      });

      expect(checkMemoryPressure()).toBe(true);
    });

    it("should return false when memory usage is below a custom threshold", () => {
      vi.spyOn(process, "memoryUsage").mockReturnValue({
        heapUsed: Math.floor(HEAP_LIMIT * 0.85), // 85% used
        heapTotal: HEAP_LIMIT,
        external: 0,
        rss: HEAP_LIMIT,
        arrayBuffers: 0,
      });

      expect(checkMemoryPressure(90)).toBe(false);
    });

    it("should return true when memory usage is at or above a custom threshold", () => {
      vi.spyOn(process, "memoryUsage").mockReturnValue({
        heapUsed: Math.floor(HEAP_LIMIT * 0.6), // 60% used
        heapTotal: HEAP_LIMIT,
        external: 0,
        rss: HEAP_LIMIT,
        arrayBuffers: 0,
      });

      expect(checkMemoryPressure(50)).toBe(true);
      expect(checkMemoryPressure(60)).toBe(true);
    });
  });
});
