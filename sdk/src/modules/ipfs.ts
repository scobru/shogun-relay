import { ApiClient } from "../client";
import FormData from "form-data";

export class IpfsModule {
  private readonly client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  public async getStatus(): Promise<any> {
    return this.client.get("/api/v1/ipfs/status");
  }

  public async uploadFile(
    fileBuffer: Buffer,
    filename: string,
    contentType: string,
    userAddress?: string
  ): Promise<any> {
    const form = new FormData();
    form.append("file", fileBuffer, {
      filename: filename,
      contentType: contentType,
    });

    const headers: any = form.getHeaders();
    if (userAddress) {
      headers["x-user-address"] = userAddress;
    }

    return this.client.post("/api/v1/ipfs/upload", form, {
      headers: headers,
    });
  }

  /**
   * Upload multiple files as a directory to IPFS
   * Maintains directory structure using relative paths
   *
   * @param files Array of file objects with buffer, filename, path, and contentType
   * @param userAddress Optional user address for authentication
   * @returns Promise with directory CID and file information
   */
  public async uploadDirectory(
    files: Array<{
      buffer: Buffer;
      filename: string;
      path: string; // Relative path within directory (e.g., "css/style.css" or "index.html")
      contentType?: string;
    }>,
    userAddress?: string
  ): Promise<any> {
    if (!files || files.length === 0) {
      throw new Error("At least one file is required for directory upload");
    }

    const form = new FormData();

    // Add all files to FormData maintaining directory structure
    files.forEach((file) => {
      form.append("files", file.buffer, {
        filename: file.path, // Use path to maintain directory structure
        contentType: file.contentType || "application/octet-stream",
      });
    });

    const headers: any = form.getHeaders();
    if (userAddress) {
      headers["x-user-address"] = userAddress;
    }

    return this.client.post("/api/v1/ipfs/upload-directory", form, {
      headers: headers,
    });
  }

  public async cat(cid: string): Promise<Buffer> {
    return this.client.get(`/api/v1/ipfs/cat/${cid}`, {
      responseType: "arraybuffer",
    });
  }

  /**
   * Cat a file from an IPFS directory using a relative path
   * @param directoryCid The CID of the directory
   * @param filePath The relative path to the file within the directory (e.g., "index.html" or "css/style.css")
   * @returns Promise with file content as Buffer
   */
  public async catFromDirectory(directoryCid: string, filePath: string): Promise<Buffer> {
    // IPFS API supports paths like CID/path/to/file
    // We need to encode the CID but keep slashes for path navigation
    // Format: /api/v0/cat?arg=QmDirectory/index.html
    const fullPath = `${directoryCid}/${filePath}`;
    // Encode only the CID part, keep slashes for navigation
    const encodedPath = fullPath.includes("/")
      ? `${encodeURIComponent(directoryCid)}/${filePath
          .split("/")
          .map((p) => encodeURIComponent(p))
          .join("/")}`
      : encodeURIComponent(fullPath);

    // Use GET instead of POST, or send empty string instead of null to avoid JSON parser error
    // IPFS API v0 cat accepts POST with empty body, but Express JSON parser fails on null
    return this.client.post(
      `/api/v1/ipfs/api/v0/cat?arg=${encodedPath}`,
      "", // Empty string instead of null to avoid JSON parser error
      {
        responseType: "arraybuffer",
        headers: {
          "Content-Type": "application/octet-stream", // Set content type to avoid JSON parsing
        },
      }
    );
  }

  public async pinAdd(cid: string): Promise<any> {
    return this.client.post("/api/v1/ipfs/pin/add", { cid });
  }

  public async pinRm(cid: string): Promise<any> {
    return this.client.post("/api/v1/ipfs/pin/rm", { cid });
  }

  public async pinLs(): Promise<any> {
    // Note: relay's pin/ls endpoint lists all pins and doesn't support filtering by CID
    return this.client.get("/api/v1/ipfs/pin/ls");
  }

  public async catJson(cid: string): Promise<any> {
    return this.client.get(`/api/v1/ipfs/cat/${cid}/json`);
  }

