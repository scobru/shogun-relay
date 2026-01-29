/**
 * Storage Adapter Module
 * 
 * Provides a pluggable storage backend for the Drive module.
 * Supports both local filesystem (fs) and S3-compatible (MinIO) storage.
 * 
 * Configure via environment variables:
 * - DRIVE_STORAGE_TYPE: "fs" (default) or "minio"
 * - For MinIO: MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET
 */

import path from "path";
import fs from "fs";
import https from "https";
import http from "http";
import {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    CopyObjectCommand,
    HeadBucketCommand,
    CreateBucketCommand,
    ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { driveConfig } from "../config/env-config";
import { loggers } from "./logger";

// ============================================================================
// TYPES
// ============================================================================

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

// ============================================================================
// STORAGE ADAPTER INTERFACE
// ============================================================================

export interface IStorageAdapter {
    /** List contents of a directory */
    listDirectory(relativePath: string): Promise<DriveItem[]>;

    /** Upload a file to storage */
    uploadFile(relativePath: string, buffer: Buffer, filename: string): Promise<void>;

    /** Download a file from storage */
    downloadFile(relativePath: string): Promise<{ buffer: Buffer; filename: string; size: number }>;

    /** Delete a file or directory */
    deleteItem(relativePath: string): Promise<void>;

    /** Create a directory */
    createDirectory(relativePath: string): Promise<void>;

    /** Rename a file or directory */
    renameItem(oldPath: string, newName: string): Promise<void>;

    /** Move a file or directory */
    moveItem(sourcePath: string, destPath: string): Promise<void>;

    /** Get storage statistics */
    getStorageStats(): Promise<StorageStats>;

    /** Validate and sanitize path */
    validatePath(relativePath: string): string;

    /** Get storage type name */
    getStorageType(): string;
}

// ============================================================================
// FS STORAGE ADAPTER (Local Filesystem)
// ============================================================================

export class FsStorageAdapter implements IStorageAdapter {
    private dataDir: string;

    constructor() {
        this.dataDir = driveConfig.dataDir;
        this.ensureDataDir();
    }

    getStorageType(): string {
        return "fs";
    }

    private ensureDataDir(): void {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
            loggers.server.info(`📁 Created drive data directory: ${this.dataDir}`);
        }
    }

    validatePath(relativePath: string): string {
        if (!relativePath || typeof relativePath !== "string") {
            return "";
        }
        let normalized = relativePath.replace(/\\/g, "/");
        normalized = normalized.replace(/^\/+/, "");
        normalized = normalized.replace(/\.\./g, "");
        const segments = normalized.split("/").filter((seg) => seg.length > 0);
        return segments.join("/");
    }

    private resolvePath(relativePath: string): string {
        const validated = this.validatePath(relativePath || "");
        return path.join(this.dataDir, validated);
    }

    private isPathSafe(absolutePath: string): boolean {
        const resolved = path.resolve(absolutePath);
        const dataDirResolved = path.resolve(this.dataDir);
        return resolved.startsWith(dataDirResolved);
    }

    async listDirectory(relativePath: string = ""): Promise<DriveItem[]> {
        const dirPath = this.resolvePath(relativePath);

        if (!this.isPathSafe(dirPath)) {
            throw new Error("Invalid path - path traversal attempt detected");
        }

        if (!fs.existsSync(dirPath)) {
            // Return empty for non-existent directories (root case)
            if (relativePath === "") {
                return [];
            }
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

        items.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === "directory" ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        return items;
    }

    async uploadFile(relativePath: string, buffer: Buffer, filename: string): Promise<void> {
        const validatedPath = this.validatePath(relativePath || "");
        const targetDir = path.join(this.dataDir, validatedPath);
        const targetFile = path.join(targetDir, filename);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        if (!this.isPathSafe(targetFile)) {
            throw new Error("Invalid path - path traversal attempt detected");
        }

        fs.writeFileSync(targetFile, buffer);
        loggers.server.info({ path: targetFile, size: buffer.length }, "📁 File uploaded (fs)");
    }

    async downloadFile(relativePath: string): Promise<{ buffer: Buffer; filename: string; size: number }> {
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

        return { buffer, filename, size: buffer.length };
    }

    async deleteItem(relativePath: string): Promise<void> {
        const itemPath = this.resolvePath(relativePath);

        if (!this.isPathSafe(itemPath)) {
            throw new Error("Invalid path - path traversal attempt detected");
        }

        if (!fs.existsSync(itemPath)) {
            throw new Error("Item does not exist");
        }

        const stats = fs.statSync(itemPath);

        if (stats.isDirectory()) {
            fs.rmSync(itemPath, { recursive: true, force: true });
            loggers.server.info({ path: itemPath }, "📁 Directory deleted (fs)");
        } else {
            fs.unlinkSync(itemPath);
            loggers.server.info({ path: itemPath }, "📁 File deleted (fs)");
        }
    }

    async createDirectory(relativePath: string): Promise<void> {
        const dirPath = this.resolvePath(relativePath);

        if (!this.isPathSafe(dirPath)) {
            throw new Error("Invalid path - path traversal attempt detected");
        }

        if (fs.existsSync(dirPath)) {
            throw new Error("Directory already exists");
        }

        fs.mkdirSync(dirPath, { recursive: true });
        loggers.server.info({ path: dirPath }, "📁 Directory created (fs)");
    }

    async renameItem(oldPath: string, newName: string): Promise<void> {
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

        if (newName.includes("/") || newName.includes("\\") || newName.includes("..")) {
            throw new Error("Invalid name - cannot contain path separators");
        }

        fs.renameSync(oldAbsolutePath, newAbsolutePath);
        loggers.server.info({ oldPath, newName }, "📁 Item renamed (fs)");
    }

    async moveItem(sourcePath: string, destPath: string): Promise<void> {
        const sourceAbsolutePath = this.resolvePath(sourcePath);
        const destAbsolutePath = this.resolvePath(destPath);

        if (!this.isPathSafe(sourceAbsolutePath) || !this.isPathSafe(destAbsolutePath)) {
            throw new Error("Invalid path - path traversal attempt detected");
        }

        if (!fs.existsSync(sourceAbsolutePath)) {
            throw new Error("Source item does not exist");
        }

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
            const destParent = path.dirname(finalDestPath);
            if (!fs.existsSync(destParent)) {
                fs.mkdirSync(destParent, { recursive: true });
            }
        }

        if (fs.existsSync(finalDestPath)) {
            throw new Error("Destination already exists");
        }

        fs.renameSync(sourceAbsolutePath, finalDestPath);
        loggers.server.info({ sourcePath, destPath }, "📁 Item moved (fs)");
    }

    async getStorageStats(): Promise<StorageStats> {
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
                    } catch {
                        // Ignore individual item errors
                    }
                }
            } catch {
                // Ignore directory read errors
            }
        };

        if (fs.existsSync(this.dataDir)) {
            calculateStats(this.dataDir);
        }

        return {
            totalBytes,
            totalMB: totalBytes / (1024 * 1024),
            totalGB: totalBytes / (1024 * 1024 * 1024),
            fileCount,
            dirCount,
        };
    }
}

