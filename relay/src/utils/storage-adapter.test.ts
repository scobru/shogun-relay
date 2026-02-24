import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { FsStorageAdapter } from './storage-adapter';
import fs from 'fs';
import { promises as fsPromises } from 'fs';

// Mock env-config
vi.mock('../config/env-config', () => ({
  driveConfig: {
    dataDir: '/tmp/test-drive',
    storageType: 'fs'
  }
}));

// Mock logger
vi.mock('./logger', () => ({
  loggers: {
    server: {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }
  }
}));

// Mock fs and fs/promises
vi.mock('fs', () => {
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
        }
    };
});

describe('FsStorageAdapter', () => {
    let adapter: FsStorageAdapter;

    beforeEach(() => {
        vi.clearAllMocks();
        // Setup default mocks
        (fs.existsSync as any).mockReturnValue(true);
        (fsPromises.access as any).mockResolvedValue(undefined);

        adapter = new FsStorageAdapter();
    });

    describe('getStorageStats', () => {
        it('should calculate stats correctly for a nested directory structure', async () => {
            // Mock file system structure:
            // /root
            //   - file1.txt (100 bytes)
            //   - file2.txt (200 bytes)
            //   - subdir
            //     - file3.txt (300 bytes)

            // Mock readdir
            (fsPromises.readdir as any).mockImplementation(async (dirPath: string) => {
                if (dirPath === '/tmp/test-drive') {
                    return [
                        { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
                        { name: 'file2.txt', isDirectory: () => false, isFile: () => true },
                        { name: 'subdir', isDirectory: () => true, isFile: () => false },
                    ];
                } else if (dirPath === path.join('/tmp/test-drive', 'subdir')) {
                    return [
                        { name: 'file3.txt', isDirectory: () => false, isFile: () => true },
                    ];
                }
                return [];
            });

            // Mock stat
            (fsPromises.stat as any).mockImplementation(async (filePath: string) => {
                const name = path.basename(filePath);
                if (name === 'file1.txt') return { size: 100 };
                if (name === 'file2.txt') return { size: 200 };
                if (name === 'file3.txt') return { size: 300 };
                return { size: 0 };
            });

            const stats = await adapter.getStorageStats();

            expect(stats.totalBytes).toBe(600);
            expect(stats.fileCount).toBe(3);
            expect(stats.dirCount).toBe(1);
        });

        it('should handle large number of files', async () => {
            // This test is mainly to ensure no stack overflow or errors with Promise.all
            // We simulate a directory with 1000 files

            const files = Array.from({ length: 1000 }, (_, i) => ({
                name: `file${i}.txt`,
                isDirectory: () => false,
                isFile: () => true
            }));

            (fsPromises.readdir as any).mockResolvedValue(files);
            (fsPromises.stat as any).mockResolvedValue({ size: 10 }); // 10 bytes each

            const stats = await adapter.getStorageStats();

            expect(stats.totalBytes).toBe(10000);
            expect(stats.fileCount).toBe(1000);
        });

        it('should handle empty directory', async () => {
             (fsPromises.readdir as any).mockResolvedValue([]);

             const stats = await adapter.getStorageStats();

             expect(stats.totalBytes).toBe(0);
             expect(stats.fileCount).toBe(0);
             expect(stats.dirCount).toBe(0);
        });
    });
});