  public async catDecrypt(cid: string, token: string, userAddress?: string): Promise<Buffer> {
    const params: any = { token };
    const headers: any = {};

    if (userAddress) {
      headers["x-user-address"] = userAddress;
    }

    return this.client.get(`/api/v1/ipfs/cat/${cid}/decrypt`, {
      params,
      headers,
      responseType: "arraybuffer",
    });
  }

  public async repoGC(): Promise<any> {
    return this.client.post("/api/v1/ipfs/repo/gc");
  }

  public async repoStat(): Promise<any> {
    return this.client.get("/api/v1/ipfs/repo/stat");
  }

  public async getVersion(): Promise<any> {
    return this.client.get("/api/v1/ipfs/version");
  }

  /**
   * Upload a file using browser FormData (for browser environments)
   * @param file File object from browser File API
   * @param userAddress Optional user address for authentication
   * @returns Promise with upload result
   */
  public async uploadFileBrowser(file: File, userAddress?: string): Promise<any> {
    const formData = new FormData();
    formData.append("file", file, file.name);

    const headers: any = {};
    if (userAddress) {
      headers["x-user-address"] = userAddress;
    }

    // Explicitly don't set Content-Type - let browser set it with boundary for FormData
    return this.client.post("/api/v1/ipfs/upload", formData, {
      headers: headers,
      // Ensure axios doesn't serialize FormData as JSON
      transformRequest: [(data) => {
        // If it's FormData, return as-is (axios will handle it)
        if (data instanceof FormData) {
          return data;
        }
        return data;
      }],
    });
  }

  /**
   * Upload multiple files as a directory using browser FormData (for browser environments)
   * Maintains directory structure using relative paths from File.webkitRelativePath or file.name
   *
   * @param files Array of File objects from browser File API
   * @param userAddress Optional user address for authentication
   * @returns Promise with directory CID and file information
   */
  public async uploadDirectoryBrowser(files: File[], userAddress?: string): Promise<any> {
    if (!files || files.length === 0) {
      throw new Error("At least one file is required for directory upload");
    }

    const formData = new FormData();

    // Add all files to FormData maintaining directory structure
    files.forEach((file) => {
      // Use webkitRelativePath if available (from folder input), otherwise use file.name
      const relativePath = (file as any).webkitRelativePath || file.name;
      formData.append("files", file, relativePath);
    });

    const headers: any = {};
    if (userAddress) {
      headers["x-user-address"] = userAddress;
    }

    // Explicitly don't set Content-Type - let browser set it with boundary for FormData
    return this.client.post("/api/v1/ipfs/upload-directory", formData, {
      headers: headers,
      // Ensure axios doesn't serialize FormData as JSON
      transformRequest: [(data) => {
        // If it's FormData, return as-is (axios will handle it)
        if (data instanceof FormData) {
          return data;
        }
        return data;
      }],
    });
  }

  /**
   * Cat a file and return as Blob (for browser environments)
   * @param cid The CID of the file
   * @returns Promise with file content as Blob
   */
  public async catBlob(cid: string): Promise<Blob> {
    return this.client.get<Blob>(`/api/v1/ipfs/cat/${cid}`, {
      responseType: "blob",
    });
  }

  /**
   * Cat a file from directory and return as Blob (for browser environments)
   * @param directoryCid The CID of the directory
   * @param filePath The relative path to the file within the directory
   * @returns Promise with file content as Blob
   */
  public async catFromDirectoryBlob(directoryCid: string, filePath: string): Promise<Blob> {
    const fullPath = `${directoryCid}/${filePath}`;
    const encodedPath = fullPath.includes("/")
      ? `${encodeURIComponent(directoryCid)}/${filePath
          .split("/")
          .map((p) => encodeURIComponent(p))
          .join("/")}`
      : encodeURIComponent(fullPath);

    return this.client.post<Blob>(`/api/v1/ipfs/api/v0/cat?arg=${encodedPath}`, "", {
      responseType: "blob",
      headers: {
        "Content-Type": "application/octet-stream",
      },
    });
  }
}