// ============================================================================
// MINIO STORAGE ADAPTER (S3-Compatible)
// ============================================================================

export class MinioStorageAdapter implements IStorageAdapter {
    private client: S3Client;
    private bucket: string;
    private initialized: boolean = false;

    constructor() {
        const minioConfig = driveConfig.minio;

        if (!minioConfig?.endpoint || !minioConfig?.accessKey || !minioConfig?.secretKey) {
            throw new Error("MinIO configuration incomplete. Set MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY");
        }

        this.bucket = minioConfig.bucket || "shogun-drive";

        // Parse endpoint URL
        const endpointUrl = new URL(minioConfig.endpoint);
        const useSSL = endpointUrl.protocol === "https:";

        this.client = new S3Client({
            endpoint: minioConfig.endpoint,
            region: minioConfig.region || "us-east-1",
            credentials: {
                accessKeyId: minioConfig.accessKey,
                secretAccessKey: minioConfig.secretKey,
            },
            forcePathStyle: true, // Required for MinIO
            // Increase concurrent connections to handle high load
            requestHandler: new NodeHttpHandler({
                connectionTimeout: 5000,
                socketTimeout: 30000,
                httpsAgent: new https.Agent({
                    maxSockets: 100,
                    keepAlive: true,
                    rejectUnauthorized: !minioConfig.skipSslVerify,
                }),
                httpAgent: new http.Agent({
                    maxSockets: 100,
                    keepAlive: true,
                }),
            }),
        });

        loggers.server.info(
            { endpoint: minioConfig.endpoint, bucket: this.bucket },
            "🪣 MinIO storage adapter initialized"
        );

        // Initialize bucket in background
        this.ensureBucket();
    }

    getStorageType(): string {
        return "minio";
    }

