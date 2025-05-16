import fs from "fs";
import path from "path";
import multer from "multer";
import crypto from "crypto";

class FileManager {
  constructor(config) {
    this.config = {
      storageDir: config.storageDir || "./uploads",
      maxFileSize: config.maxFileSize || 50 * 1024 * 1024, // 50MB
      ipfsManager: config.ipfsManager || null,
      gun: config.gun || null
    };
    
    // Create storage directory if it doesn't exist
    if (!fs.existsSync(this.config.storageDir)) {
      fs.mkdirSync(this.config.storageDir, { recursive: true });
    }
    
    // Configure multer
    this.configureMulter();
  }
  
  /**
   * Helper per create Promise with timeout for Gun
   * @param {Function} gunOperation - Gun operation to execute
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<any>} Result of the operation
   */
  gunPromiseWithTimeout(gunOperation, timeoutMs = 3000) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(null); // Resolve with null if timeout
      }, timeoutMs);
      
      gunOperation((result) => {
        clearTimeout(timeout);
        resolve(result);
      });
    });
  }
  
  // Configure multer based on IPFS availability
  configureMulter() {
    const isIpfsEnabled = this.config.ipfsManager?.isEnabled();
    
    if (isIpfsEnabled) {
      // When IPFS is enabled, use memoryStorage to keep buffer in memory
      const memoryStorage = multer.memoryStorage();
      this.upload = multer({
        storage: memoryStorage,
        limits: {
          fileSize: this.config.maxFileSize,
        },
      });
    } else {
      // When IPFS is disabled, use diskStorage to save directly to disk
      const storage = multer.diskStorage({
        destination: (req, file, cb) => {
          // Ensure directory exists
          if (!fs.existsSync(this.config.storageDir)) {
            fs.mkdirSync(this.config.storageDir, { recursive: true });
          }
          cb(null, this.config.storageDir);
        },
        filename: (req, file, cb) => {
          // Generate unique filename
          const uniqueFilename = `${Date.now()}-${file.originalname.replace(
            /[^a-zA-Z0-9.-]/g,
            "_"
          )}`;
          cb(null, uniqueFilename);
        },
      });

      this.upload = multer({
        storage: storage,
        limits: {
          fileSize: this.config.maxFileSize,
        },
      });
    }
  }
  
  /**
   * Get multer middleware
   * @returns {Object} Multer middleware
   */
  getUploadMiddleware() {
    return this.upload;
  }
  
  /**
   * Handle file upload request
   * @param {Object} req - Express request object with file from multer
   * @returns {Promise<Object>} File data including URLs and metadata
   */
  async handleFileUpload(req) {
    if (!req.file && (!req.body.content || !req.body.contentType)) {
      throw new Error("File or content missing");
    }

    let gunDbKey, fileBuffer, originalName, mimeType, fileSize;

    if (req.file) {
      originalName = req.file.originalname;
      mimeType = req.file.mimetype;
      fileSize = req.file.size;
      gunDbKey = req.body.customName || originalName.replace(/[.\/\\]/g, "_");

      // Check if file was uploaded to memory or disk
      if (req.file.buffer) {
        // multer.memoryStorage() - file is in memory
        fileBuffer = req.file.buffer;
      } else if (req.file.path) {
        // multer.diskStorage() - file is on disk
        fileBuffer = fs.readFileSync(req.file.path);
      } else {
        throw new Error("Unable to read uploaded file");
      }
    } else {
      const content = req.body.content;
      const contentType = req.body.contentType || "text/plain";
      originalName = req.body.customName || `text-${Date.now()}.txt`;
      gunDbKey = req.body.customName || `text-${Date.now()}`;
      mimeType = contentType;
      fileSize = content.length;
      fileBuffer = Buffer.from(content);
    }

    if (!fileBuffer) {
      throw new Error("File buffer not available");
    }

    let fileUrl = null;
    let ipfsHash = null;

    // If IPFS is enabled, upload to IPFS
    if (this.config.ipfsManager?.isEnabled()) {
      try {
        console.log(
          `Attempting upload to IPFS for file: ${originalName}, size: ${fileSize} bytes, type: ${mimeType}`
        );

        if (!fileBuffer || fileBuffer.length === 0) {
          throw new Error("Empty or invalid file buffer");
        }

        let result;

        // Use the correct method based on file type
        if (mimeType.startsWith("text/") || mimeType === "application/json") {
          // For text or JSON files, we can use uploadJson
          const textContent = fileBuffer.toString("utf-8");

          // Check if it's valid JSON
          let jsonData;
          try {
            jsonData = JSON.parse(textContent);
          } catch (e) {
            // If not valid JSON, treat as normal text
            jsonData = { content: textContent, filename: originalName };
          }

          result = await this.config.ipfsManager.uploadJson(jsonData, {
            name: originalName,
            metadata: {
              size: fileSize,
              type: mimeType,
              customName: req.body.customName || null,
            },
          });
        } else {
          // For binary files (images, videos, etc.) use uploadFile directly
          // Create a temporary file
          const tempFilePath = path.join(
            this.config.storageDir,
            `temp_${Date.now()}_${originalName}`
          );
          fs.writeFileSync(tempFilePath, fileBuffer);

          result = await this.config.ipfsManager.uploadFile(tempFilePath, {
            name: originalName,
            metadata: {
              size: fileSize,
              type: mimeType,
              customName: req.body.customName || null,
            },
          });

          // Remove temporary file
          try {
            fs.unlinkSync(tempFilePath);
          } catch (e) {
            /* ignore errors */
          }
        }

        if (result && result.id) {
          fileUrl = this.config.ipfsManager.getGatewayUrl(result.id);
          ipfsHash = result.id;
          console.log(`File uploaded to IPFS successfully. CID: ${result.id}`);
        } else {
          throw new Error("Upload IPFS completed but ID not received");
        }
      } catch (ipfsError) {
        console.error("Error during IPFS upload:", ipfsError);
        console.error(
          "Error details:",
          JSON.stringify(ipfsError.message || ipfsError)
        );
        // Fallback to local upload will happen automatically
      }
    }

    // Fallback to local storage
    if (!fileUrl) {
      console.log(
        `IPFS upload failed or not configured, using local storage for: ${originalName}`
      );
      const fileName = `${Date.now()}-${originalName}`;
      const localPath = path.join(this.config.storageDir, fileName);
      fs.writeFileSync(localPath, fileBuffer);
      fileUrl = `/uploads/${fileName}`;
      console.log(`File saved locally successfully: ${localPath}`);
    }

    const fileData = {
      id: gunDbKey,
      name: originalName,
      originalName: originalName,
      mimeType: mimeType,
      mimetype: mimeType,
      size: fileSize,
      url: fileUrl,
      fileUrl: fileUrl,
      ipfsHash: ipfsHash || null,
      ipfsUrl: ipfsHash ? this.config.ipfsManager.getGatewayUrl(ipfsHash) : null,
      timestamp: Date.now(),
      uploadedAt: Date.now(),
      customName: req.body.customName || null,
    };

    // Save metadata to GunDB if available
    if (this.config.gun) {
      await this.saveFileMetadata(fileData);
    }

    return fileData;
  }
  
  /**
   * Get all files from GunDB
   * @returns {Promise<Array>} Array of file objects
   */
  async getAllFiles() {
    if (!this.config.gun) {
      throw new Error("Gun instance not available");
    }

    const files = [];
    const seen = new Set();

    console.log("Request received for all files");

    // Collect files from Gun with a timeout
    await new Promise((resolve) => {
      // Set a timeout to ensure a response even if Gun is slow
      const timeout = setTimeout(() => {
        console.log(`Timeout reached after 3 seconds. Returning ${files.length} files`);
        resolve();
      }, 3000);

      // Retrieve files from GunDB
      this.config.gun
        .get("files")
        .map()
        .once((data, key) => {
          if (key !== "_" && !seen.has(key) && data) {
            seen.add(key);
            console.log(`File found in GunDB: ${key}, name: ${data.name || "unnamed"}`);

            // Ensure all necessary fields are present
            const fileData = {
              id: key,
              name: data.name || "Unnamed file",
              originalName: data.originalName || data.name || "Unnamed file",
              mimetype: data.mimeType || data.mimetype || "application/octet-stream",
              size: data.size || 0,
              fileUrl: data.url || data.fileUrl || "",
              ipfsHash: data.ipfsHash || null,
              ipfsUrl: data.ipfsHash && this.config.ipfsManager
                ? this.config.ipfsManager.getGatewayUrl(data.ipfsHash)
                : null,
              uploadedAt: data.timestamp || data.uploadedAt || Date.now(),
              customName: data.customName || null,
            };

            files.push(fileData);
          }
        });

      // Conclude Promise after a short period to give Gun time to respond
      setTimeout(() => {
        clearTimeout(timeout);
        console.log(`Collected ${files.length} files from GunDB`);
        resolve();
      }, 1000);
    });

    return files;
  }
  
  /**
   * Get file by ID from GunDB
   * @param {string} fileId - File ID to retrieve
   * @returns {Promise<Object|null>} File data or null if not found
   */
  async getFileById(fileId) {
    if (!this.config.gun) {
      throw new Error("Gun instance not available");
    }

    if (!fileId) {
      throw new Error("File ID is required");
    }

    // Get file from GunDB
    return this.gunPromiseWithTimeout((resolve) => {
      this.config.gun
        .get("files")
        .get(fileId)
        .once((data) => {
          if (data) {
            // Update IPFS URL if needed
            if (data.ipfsHash && this.config.ipfsManager) {
              data.ipfsUrl = this.config.ipfsManager.getGatewayUrl(data.ipfsHash);
            }
            
            resolve(data);
          } else {
            resolve(null);
          }
        });
    });
  }
  
  /**
   * Delete file by ID
   * @param {string} fileId - File ID to delete
   * @returns {Promise<Object>} Result of the operation
   */
  async deleteFile(fileId) {
    if (!this.config.gun) {
      throw new Error("Gun instance not available");
    }

    if (!fileId) {
      throw new Error("File ID is required");
    }

    console.log(`Request to delete file: ${fileId}`);

    // Get file data from GunDB
    const fileNode = this.config.gun.get("files").get(fileId);
    
    const fileData = await this.gunPromiseWithTimeout((resolve) => {
      fileNode.once((data) => {
        resolve(data);
      });
    });

    if (!fileData) {
      throw new Error("File not found");
    }

    // Delete local file if path exists
    const localPath = fileData.localPath;
    if (localPath && fs.existsSync(localPath)) {
      try {
        fs.unlinkSync(localPath);
        console.log(`File deleted from local filesystem: ${localPath}`);
      } catch (fsError) {
        console.error("Error deleting file from filesystem:", fsError);
        // Continue with database deletion anyway
      }
    }

    // Unpin from IPFS if hash exists and IPFS is enabled
    if (fileData.ipfsHash && this.config.ipfsManager?.isEnabled()) {
      try {
        await this.config.ipfsManager.unpin(fileData.ipfsHash);
        console.log(`File unpinned from IPFS: ${fileData.ipfsHash}`);
      } catch (ipfsError) {
        console.error("Error unpinning from IPFS:", ipfsError);
        // Continue with database deletion anyway
      }
    }

    // Delete from GunDB
    await this.gunPromiseWithTimeout((resolve) => {
      fileNode.put(null, (ack) => {
        if (ack.err) {
          console.error("Error deleting from GunDB:", ack.err);
        } else {
          console.log(`File deleted from GunDB: ${fileId}`);
        }
        resolve();
      });
    });

    return {
      success: true,
      message: "File deleted successfully",
      id: fileId
    };
  }
  
  /**
   * Save file metadata to GunDB
   * @param {Object} metadata - File metadata to save
   * @returns {Promise<Object>} Saved metadata with verification
   */
  async saveFileMetadata(metadata) {
    if (!this.config.gun) {
      throw new Error("Gun instance not available");
    }

    if (!metadata || !metadata.id) {
      throw new Error("Invalid metadata: ID is required");
    }

    const fileId = metadata.id;
    
    console.log(
      `[FILE-MANAGER] Preparing to save to GunDB. Key: ${fileId}, IPFS Enabled: ${this.config.ipfsManager?.isEnabled() || false}`
    );
    
    // Save to GunDB
    const saveResult = await this.gunPromiseWithTimeout((resolve) => {
      this.config.gun
        .get("files")
        .get(fileId)
        .put(metadata, (ack) => {
          resolve(!ack.err);
        });
    });

    // Verify the save operation
    let savedData = null;
    try {
      savedData = await this.gunPromiseWithTimeout((resolve) => {
        this.config.gun
          .get("files")
          .get(fileId)
          .once((data) => {
            resolve(data);
          });
      });
    } catch (verifyError) {
      console.warn("[FILE-MANAGER] Error during save verification:", verifyError);
    }

    return {
      ...metadata,
      verified: !!savedData
    };
  }
  
  /**
   * Generate a secure random ID
   * @param {number} length - Length of the ID
   * @returns {string} Generated ID
   */
  generateId(length = 16) {
    return crypto.randomBytes(length).toString('hex');
  }
  
  /**
   * Set IPFS manager
   * @param {Object} ipfsManager - IPFS manager instance
   */
  setIpfsManager(ipfsManager) {
    this.config.ipfsManager = ipfsManager;
    this.configureMulter(); // Reconfigure multer with new IPFS setting
  }
  
  /**
   * Set Gun instance
   * @param {Object} gun - Gun instance
   */
  setGun(gun) {
    this.config.gun = gun;
  }
}

export default FileManager;
