import { describe, it, expect, vi, beforeEach } from "vitest";
import { uploadFilesHandler } from "../routes/drive";
import { Request, Response } from "express";

// Mock dependencies
const mockUploadFileAsync = vi.fn();

vi.mock("../utils/drive", () => ({
  driveManager: {
    uploadFileAsync: (...args: any[]) => mockUploadFileAsync(...args),
  },
}));

vi.mock("../utils/logger", () => ({
  loggers: {
    server: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

describe("Drive Upload Performance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should measure upload time for multiple files", async () => {
    // Mock uploadFileAsync to take 50ms per file
    mockUploadFileAsync.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const filesCount = 5;
    const files = Array.from({ length: filesCount }, (_, i) => ({
      fieldname: "files",
      originalname: `file${i}.txt`,
      encoding: "7bit",
      mimetype: "text/plain",
      buffer: Buffer.from("test content"),
      size: 12,
      destination: "",
      filename: `file${i}.txt`,
      path: "",
      stream: null as any,
    }));

    const req = {
      params: { path: "" },
      files: {
        files: files,
      },
    } as unknown as Request;

    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as unknown as Response;

    const start = Date.now();
    await uploadFilesHandler(req, res);
    const end = Date.now();
    const duration = end - start;

    console.log(`Upload duration for ${filesCount} files: ${duration}ms`);

    expect(mockUploadFileAsync).toHaveBeenCalledTimes(filesCount);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: `Successfully uploaded ${filesCount} file(s)`,
      })
    );

    // In sequential mode, it should take at least 50ms * 5 = 250ms
    // In parallel mode, it should take around 50ms + overhead
    // So it should be significantly less than 250ms. Let's say < 150ms.
    expect(duration).toBeLessThan(150);
  });
});