    private async ensureBucket(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
            loggers.server.info({ bucket: this.bucket }, "🪣 MinIO bucket exists");
        } catch (error: any) {
            if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
                try {
                    await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
                    loggers.server.info({ bucket: this.bucket }, "🪣 MinIO bucket created");
                } catch (createError) {
                    loggers.server.error({ err: createError, bucket: this.bucket }, "Failed to create bucket");
                    throw createError;
                }
            } else {
                loggers.server.error({ err: error, bucket: this.bucket }, "Failed to check bucket");
                throw error;
            }
        }

        this.initialized = true;
    }

    validatePath(relativePath: string): string {
        if (!relativePath || typeof relativePath !== "string") {
            return "";
        }
        let normalized = relativePath.replace(/\\/g, "/");
        normalized = normalized.replace(/^\/+/, "");
        normalized = normalized.replace(/\.\./g, "");
        const segments = normalized.split("/").filter((seg) => seg.length > 0);
        return segments.join("/");
    }

    private getObjectKey(relativePath: string, filename?: string): string {
        const validated = this.validatePath(relativePath);
        if (filename) {
            return validated ? `${validated}/${filename}` : filename;
        }
        return validated;
    }

    async listDirectory(relativePath: string = ""): Promise<DriveItem[]> {
        await this.ensureBucket();

        const prefix = this.validatePath(relativePath);
        const prefixWithSlash = prefix ? `${prefix}/` : "";

        const response: ListObjectsV2CommandOutput = await this.client.send(
            new ListObjectsV2Command({
                Bucket: this.bucket,
                Prefix: prefixWithSlash,
                Delimiter: "/",
            })
        );

        const items: DriveItem[] = [];

        // Add directories (CommonPrefixes)
        if (response.CommonPrefixes) {
            for (const commonPrefix of response.CommonPrefixes) {
                if (commonPrefix.Prefix) {
                    const dirPath = commonPrefix.Prefix.replace(/\/$/, "");
                    const name = dirPath.split("/").pop() || "";
                    if (name) {
                        items.push({
                            name,
                            path: dirPath,
                            type: "directory",
                            size: 0,
                            modified: Date.now(),
                        });
                    }
                }
            }
        }

        // Add files (Contents)
        if (response.Contents) {
            for (const object of response.Contents) {
                if (object.Key && object.Key !== prefixWithSlash) {
                    const name = object.Key.split("/").pop() || "";
                    // Skip if it's the directory placeholder
                    if (name && !object.Key.endsWith("/")) {
                        items.push({
                            name,
                            path: object.Key,
                            type: "file",
                            size: object.Size || 0,
                            modified: object.LastModified?.getTime() || Date.now(),
                        });
                    }
                }
            }
        }

        // Sort: directories first, then by name
        items.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === "directory" ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        return items;
    }

    async uploadFile(relativePath: string, buffer: Buffer, filename: string): Promise<void> {
        await this.ensureBucket();

        const key = this.getObjectKey(relativePath, filename);

        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: buffer,
            })
        );

        loggers.server.info({ key, size: buffer.length }, "🪣 File uploaded (minio)");
    }

    async downloadFile(relativePath: string): Promise<{ buffer: Buffer; filename: string; size: number }> {
        await this.ensureBucket();

        const key = this.validatePath(relativePath);

        try {
            const response = await this.client.send(
                new GetObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                })
            );

            const bodyStream = response.Body;
            if (!bodyStream) {
                throw new Error("Empty response body");
            }

            // Convert stream to buffer
            const chunks: Uint8Array[] = [];
            for await (const chunk of bodyStream as AsyncIterable<Uint8Array>) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            const filename = key.split("/").pop() || "file";

            return {
                buffer,
                filename,
                size: buffer.length,
            };
        } catch (error: any) {
            if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
                throw new Error("File does not exist");
            }
            throw error;
        }
    }

    async deleteItem(relativePath: string): Promise<void> {
        await this.ensureBucket();

        const key = this.validatePath(relativePath);

        // Check if it's a directory by listing objects with this prefix
        const listResponse = await this.client.send(
            new ListObjectsV2Command({
                Bucket: this.bucket,
                Prefix: `${key}/`,
                MaxKeys: 1,
            })
        );

        if (listResponse.Contents && listResponse.Contents.length > 0) {
            // It's a directory - delete all objects with this prefix
            const allObjects = await this.client.send(
                new ListObjectsV2Command({
                    Bucket: this.bucket,
                    Prefix: `${key}/`,
                })
            );

            for (const obj of allObjects.Contents || []) {
                if (obj.Key) {
                    await this.client.send(
                        new DeleteObjectCommand({
                            Bucket: this.bucket,
                            Key: obj.Key,
                        })
                    );
                }
            }
            loggers.server.info({ key }, "🪣 Directory deleted (minio)");
        } else {
            // It's a file
            await this.client.send(
                new DeleteObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                })
            );
            loggers.server.info({ key }, "🪣 File deleted (minio)");
        }
    }

    async createDirectory(relativePath: string): Promise<void> {
        await this.ensureBucket();

        const key = this.validatePath(relativePath);

        // In S3/MinIO, directories are virtual. Create a placeholder object.
        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: `${key}/.keep`,
                Body: Buffer.from(""),
            })
        );

        loggers.server.info({ key }, "🪣 Directory created (minio)");
    }

    async renameItem(oldPath: string, newName: string): Promise<void> {
        await this.ensureBucket();

        if (newName.includes("/") || newName.includes("\\") || newName.includes("..")) {
            throw new Error("Invalid name - cannot contain path separators");
        }

        const oldKey = this.validatePath(oldPath);
        const parentPath = oldKey.includes("/") ? oldKey.substring(0, oldKey.lastIndexOf("/")) : "";
        const newKey = parentPath ? `${parentPath}/${newName}` : newName;

        // Copy and delete (S3 doesn't have rename)
        await this.client.send(
            new CopyObjectCommand({
                Bucket: this.bucket,
                CopySource: `${this.bucket}/${oldKey}`,
                Key: newKey,
            })
        );

        await this.client.send(
            new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: oldKey,
            })
        );

        loggers.server.info({ oldPath, newName }, "🪣 Item renamed (minio)");
    }

    async moveItem(sourcePath: string, destPath: string): Promise<void> {
        await this.ensureBucket();

        const sourceKey = this.validatePath(sourcePath);
        const destKey = this.validatePath(destPath);

        // Copy and delete
        await this.client.send(
            new CopyObjectCommand({
                Bucket: this.bucket,
                CopySource: `${this.bucket}/${sourceKey}`,
                Key: destKey,
            })
        );

        await this.client.send(
            new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: sourceKey,
            })
        );

        loggers.server.info({ sourcePath, destPath }, "🪣 Item moved (minio)");
    }

    async getStorageStats(): Promise<StorageStats> {
        await this.ensureBucket();

        let totalBytes = 0;
        let fileCount = 0;
        let dirCount = 0;
        const seenDirs = new Set<string>();

        let continuationToken: string | undefined;

        do {
            const response: ListObjectsV2CommandOutput = await this.client.send(
                new ListObjectsV2Command({
                    Bucket: this.bucket,
                    ContinuationToken: continuationToken,
                })
            );

            for (const obj of response.Contents || []) {
                if (obj.Key && !obj.Key.endsWith("/.keep")) {
                    fileCount++;
                    totalBytes += obj.Size || 0;

                    // Count unique directories
                    const parts = obj.Key.split("/");
                    for (let i = 1; i < parts.length; i++) {
                        const dirPath = parts.slice(0, i).join("/");
                        if (!seenDirs.has(dirPath)) {
                            seenDirs.add(dirPath);
                            dirCount++;
                        }
                    }
                }
            }

            continuationToken = response.NextContinuationToken;
        } while (continuationToken);

        return {
            totalBytes,
            totalMB: totalBytes / (1024 * 1024),
            totalGB: totalBytes / (1024 * 1024 * 1024),
            fileCount,
            dirCount,
        };
    }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

let storageAdapterInstance: IStorageAdapter | null = null;

/**
 * Create and return the configured storage adapter.
 * Uses singleton pattern to ensure only one adapter instance.
 */
export function createStorageAdapter(): IStorageAdapter {
    if (storageAdapterInstance) {
        return storageAdapterInstance;
    }

    const storageType = driveConfig.storageType || "fs";

    loggers.server.info({ storageType }, "🗄️ Creating storage adapter");

    if (storageType === "minio") {
        storageAdapterInstance = new MinioStorageAdapter();
    } else {
        storageAdapterInstance = new FsStorageAdapter();
    }

    return storageAdapterInstance;
}

/**
 * Get the current storage adapter instance.
 * Throws if not initialized.
 */
export function getStorageAdapter(): IStorageAdapter {
    if (!storageAdapterInstance) {
        return createStorageAdapter();
    }
    return storageAdapterInstance;
}
