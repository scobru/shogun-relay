import path from "path";
import fs from "fs";
import { driveConfig } from "../config/env-config";
import { loggers } from "./logger";

export interface DriveItem {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modified: number;
}

export interface StorageStats {
  totalBytes: number;
  totalMB: number;
  totalGB: number;
  fileCount: number;
  dirCount: number;
}

export class DriveManager {
  private dataDir: string;

  constructor() {
    this.dataDir = driveConfig.dataDir;
    this.ensureDataDir();
  }

  /**
   * Ensure data directory exists
   */
  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      loggers.server.info(`📁 Created drive data directory: ${this.dataDir}`);
    }
  }

  /**
   * Validate and sanitize path to prevent path traversal attacks
   */
  public validatePath(relativePath: string): string {
    if (!relativePath || typeof relativePath !== "string") {
      return "";
    }

    // Normalize path separators
    let normalized = relativePath.replace(/\\/g, "/");

    // Remove leading slashes
    normalized = normalized.replace(/^\/+/, "");

    // Remove path traversal attempts
    normalized = normalized.replace(/\.\./g, "");

    // Remove empty segments
    const segments = normalized.split("/").filter((seg) => seg.length > 0);

    // Rebuild path
    normalized = segments.join("/");

    return normalized;
  }

  /**
   * Resolve relative path to absolute path
   */
  private resolvePath(relativePath: string): string {
    const validated = this.validatePath(relativePath || "");
    return path.join(this.dataDir, validated);
  }

  /**
   * Check if path is within data directory (security check)
   */
  private isPathSafe(absolutePath: string): boolean {
    const resolved = path.resolve(absolutePath);
    const dataDirResolved = path.resolve(this.dataDir);
    return resolved.startsWith(dataDirResolved);
  }

  /**
   * List directory contents
   */
  public listDirectory(relativePath: string = ""): DriveItem[] {
    try {
      const dirPath = this.resolvePath(relativePath);
      
      if (!this.isPathSafe(dirPath)) {
        throw new Error("Invalid path - path traversal attempt detected");
      }

      if (!fs.existsSync(dirPath)) {
        throw new Error("Directory does not exist");
      }

      const stats = fs.statSync(dirPath);
      if (!stats.isDirectory()) {
        throw new Error("Path is not a directory");
      }

      const items: DriveItem[] = [];
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const itemStats = fs.statSync(fullPath);
        
        const itemPath = relativePath
          ? `${relativePath}/${entry.name}`
          : entry.name;

        items.push({
          name: entry.name,
          path: itemPath,
          type: entry.isDirectory() ? "directory" : "file",
          size: itemStats.size,
          modified: itemStats.mtime.getTime(),
        });
      }

      // Sort: directories first, then by name
      items.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "directory" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return items;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error, path: relativePath }, "Failed to list directory");
      throw new Error(`Failed to list directory: ${errorMessage}`);
    }
  }

  /**
   * Upload a single file
   */
  public uploadFile(relativePath: string, file: Buffer, filename: string): void {
    try {
      const validatedPath = this.validatePath(relativePath || "");
      const targetDir = path.join(this.dataDir, validatedPath);
      const targetFile = path.join(targetDir, filename);

      // Ensure target directory exists
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Security check
      if (!this.isPathSafe(targetFile)) {
        throw new Error("Invalid path - path traversal attempt detected");
      }

      // Write file
      fs.writeFileSync(targetFile, file);
      loggers.server.info({ path: targetFile, size: file.length }, "📁 File uploaded");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error, path: relativePath, filename }, "Failed to upload file");
      throw new Error(`Failed to upload file: ${errorMessage}`);
    }
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
    try {
      const filePath = this.resolvePath(relativePath);
      
      if (!this.isPathSafe(filePath)) {
        throw new Error("Invalid path - path traversal attempt detected");
      }

      if (!fs.existsSync(filePath)) {
        throw new Error("File does not exist");
      }

      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        throw new Error("Path is not a file");
      }

      const buffer = fs.readFileSync(filePath);
      const filename = path.basename(filePath);

      return {
        buffer,
        filename,
        size: buffer.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error, path: relativePath }, "Failed to download file");
      throw new Error(`Failed to download file: ${errorMessage}`);
    }
  }

  /**
   * Delete a file or directory (recursive)
   */
  public deleteItem(relativePath: string): void {
    try {
      const itemPath = this.resolvePath(relativePath);
      
      if (!this.isPathSafe(itemPath)) {
        throw new Error("Invalid path - path traversal attempt detected");
      }

      if (!fs.existsSync(itemPath)) {
        throw new Error("Item does not exist");
      }

      const stats = fs.statSync(itemPath);
      
      if (stats.isDirectory()) {
        // Recursive delete for directories
        fs.rmSync(itemPath, { recursive: true, force: true });
        loggers.server.info({ path: itemPath }, "📁 Directory deleted");
      } else {
        fs.unlinkSync(itemPath);
        loggers.server.info({ path: itemPath }, "📁 File deleted");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error, path: relativePath }, "Failed to delete item");
      throw new Error(`Failed to delete item: ${errorMessage}`);
    }
  }

  /**
   * Create a directory
   */
  public createDirectory(relativePath: string): void {
    try {
      const dirPath = this.resolvePath(relativePath);
      
      if (!this.isPathSafe(dirPath)) {
        throw new Error("Invalid path - path traversal attempt detected");
      }

      if (fs.existsSync(dirPath)) {
        throw new Error("Directory already exists");
      }

      fs.mkdirSync(dirPath, { recursive: true });
      loggers.server.info({ path: dirPath }, "📁 Directory created");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error, path: relativePath }, "Failed to create directory");
      throw new Error(`Failed to create directory: ${errorMessage}`);
    }
  }

  /**
   * Rename a file or directory
   */
  public renameItem(oldPath: string, newName: string): void {
    try {
      const oldAbsolutePath = this.resolvePath(oldPath);
      const oldDir = path.dirname(oldAbsolutePath);
      const newAbsolutePath = path.join(oldDir, newName);

      if (!this.isPathSafe(oldAbsolutePath) || !this.isPathSafe(newAbsolutePath)) {
        throw new Error("Invalid path - path traversal attempt detected");
      }

      if (!fs.existsSync(oldAbsolutePath)) {
        throw new Error("Item does not exist");
      }

      if (fs.existsSync(newAbsolutePath)) {
        throw new Error("Target name already exists");
      }

      // Validate new name (no path separators)
      if (newName.includes("/") || newName.includes("\\") || newName.includes("..")) {
        throw new Error("Invalid name - cannot contain path separators");
      }

      fs.renameSync(oldAbsolutePath, newAbsolutePath);
      loggers.server.info({ oldPath, newName }, "📁 Item renamed");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error, oldPath, newName }, "Failed to rename item");
      throw new Error(`Failed to rename item: ${errorMessage}`);
    }
  }

  /**
   * Move a file or directory
   */
  public moveItem(sourcePath: string, destPath: string): void {
    try {
      const sourceAbsolutePath = this.resolvePath(sourcePath);
      const destAbsolutePath = this.resolvePath(destPath);

      if (!this.isPathSafe(sourceAbsolutePath) || !this.isPathSafe(destAbsolutePath)) {
        throw new Error("Invalid path - path traversal attempt detected");
      }

      if (!fs.existsSync(sourceAbsolutePath)) {
        throw new Error("Source item does not exist");
      }

      // If destination is a directory, move item into it
      let finalDestPath = destAbsolutePath;
      if (fs.existsSync(destAbsolutePath)) {
        const destStats = fs.statSync(destAbsolutePath);
        if (destStats.isDirectory()) {
          const sourceName = path.basename(sourceAbsolutePath);
          finalDestPath = path.join(destAbsolutePath, sourceName);
        } else {
          throw new Error("Destination already exists and is not a directory");
        }
      } else {
        // Destination doesn't exist - create parent directory
        const destParent = path.dirname(finalDestPath);
        if (!fs.existsSync(destParent)) {
          fs.mkdirSync(destParent, { recursive: true });
        }
      }

      if (fs.existsSync(finalDestPath)) {
        throw new Error("Destination already exists");
      }

      fs.renameSync(sourceAbsolutePath, finalDestPath);
      loggers.server.info({ sourcePath, destPath }, "📁 Item moved");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error, sourcePath, destPath }, "Failed to move item");
      throw new Error(`Failed to move item: ${errorMessage}`);
    }
  }

  /**
   * Get storage statistics
   */
  public getStorageStats(): StorageStats {
    try {
      let totalBytes = 0;
      let fileCount = 0;
      let dirCount = 0;

      const calculateStats = (dirPath: string): void => {
        try {
          const items = fs.readdirSync(dirPath, { withFileTypes: true });

          for (const item of items) {
            const fullPath = path.join(dirPath, item.name);

            try {
              if (item.isDirectory()) {
                dirCount++;
                calculateStats(fullPath);
              } else if (item.isFile()) {
                fileCount++;
                const stats = fs.statSync(fullPath);
                totalBytes += stats.size;
              }
            } catch (error) {
              // Ignore errors for individual items
              loggers.server.debug({ err: error, path: fullPath }, "Error reading item");
            }
          }
        } catch (error) {
          // Ignore errors reading directory
          loggers.server.debug({ err: error, path: dirPath }, "Error reading directory");
        }
      };

      if (fs.existsSync(this.dataDir)) {
        calculateStats(this.dataDir);
      }

      const totalMB = totalBytes / (1024 * 1024);
      const totalGB = totalBytes / (1024 * 1024 * 1024);

      return {
        totalBytes,
        totalMB,
        totalGB,
        fileCount,
        dirCount,
      };
    } catch (error) {
      loggers.server.error({ err: error }, "Failed to calculate storage stats");
      return {
        totalBytes: 0,
        totalMB: 0,
        totalGB: 0,
        fileCount: 0,
        dirCount: 0,
      };
    }
  }
}

// Singleton instance
export const driveManager = new DriveManager();
