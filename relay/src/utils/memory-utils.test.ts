import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getMemoryUsage, triggerGC, checkMemoryPressure } from "./memory-utils";

describe("memory-utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getMemoryUsage", () => {
    it("should return memory stats in MB with calculated heap usage percentage", () => {
      // 1 MB = 1024 * 1024 bytes = 1048576 bytes
      const MB = 1024 * 1024;

      const mockMemoryUsage = vi.spyOn(process, "memoryUsage").mockReturnValue({
        heapUsed: 500 * MB,
        heapTotal: 1000 * MB,
        external: 10 * MB,
        rss: 1200 * MB,
        arrayBuffers: 5 * MB,
      });

      const stats = getMemoryUsage();

      expect(mockMemoryUsage).toHaveBeenCalledTimes(1);

      expect(stats.heapUsedMB).toBe(500);
      expect(stats.heapTotalMB).toBe(1000);
      expect(stats.externalMB).toBe(10);
      expect(stats.rssMemoryMB).toBe(1200);

      // Default heap limit is 4096MB
      // 500 / 4096 = 0.12207... -> ~12%
      expect(stats.heapUsagePercent).toBe(12);
    });

    it("should round the MB values correctly", () => {
      const MB = 1024 * 1024;

      vi.spyOn(process, "memoryUsage").mockReturnValue({
        heapUsed: 500.6 * MB,
        heapTotal: 1000.4 * MB,
        external: 10.5 * MB,
        rss: 1200.2 * MB,
        arrayBuffers: 5 * MB,
      });

      const stats = getMemoryUsage();

      // Math.round is used
      expect(stats.heapUsedMB).toBe(501);
      expect(stats.heapTotalMB).toBe(1000);
      expect(stats.externalMB).toBe(11);
      expect(stats.rssMemoryMB).toBe(1200);
    });
  });

  describe("checkMemoryPressure", () => {
    it("should return true when heap usage percent is greater than or equal to the threshold", () => {
      const MB = 1024 * 1024;

      // 4000 MB out of 4096 MB is ~98%
      vi.spyOn(process, "memoryUsage").mockReturnValue({
        heapUsed: 4000 * MB,
        heapTotal: 4000 * MB,
        external: 0,
        rss: 4000 * MB,
        arrayBuffers: 0,
      });

      expect(checkMemoryPressure(80)).toBe(true);
    });

    it("should return false when heap usage percent is less than the threshold", () => {
      const MB = 1024 * 1024;

      // 500 MB out of 4096 MB is ~12%
      vi.spyOn(process, "memoryUsage").mockReturnValue({
        heapUsed: 500 * MB,
        heapTotal: 1000 * MB,
        external: 0,
        rss: 1000 * MB,
        arrayBuffers: 0,
      });

      expect(checkMemoryPressure(80)).toBe(false);
    });
  });

  describe("triggerGC", () => {
    it("should call global.gc and return true if global.gc is defined", () => {
      const originalGc = global.gc;
      const gcMock = vi.fn();
      global.gc = gcMock;

      const result = triggerGC();

      expect(gcMock).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);

      global.gc = originalGc;
    });

    it("should return false if global.gc is not defined", () => {
      const originalGc = global.gc;
      global.gc = undefined;

      const result = triggerGC();

      expect(result).toBe(false);

      global.gc = originalGc;
    });

    it("should return false if global.gc throws an error", () => {
      const originalGc = global.gc;
      global.gc = vi.fn().mockImplementation(() => {
        throw new Error("GC error");
      });

      const result = triggerGC();

      expect(result).toBe(false);

      global.gc = originalGc;
    });
  });
});
