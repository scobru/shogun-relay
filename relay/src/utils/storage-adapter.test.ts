import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import { FsStorageAdapter, MinioStorageAdapter } from "./storage-adapter";
import fs from "fs";
import { promises as fsPromises } from "fs";
import { S3Client, ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

// Mock env-config
vi.mock("../config/env-config", () => ({
  driveConfig: {
    dataDir: "/tmp/test-drive",
    storageType: "minio",
    minio: {
      endpoint: "http://localhost:9000",
      accessKey: "minioadmin",
      secretKey: "minioadmin",
      bucket: "test-bucket",
      region: "us-east-1"
    }
  },
}));

vi.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: vi.fn(() => ({
      send: vi.fn()
    })),
    ListObjectsV2Command: vi.fn((input) => ({ type: 'ListObjectsV2', input })),
    CopyObjectCommand: vi.fn((input) => ({ type: 'CopyObject', input })),
    DeleteObjectCommand: vi.fn((input) => ({ type: 'DeleteObject', input })),
    HeadBucketCommand: vi.fn((input) => ({ type: 'HeadBucket', input })),
    CreateBucketCommand: vi.fn((input) => ({ type: 'CreateBucket', input }))
  };
});

// Mock logger
vi.mock("./logger", () => ({
  loggers: {
    server: {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

// Mock fs and fs/promises
vi.mock("fs", () => {
  const mockExistsSync = vi.fn();
  const mockMkdirSync = vi.fn();

  return {
    default: {
      existsSync: mockExistsSync,
      mkdirSync: mockMkdirSync,
    },
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    promises: {
      access: vi.fn(),
      stat: vi.fn(),
      readdir: vi.fn(),
      rm: vi.fn(),
      unlink: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
      mkdir: vi.fn(),
      rename: vi.fn(),
    },
  };
});

describe("FsStorageAdapter", () => {
  let adapter: FsStorageAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mocks
    (fs.existsSync as any).mockReturnValue(true);
    (fsPromises.access as any).mockResolvedValue(undefined);

    adapter = new FsStorageAdapter();
  });

  describe("getStorageStats", () => {
    it("should calculate stats correctly for a nested directory structure", async () => {
      // Mock file system structure:
      // /root
      //   - file1.txt (100 bytes)
      //   - file2.txt (200 bytes)
      //   - subdir
      //     - file3.txt (300 bytes)

      // Mock readdir
      (fsPromises.readdir as any).mockImplementation(async (dirPath: string) => {
        if (dirPath === "/tmp/test-drive") {
          return [
            { name: "file1.txt", isDirectory: () => false, isFile: () => true },
            { name: "file2.txt", isDirectory: () => false, isFile: () => true },
            { name: "subdir", isDirectory: () => true, isFile: () => false },
          ];
        } else if (dirPath === path.join("/tmp/test-drive", "subdir")) {
          return [{ name: "file3.txt", isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });

      // Mock stat
      (fsPromises.stat as any).mockImplementation(async (filePath: string) => {
        const name = path.basename(filePath);
        if (name === "file1.txt") return { size: 100 };
        if (name === "file2.txt") return { size: 200 };
        if (name === "file3.txt") return { size: 300 };
        return { size: 0 };
      });

      const stats = await adapter.getStorageStats();

      expect(stats.totalBytes).toBe(600);
      expect(stats.fileCount).toBe(3);
      expect(stats.dirCount).toBe(1);
    });

    it("should handle large number of files", async () => {
      // This test is mainly to ensure no stack overflow or errors with Promise.all
      // We simulate a directory with 1000 files

      const files = Array.from({ length: 1000 }, (_, i) => ({
        name: `file${i}.txt`,
        isDirectory: () => false,
        isFile: () => true,
      }));

      (fsPromises.readdir as any).mockResolvedValue(files);
      (fsPromises.stat as any).mockResolvedValue({ size: 10 }); // 10 bytes each

      const stats = await adapter.getStorageStats();

      expect(stats.totalBytes).toBe(10000);
      expect(stats.fileCount).toBe(1000);
    });

    it("should handle empty directory", async () => {
      (fsPromises.readdir as any).mockResolvedValue([]);

      const stats = await adapter.getStorageStats();

      expect(stats.totalBytes).toBe(0);
      expect(stats.fileCount).toBe(0);
      expect(stats.dirCount).toBe(0);
    });
  });
});

describe("MinioStorageAdapter", () => {
  let adapter: MinioStorageAdapter;
  let mockSend: any;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new MinioStorageAdapter();
    // Bypass background bucket creation in tests for simpler mocking
    (adapter as any).initialized = true;
    mockSend = (adapter as any).client.send;
  });

  describe("renameItem", () => {
    it("should rename a file (single object copy and delete)", async () => {
      // Mock list objects to return empty (indicating it's a file, not a prefix/directory)
      mockSend.mockResolvedValueOnce({ Contents: [] }); // First send is ListObjectsV2Command

      await adapter.renameItem("old-file.txt", "new-file.txt");

      // Verify copy was called for file
      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
        type: 'CopyObject',
        input: expect.objectContaining({
          Bucket: "test-bucket",
          CopySource: "test-bucket/old-file.txt",
          Key: "new-file.txt"
        })
      }));

      // Verify delete was called for old file
      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
        type: 'DeleteObject',
        input: expect.objectContaining({
          Bucket: "test-bucket",
          Key: "old-file.txt"
        })
      }));
    });

    it("should recursively rename a directory", async () => {
      // Mock list objects to return items (indicating it's a directory)
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "old-dir/file1.txt" }]
      }); // For the check

      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "old-dir/file1.txt" }, { Key: "old-dir/file2.txt" }]
      }); // For getting all objects

      await adapter.renameItem("old-dir", "new-dir");

      // Verify copies
      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
        type: 'CopyObject',
        input: expect.objectContaining({
          CopySource: "test-bucket/old-dir/file1.txt",
          Key: "new-dir/file1.txt"
        })
      }));

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
        type: 'CopyObject',
        input: expect.objectContaining({
          CopySource: "test-bucket/old-dir/file2.txt",
          Key: "new-dir/file2.txt"
        })
      }));

      // Verify deletes
      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
        type: 'DeleteObject',
        input: expect.objectContaining({
          Key: "old-dir/file1.txt"
        })
      }));

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
        type: 'DeleteObject',
        input: expect.objectContaining({
          Key: "old-dir/file2.txt"
        })
      }));
    });
  });

  describe("moveItem", () => {
    it("should move a file", async () => {
      mockSend.mockResolvedValueOnce({ Contents: [] }); // File check

      await adapter.moveItem("source.txt", "dest/source.txt");

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
        type: 'CopyObject',
        input: expect.objectContaining({
          CopySource: "test-bucket/source.txt",
          Key: "dest/source.txt"
        })
      }));

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
        type: 'DeleteObject',
        input: expect.objectContaining({
          Key: "source.txt"
        })
      }));
    });

    it("should recursively move a directory", async () => {
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "src-dir/file.txt" }]
      });

      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "src-dir/file.txt" }, { Key: "src-dir/sub/file2.txt" }]
      });

      await adapter.moveItem("src-dir", "dest-dir");

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
        type: 'CopyObject',
        input: expect.objectContaining({
          CopySource: "test-bucket/src-dir/file.txt",
          Key: "dest-dir/file.txt"
        })
      }));

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
        type: 'CopyObject',
        input: expect.objectContaining({
          CopySource: "test-bucket/src-dir/sub/file2.txt",
          Key: "dest-dir/sub/file2.txt"
        })
      }));

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
        type: 'DeleteObject',
        input: expect.objectContaining({
          Key: "src-dir/file.txt"
        })
      }));

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
        type: 'DeleteObject',
        input: expect.objectContaining({
          Key: "src-dir/sub/file2.txt"
        })
      }));
    });
  });
});
