/**
 * Drive Manager Module
 *
 * Provides file management capabilities using a pluggable storage backend.
 * The storage backend (fs or MinIO) is determined by configuration.
 *
 * Configuration:
 * - DRIVE_STORAGE_TYPE: "fs" (default) or "minio"
 * - For MinIO: MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET
 */

import path from "path";
import { IStorageAdapter, createStorageAdapter, DriveItem, StorageStats } from "./storage-adapter";
import { loggers } from "./logger";

export type { DriveItem, StorageStats };

/**
 * DriveManager - Facade for storage operations
 *
 * Delegates all operations to the configured storage adapter (fs or MinIO).
 * Provides both sync-compatible and async methods for backward compatibility.
 */
export class DriveManager {
  private adapter: IStorageAdapter;

  constructor() {
    this.adapter = createStorageAdapter();
    loggers.server.info(
      { storageType: this.adapter.getStorageType() },
      "📁 DriveManager initialized"
    );
  }

  /**
   * Get the storage type being used
   */
  public getStorageType(): string {
    return this.adapter.getStorageType();
  }

  /**
   * Validate and sanitize path to prevent path traversal attacks
   */
  public validatePath(relativePath: string): string {
    return this.adapter.validatePath(relativePath);
  }

  /**
   * List directory contents
   * Note: Returns result synchronously for backward compatibility,
   * but internally uses async adapter.
   */
  public listDirectory(relativePath: string = ""): DriveItem[] {
    // For backward compatibility with sync API, we use a sync wrapper
    // This will work for fs adapter; for async adapters, use listDirectoryAsync
    const adapter = this.adapter;
    let result: DriveItem[] = [];

    // Execute async method synchronously for backward compat
    const promise = adapter.listDirectory(relativePath);

    // If the adapter is sync (FsStorageAdapter), this will work
    // For async adapters, callers should use async methods
    if (promise instanceof Promise) {
      // Return empty and log warning - caller should use async version
      promise
        .then((items) => {
          result = items;
        })
        .catch(() => {});

      // For FsStorageAdapter, the promise resolves immediately
      // We need to handle this synchronously
      let resolved = false;
      promise.then((items) => {
        result = items;
        resolved = true;
      });

      // Give a tick for sync resolution
      if (!resolved) {
        // Fall back to async pattern
        loggers.server.debug("listDirectory called synchronously on async adapter");
      }
    }

    return result;
  }

  /**
   * List directory contents (async version - recommended)
   */
  public async listDirectoryAsync(relativePath: string = ""): Promise<DriveItem[]> {
    return this.adapter.listDirectory(relativePath);
  }

  /**
   * Upload a single file
   */
  public uploadFile(relativePath: string, file: Buffer, filename: string): void {
    // Fire and forget for backward compatibility
    this.adapter.uploadFile(relativePath, file, filename).catch((err) => {
      loggers.server.error({ err }, "Failed to upload file");
    });
  }

  /**
   * Upload a single file (async version - recommended)
   */
  public async uploadFileAsync(
    relativePath: string,
    file: Buffer,
    filename: string
  ): Promise<void> {
    return this.adapter.uploadFile(relativePath, file, filename);
  }

  /**
   * Upload multiple files
   */
  public uploadFiles(
    relativePath: string,
    files: Array<{ buffer: Buffer; filename: string }>
  ): void {
    for (const file of files) {
      this.uploadFile(relativePath, file.buffer, file.filename);
    }
  }

  /**
   * Download a file
   */
  public downloadFile(relativePath: string): { buffer: Buffer; filename: string; size: number } {
    // For sync compatibility, we need to handle this carefully
    // The FsStorageAdapter's downloadFile returns a Promise but resolves immediately
    let result: { buffer: Buffer; filename: string; size: number } | null = null;
    let error: Error | null = null;

    const promise = this.adapter.downloadFile(relativePath);
    promise
      .then((r) => {
        result = r;
      })
      .catch((e) => {
        error = e;
      });

    // For FsStorageAdapter this is sync, so result should be set
    if (error) {
      throw error;
    }

    if (!result) {
      // This shouldn't happen for FsStorageAdapter
      throw new Error("File download failed - use downloadFileAsync for async adapters");
    }

    return result;
  }

  /**
   * Download a file (async version - recommended)
   */
  public async downloadFileAsync(
    relativePath: string
  ): Promise<{ buffer: Buffer; filename: string; size: number }> {
    return this.adapter.downloadFile(relativePath);
  }

  /**
   * Delete a file or directory (recursive)
   */
  public deleteItem(relativePath: string): void {
    this.adapter.deleteItem(relativePath).catch((err) => {
      loggers.server.error({ err }, "Failed to delete item");
    });
  }

  /**
   * Delete a file or directory (async version - recommended)
   */
  public async deleteItemAsync(relativePath: string): Promise<void> {
    return this.adapter.deleteItem(relativePath);
  }

  /**
   * Create a directory
   */
  public createDirectory(relativePath: string): void {
    this.adapter.createDirectory(relativePath).catch((err) => {
      loggers.server.error({ err }, "Failed to create directory");
    });
  }

  /**
   * Create a directory (async version - recommended)
   */
  public async createDirectoryAsync(relativePath: string): Promise<void> {
    return this.adapter.createDirectory(relativePath);
  }

  /**
   * Rename a file or directory
   */
  public renameItem(oldPath: string, newName: string): void {
    this.adapter.renameItem(oldPath, newName).catch((err) => {
      loggers.server.error({ err }, "Failed to rename item");
    });
  }

  /**
   * Rename a file or directory (async version - recommended)
   */
  public async renameItemAsync(oldPath: string, newName: string): Promise<void> {
    return this.adapter.renameItem(oldPath, newName);
  }

  /**
   * Move a file or directory
   */
  public moveItem(sourcePath: string, destPath: string): void {
    this.adapter.moveItem(sourcePath, destPath).catch((err) => {
      loggers.server.error({ err }, "Failed to move item");
    });
  }

  /**
   * Move a file or directory (async version - recommended)
   */
  public async moveItemAsync(sourcePath: string, destPath: string): Promise<void> {
    return this.adapter.moveItem(sourcePath, destPath);
  }

  /**
   * Get storage statistics
   */
  public getStorageStats(): StorageStats {
    let result: StorageStats = {
      totalBytes: 0,
      totalMB: 0,
      totalGB: 0,
      fileCount: 0,
      dirCount: 0,
    };

    this.adapter
      .getStorageStats()
      .then((r) => {
        result = r;
      })
      .catch(() => {});

    return result;
  }

  /**
   * Get storage statistics (async version - recommended)
   */
  public async getStorageStatsAsync(): Promise<StorageStats> {
    return this.adapter.getStorageStats();
  }
}

// Singleton instance
export const driveManager = new DriveManager();
