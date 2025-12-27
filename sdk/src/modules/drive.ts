import { ApiClient } from "../client";
import FormData from "form-data";

export interface DriveFileItem {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modified: number;
}

export interface DriveListResponse {
  success: boolean;
  items: DriveFileItem[];
  path: string;
}

export interface DriveStatsResponse {
  success: boolean;
  stats: {
    totalBytes: number;
    totalSizeMB: string;
    totalSizeGB: string;
    fileCount: number;
    dirCount: number;
  };
}

export interface PublicLink {
  linkId: string;
  filePath: string;
  createdAt: number;
  expiresAt: number | null;
  accessCount: number;
  lastAccessedAt: number | null;
}

export interface PublicLinkResponse {
  success: boolean;
  linkId: string;
  filePath: string;
  publicUrl: string;
  createdAt: number;
  expiresAt: number | null;
}

export interface PublicLinksListResponse {
  success: boolean;
  links: PublicLink[];
}

export class DriveModule {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * List files and folders in the specified directory
   */
  public async list(path?: string): Promise<DriveListResponse> {
    const url = path ? `/api/v1/drive/list/${encodeURIComponent(path)}` : "/api/v1/drive/list";
    return this.client.get<DriveListResponse>(url);
  }

  /**
   * Upload a single file
   */
  public async uploadFile(
    file: Buffer | Blob,
    filename: string,
    path?: string
  ): Promise<{ success: boolean; message: string; files: Array<{ name: string; path: string; size: number }> }> {
    const formData = new FormData();
    formData.append("file", file, filename);

    const url = path ? `/api/v1/drive/upload/${encodeURIComponent(path)}` : "/api/v1/drive/upload";
    
    return this.client.post(url, formData, {
      headers: formData.getHeaders(),
    } as any);
  }

  /**
   * Upload multiple files
   */
  public async uploadFiles(
    files: Array<{ file: Buffer | Blob; filename: string }>,
    path?: string
  ): Promise<{ success: boolean; message: string; files: Array<{ name: string; path: string; size: number }> }> {
    const formData = new FormData();
    files.forEach(({ file, filename }) => {
      formData.append("files", file, filename);
    });

    const url = path ? `/api/v1/drive/upload/${encodeURIComponent(path)}` : "/api/v1/drive/upload";
    
    return this.client.post(url, formData, {
      headers: formData.getHeaders(),
    } as any);
  }

  /**
   * Download a file
   */
  public async download(path: string): Promise<Buffer> {
    const url = `/api/v1/drive/download/${encodeURIComponent(path)}`;
    // Use the internal axios client to handle arraybuffer response
    const response = await (this.client as any).client.get(url, {
      responseType: "arraybuffer",
    });
    return Buffer.from(response.data);
  }

  /**
   * Delete a file or directory
   */
  public async delete(path: string): Promise<{ success: boolean; message: string }> {
    const url = `/api/v1/drive/delete/${encodeURIComponent(path)}`;
    return this.client.delete(url);
  }

  /**
   * Create a directory
   */
  public async createDirectory(name: string, path?: string): Promise<{ success: boolean; message: string; path: string }> {
    const url = path ? `/api/v1/drive/mkdir/${encodeURIComponent(path)}` : "/api/v1/drive/mkdir";
    return this.client.post(url, { name });
  }

  /**
   * Rename a file or directory
   */
  public async rename(oldPath: string, newName: string): Promise<{ success: boolean; message: string }> {
    return this.client.post("/api/v1/drive/rename", {
      oldPath,
      newName,
    });
  }

  /**
   * Move a file or directory
   */
  public async move(sourcePath: string, destPath: string): Promise<{ success: boolean; message: string }> {
    return this.client.post("/api/v1/drive/move", {
      sourcePath,
      destPath,
    });
  }

  /**
   * Get storage statistics
   */
  public async getStats(): Promise<DriveStatsResponse> {
    return this.client.get<DriveStatsResponse>("/api/v1/drive/stats");
  }

  /**
   * Create a public sharing link for a file
   */
  public async createPublicLink(
    filePath: string,
    expiresInDays?: number
  ): Promise<PublicLinkResponse> {
    return this.client.post<PublicLinkResponse>("/api/v1/drive/links", {
      filePath,
      expiresInDays,
    });
  }

  /**
   * List all public links
   */
  public async listPublicLinks(): Promise<PublicLinksListResponse> {
    return this.client.get<PublicLinksListResponse>("/api/v1/drive/links");
  }

  /**
   * Revoke a public link
   */
  public async revokePublicLink(linkId: string): Promise<{ success: boolean; message: string }> {
    return this.client.delete(`/api/v1/drive/links/${linkId}`);
  }

  /**
   * Get public file URL (for direct access without authentication)
   * Note: This requires the baseURL from the SDK configuration to construct the full URL
   */
  public getPublicFileUrl(linkId: string, baseURL?: string): string {
    if (baseURL) {
      return `${baseURL}/api/v1/drive/public/${linkId}`;
    }
    // If baseURL is not provided, return relative path
    return `/api/v1/drive/public/${linkId}`;
  }
}

