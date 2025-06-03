import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import crypto from "crypto";
import Gun from "gun";

// Dependencies to be passed in: ipfsManager, fileManager, authenticateRequestMiddleware
export default function setupIpfsApiRoutes(
  ipfsManager,
  fileManager,
  authenticateRequestMiddleware
) {
  const router = express.Router();

  // Configure multer for temporary storage (independent from FileManager)
  const tempStorage = multer.diskStorage({
    destination: function (req, file, cb) {
      const tempDir = "./temp-uploads";
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      cb(null, tempDir);
    },
    filename: function (req, file, cb) {
      // Generate unique filename with timestamp and random string
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, "temp-" + uniqueSuffix + path.extname(file.originalname));
    },
  });

  const independentUpload = multer({
    storage: tempStorage,
    limits: {
      fileSize: 500 * 1024 * 1024, // 500MB limit
    },
  });

  // API - IPFS STATUS
  router.get("/status", authenticateRequestMiddleware, async (req, res) => {
    try {
      const status = {
        enabled: ipfsManager.isEnabled(),
        connected: ipfsManager.isConnected(),
        gateway: ipfsManager.getDefaultGateway(),
        nodeType: ipfsManager.getNodeType(),
        defaultGateway: ipfsManager.getDefaultGateway(),
      };

      res.json({
        success: true,
        status,
      });
    } catch (error) {
      console.error(
        `[ipfsApiRoutes] Error getting IPFS status: ${error.message}`
      );
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // API - IPFS HEALTH CHECK AND CONNECTION TEST
  router.get(
    "/health-check",
    authenticateRequestMiddleware,
    async (req, res) => {
      try {
        // First check if IPFS is enabled
        if (!ipfsManager.isEnabled()) {
          return res.json({
            success: false,
            enabled: false,
            message: "IPFS is not enabled in the configuration",
          });
        }

        // Test the connection
        console.log("[IPFS API] Running IPFS connection test");
        const testResult = await ipfsManager.testConnection();

        return res.json({
          success: testResult.success,
          enabled: true,
          health: testResult,
          message: testResult.success
            ? "IPFS connection test successful"
            : "IPFS connection test failed",
        });
      } catch (error) {
        console.error("[IPFS API] Health check error:", error);
        return res.status(500).json({
          success: false,
          error: error.message,
          message: "Error testing IPFS connection",
        });
      }
    }
  );

  // Support legacy route for backward compatibility
  router.post("/config", authenticateRequestMiddleware, async (req, res) => {
    try {
      if (!req.body) {
        return res.status(400).json({
          success: false,
          error: "No configuration data provided",
          message: "Missing configuration data",
        });
      }

      ipfsManager.updateConfig(req.body);

      // Ensure FileManager's Multer is reconfigured if IPFS settings change
      fileManager.setIpfsManager(ipfsManager);

      return res.json({
        success: true,
        config: ipfsManager.getConfig(),
        message:
          "IPFS configuration updated successfully (using legacy endpoint)",
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error updating IPFS configuration",
      });
    }
  });

  // API - IPFS CHECK PIN STATUS
  router.get(
    "/pin-status/:hash",
    authenticateRequestMiddleware,
    async (req, res) => {
      try {
        const hash = req.params.hash;
        if (!hash) {
          return res.status(400).json({
            success: false,
            error: "IPFS hash missing",
            message: "Missing required parameter",
          });
        }

        if (!ipfsManager.isEnabled()) {
          return res.status(400).json({
            success: false,
            error: "IPFS not active",
            message: "IPFS service not enabled",
          });
        }

        const isPinned = await ipfsManager.isPinned(hash);
        return res.json({
          success: true,
          isPinned,
          hash,
          message: `File is ${isPinned ? "pinned" : "not pinned"}`,
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: error.message,
          message: "Error checking pin status",
        });
      }
    }
  );

  // API - IPFS PIN FILE
  router.post("/pin", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { hash } = req.body;
      if (!hash) {
        return res.status(400).json({
          success: false,
          error: "IPFS hash missing",
          message: "Missing required parameter",
        });
      }

      if (!ipfsManager.isEnabled()) {
        return res.status(400).json({
          success: false,
          error: "IPFS not active",
          message: "IPFS service not enabled",
        });
      }

      const isPinned = await ipfsManager.isPinned(hash);
      if (isPinned) {
        return res.json({
          success: true,
          message: "File already pinned",
          hash,
          isPinned: true,
        });
      }

      const result = await ipfsManager.pin(hash);
      return res.json({
        success: true,
        message: "File pinned successfully",
        hash,
        isPinned: true,
        result,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error pinning file",
      });
    }
  });

  // API - IPFS UNPIN FILE
  router.post("/unpin", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { hash } = req.body;
      if (!hash) {
        return res.status(400).json({
          success: false,
          error: "IPFS hash missing",
          message: "Missing required parameter",
        });
      }

      if (!ipfsManager.isEnabled()) {
        return res.status(400).json({
          success: false,
          error: "IPFS not active",
          message: "IPFS service not enabled",
        });
      }

      const isPinned = await ipfsManager.isPinned(hash);
      if (!isPinned) {
        return res.json({
          success: true,
          message: "File already unpinned",
          hash,
          isPinned: false,
        });
      }

      const result = await ipfsManager.unpin(hash);
      return res.json({
        success: true,
        message: "File unpinned successfully",
        hash,
        isPinned: false,
        result,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error unpinning file",
      });
    }
  });

  // Get IPFS metadata for debugging
  router.get("/metadata", authenticateRequestMiddleware, async (req, res) => {
    try {
      const uploadsDir = ipfsManager.getUploadsDir() || "./uploads";
      const metadataPath = path.join(uploadsDir, "ipfs-metadata.json");

      if (fs.existsSync(metadataPath)) {
        const content = fs.readFileSync(metadataPath, "utf8");
        const metadata = JSON.parse(content);

        res.json({
          success: true,
          metadata,
          count: Object.keys(metadata).length,
        });
      } else {
        res.json({
          success: true,
          metadata: {},
          count: 0,
          message: "IPFS metadata file does not exist",
        });
      }
    } catch (error) {
      console.error(
        `[ipfsApiRoutes] Error getting IPFS metadata: ${error.message}`
      );
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // API - DIRECT UPLOAD TO IPFS (INDEPENDENT FROM FILEMANAGER)
  router.post(
    "/upload",
    authenticateRequestMiddleware,
    independentUpload.single("file"), // Independent multer middleware
    async (req, res) => {
      try {
        if (!ipfsManager.isEnabled()) {
          return res.status(400).json({
            success: false,
            error: "IPFS not active",
            message: "IPFS service not enabled",
          });
        }

        // Check if file was uploaded via multipart/form-data
        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: "No file uploaded",
            message: "Please provide a file to upload",
          });
        }

        const file = req.file;
        const customName = req.body.customName || file.originalname;
        const uploadStartTime = Date.now();

        console.log(
          `[IPFS Independent] Direct upload to IPFS starting: ${customName} (${file.size} bytes)`
        );

        // Calculate file hash for content verification
        const fileBuffer = fs.readFileSync(file.path);
        const contentHash = crypto
          .createHash("sha256")
          .update(fileBuffer)
          .digest("hex")
          .substring(0, 16);

        // Upload directly to IPFS without local storage
        const result = await ipfsManager.uploadFile(file.path, {
          name: customName,
          metadata: {
            size: file.size,
            type: file.mimetype,
            originalName: file.originalname,
            uploadedAt: uploadStartTime,
            directUpload: true,
            independent: true,
            contentHash: contentHash,
          },
        });

        if (result && result.id) {
          const ipfsHash = result.id;
          const ipfsUrl = ipfsManager.getGatewayUrl(ipfsHash);
          const processingTime = Date.now() - uploadStartTime;

          // Create independent file data (no FileManager dependency)
          const independentFileData = {
            id: ipfsHash, // Use IPFS hash as ID
            name: customName,
            originalName: file.originalname,
            mimeType: file.mimetype,
            mimetype: file.mimetype,
            size: file.size,
            ipfsHash: ipfsHash,
            ipfsUrl: ipfsUrl,
            url: ipfsUrl, // Point directly to IPFS
            fileUrl: ipfsUrl,
            localPath: null, // No local storage
            timestamp: uploadStartTime,
            uploadedAt: uploadStartTime,
            customName: customName !== file.originalname ? customName : null,
            contentHash: contentHash,
            verified: true,
            directUpload: true,
            independent: true, // Mark as independent from FileManager
            processingTime: processingTime,
            uploadType: "ipfs-direct",
          };

          // Save metadata directly to GunDB (bypass FileManager)
          try {
            // Get the gun instance directly from config or create connection
            let gun;
            if (fileManager && fileManager.config && fileManager.config.gun) {
              gun = fileManager.config.gun;
            } else {
              // Create a minimal gun connection if FileManager is not available
              console.warn(
                "[IPFS Independent] FileManager not available, creating direct Gun connection"
              );
              gun = new Gun(["http://localhost:8765/gun"]); // Use default gun endpoint
            }

            // Save to GunDB directly
            await new Promise((resolve, reject) => {
              gun
                .get("ipfs-files")
                .get(ipfsHash)
                .put(independentFileData, (ack) => {
                  if (ack.err) {
                    console.error(
                      `[IPFS Independent] Error saving to GunDB: ${ack.err}`
                    );
                    reject(new Error(ack.err));
                  } else {
                    console.log(
                      `[IPFS Independent] Saved to GunDB: ${ipfsHash}`
                    );
                    resolve();
                  }
                });
            });

            // Also save to regular files collection for compatibility
            await new Promise((resolve, reject) => {
              gun
                .get("files")
                .get(ipfsHash)
                .put(independentFileData, (ack) => {
                  if (ack.err) {
                    console.warn(
                      `[IPFS Independent] Warning saving to files collection: ${ack.err}`
                    );
                    // Don't reject, this is just for compatibility
                    resolve();
                  } else {
                    console.log(
                      `[IPFS Independent] Also saved to files collection: ${ipfsHash}`
                    );
                    resolve();
                  }
                });
            });
          } catch (gunError) {
            console.error(
              `[IPFS Independent] GunDB storage error: ${gunError.message}`
            );
            // Continue anyway since file is on IPFS
          }

          // Clean up temporary file immediately after IPFS upload
          try {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
              console.log(
                `[IPFS Independent] Cleaned up temporary file: ${file.path}`
              );
            }
          } catch (cleanupError) {
            console.warn(
              `[IPFS Independent] Error cleaning up temp file: ${cleanupError.message}`
            );
          }

          console.log(
            `[IPFS Independent] Direct upload to IPFS completed: ${ipfsHash} in ${processingTime}ms`
          );

          return res.json({
            success: true,
            message:
              "File uploaded directly to IPFS successfully (independent mode)",
            file: independentFileData,
            ipfsHash: ipfsHash,
            ipfsUrl: ipfsUrl,
            contentHash: contentHash,
            processingTime: processingTime,
            uploadType: "ipfs-direct",
            independent: true,
            result: result,
          });
        } else {
          throw new Error("IPFS upload completed but no hash received");
        }
      } catch (error) {
        console.error(
          `[IPFS Independent] Error in direct upload to IPFS: ${error.message}`
        );

        // Clean up temporary file on error
        if (req.file && fs.existsSync(req.file.path)) {
          try {
            fs.unlinkSync(req.file.path);
            console.log(
              `[IPFS Independent] Cleaned up temp file after error: ${req.file.path}`
            );
          } catch (cleanupError) {
            console.warn(
              `[IPFS Independent] Error cleaning up temp file on error: ${cleanupError.message}`
            );
          }
        }

        return res.status(500).json({
          success: false,
          error: error.message,
          message: "Error uploading file directly to IPFS (independent mode)",
        });
      }
    }
  );

  // API - UPLOAD EXISTING FILE TO IPFS
  router.post(
    "/upload-existing",
    authenticateRequestMiddleware,
    async (req, res) => {
      try {
        const { fileId, fileName } = req.body;

        if (!fileId) {
          return res.status(400).json({
            success: false,
            error: "File ID is required",
            message: "Missing required parameter",
          });
        }

        if (!ipfsManager.isEnabled()) {
          return res.status(400).json({
            success: false,
            error: "IPFS not active",
            message: "IPFS service not enabled",
          });
        }

        console.log(`[IPFS API] Uploading existing file to IPFS: ${fileId}`);

        // Get file from FileManager first
        let fileData = await fileManager.getFileById(fileId);
        let localFilePath = null;

        if (!fileData) {
          console.log(
            `[IPFS API] FileManager couldn't find file ${fileId}, trying direct file lookup...`
          );

          // FALLBACK: Try to find the file directly in the uploads directory
          const uploadsDir = fileManager.config?.storageDir || "./uploads";

          // Try to find a file that matches the fileId
          try {
            const files = fs.readdirSync(uploadsDir);
            const matchingFile = files.find(
              (file) =>
                file.includes(fileId) ||
                file === fileId ||
                file === `${fileId}.webp` ||
                file === `${fileId}.jpg` ||
                file === `${fileId}.png` ||
                file === `${fileId}.pdf`
            );

            if (matchingFile) {
              localFilePath = path.join(uploadsDir, matchingFile);
              console.log(
                `[IPFS API] Found file via direct lookup: ${localFilePath}`
              );

              // Get file stats to create minimal file data
              const stats = fs.statSync(localFilePath);
              const ext = path.extname(matchingFile);
              const mimeTypes = {
                ".webp": "image/webp",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".pdf": "application/pdf",
                ".txt": "text/plain",
              };

              // Create minimal file data for fallback
              fileData = {
                id: fileId,
                name: matchingFile,
                originalName: fileName || matchingFile,
                size: stats.size,
                mimetype:
                  mimeTypes[ext.toLowerCase()] || "application/octet-stream",
                mimeType:
                  mimeTypes[ext.toLowerCase()] || "application/octet-stream",
                localPath: localFilePath,
                timestamp: stats.mtimeMs,
                uploadedAt: stats.mtimeMs,
              };

              console.log(`[IPFS API] Created fallback file data:`, {
                id: fileData.id,
                name: fileData.name,
                size: fileData.size,
                mimetype: fileData.mimetype,
              });
            }
          } catch (fsError) {
            console.error(
              `[IPFS API] Error reading uploads directory: ${fsError.message}`
            );
          }
        }

        if (!fileData) {
          return res.status(404).json({
            success: false,
            error: "File not found",
            message: `File with ID ${fileId} not found in FileManager or filesystem`,
          });
        }

        // Check if file already has IPFS hash
        if (fileData.ipfsHash) {
          return res.json({
            success: true,
            message: "File already exists on IPFS",
            ipfsHash: fileData.ipfsHash,
            ipfsUrl: fileData.ipfsUrl,
            alreadyExists: true,
          });
        }

        // Find the local file path if not already set
        if (!localFilePath) {
          localFilePath = fileData.localPath;

          // If localPath is not available, try to construct it
          if (!localFilePath || !fs.existsSync(localFilePath)) {
            const uploadsDir = fileManager.config?.storageDir || "./uploads";

            // Try different filename patterns
            const possiblePaths = [
              path.join(uploadsDir, fileData.name),
              path.join(uploadsDir, fileData.originalName),
              path.join(
                uploadsDir,
                `${fileData.timestamp}-${fileData.originalName}`
              ),
              path.join(uploadsDir, `${fileData.timestamp}-${fileData.name}`),
              path.join(uploadsDir, fileId),
              path.join(uploadsDir, `${fileId}.webp`),
              path.join(uploadsDir, `${fileId}.jpg`),
              path.join(uploadsDir, `${fileId}.png`),
            ];

            // Try to find the file in filesystem
            const files = fs.readdirSync(uploadsDir);
            for (const file of files) {
              if (
                file.includes(fileData.timestamp?.toString()) ||
                file.includes(fileData.name) ||
                file.includes(fileData.originalName) ||
                file.includes(fileId)
              ) {
                localFilePath = path.join(uploadsDir, file);
                break;
              }
            }

            // If still not found, try the possible paths
            if (!localFilePath || !fs.existsSync(localFilePath)) {
              for (const possiblePath of possiblePaths) {
                if (fs.existsSync(possiblePath)) {
                  localFilePath = possiblePath;
                  break;
                }
              }
            }
          }
        }

        if (!localFilePath || !fs.existsSync(localFilePath)) {
          return res.status(404).json({
            success: false,
            error: "Local file not found",
            message: `Local file for ${fileId} not found in filesystem`,
            debug: {
              fileId: fileId,
              fileDataExists: !!fileData,
              localFilePath: localFilePath,
              uploadsDir: fileManager.config?.storageDir || "./uploads",
            },
          });
        }

        console.log(`[IPFS API] Found local file at: ${localFilePath}`);

        // Upload to IPFS
        const result = await ipfsManager.uploadFile(localFilePath, {
          name: fileName || fileData.originalName || fileData.name,
          metadata: {
            size: fileData.size,
            type: fileData.mimetype || fileData.mimeType,
            originalFileId: fileId,
            uploadedAt: Date.now(),
          },
        });

        if (result && result.id) {
          const ipfsHash = result.id;
          const ipfsUrl = ipfsManager.getGatewayUrl(ipfsHash);

          // Update file metadata in FileManager (if the file was found via FileManager)
          try {
            const updatedFileData = {
              ...fileData,
              ipfsHash: ipfsHash,
              ipfsUrl: ipfsUrl,
            };

            // Save updated metadata
            await fileManager.saveFileMetadata(updatedFileData);

            // Save IPFS metadata
            fileManager._saveIpfsMetadata(fileId, ipfsHash);

            console.log(`[IPFS API] Updated file metadata with IPFS hash`);
          } catch (metadataError) {
            console.warn(
              `[IPFS API] Could not update file metadata: ${metadataError.message}`
            );
            // Continue anyway - the upload to IPFS was successful
          }

          console.log(
            `[IPFS API] File uploaded to IPFS successfully: ${ipfsHash}`
          );

          return res.json({
            success: true,
            message: "File uploaded to IPFS successfully",
            fileId: fileId,
            ipfsHash: ipfsHash,
            ipfsUrl: ipfsUrl,
            result: result,
            usedFallback: !fileData || !fileData.localPath,
          });
        } else {
          throw new Error("IPFS upload completed but no hash received");
        }
      } catch (error) {
        console.error(
          `[IPFS API] Error uploading existing file to IPFS: ${error.message}`
        );
        return res.status(500).json({
          success: false,
          error: error.message,
          message: "Error uploading file to IPFS",
        });
      }
    }
  );

  // API - GET INDEPENDENT IPFS FILES
  router.get("/files", authenticateRequestMiddleware, async (req, res) => {
    try {
      const files = [];

      // Get files directly from GunDB ipfs-files collection
      let gun;
      if (fileManager && fileManager.config && fileManager.config.gun) {
        gun = fileManager.config.gun;
      } else {
        console.warn(
          "[IPFS Independent] FileManager not available, creating direct Gun connection"
        );
        gun = new Gun(["http://localhost:8765/gun"]);
      }

      await new Promise((resolve) => {
        gun
          .get("ipfs-files")
          .map()
          .once((data, key) => {
            if (data && key && !key.startsWith("_")) {
              // Only include files that are marked as independent
              if (data.independent && data.ipfsHash) {
                files.push({
                  id: data.id || key,
                  name: data.name || data.originalName,
                  originalName: data.originalName,
                  size: data.size,
                  mimeType: data.mimeType || data.mimetype,
                  ipfsHash: data.ipfsHash,
                  ipfsUrl: data.ipfsUrl,
                  contentHash: data.contentHash,
                  uploadedAt: data.uploadedAt || data.timestamp,
                  uploadType: data.uploadType || "ipfs-direct",
                  independent: data.independent,
                  verified: data.verified,
                  processingTime: data.processingTime,
                });
              }
            }
          });

        // Give some time for Gun to return results
        setTimeout(resolve, 1500);
      });

      // Sort by upload time, newest first
      files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));

      return res.json({
        success: true,
        files: files,
        count: files.length,
        message: "Independent IPFS files retrieved successfully",
        source: "ipfs-direct",
      });
    } catch (error) {
      console.error(
        `[IPFS Independent] Error retrieving independent files: ${error.message}`
      );
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error retrieving independent IPFS files",
      });
    }
  });

  // API - DELETE INDEPENDENT IPFS FILE
  router.delete(
    "/files/:ipfsHash",
    authenticateRequestMiddleware,
    async (req, res) => {
      try {
        const ipfsHash = req.params.ipfsHash;

        if (!ipfsHash) {
          return res.status(400).json({
            success: false,
            error: "IPFS hash is required",
            message: "Missing required parameter",
          });
        }

        // Get gun instance
        let gun;
        if (fileManager && fileManager.config && fileManager.config.gun) {
          gun = fileManager.config.gun;
        } else {
          console.warn(
            "[IPFS Independent] FileManager not available, creating direct Gun connection"
          );
          gun = new Gun(["http://localhost:8765/gun"]);
        }

        // Check if file exists and is independent
        const fileData = await new Promise((resolve) => {
          gun
            .get("ipfs-files")
            .get(ipfsHash)
            .once((data) => {
              resolve(data);
            });
        });

        if (!fileData || !fileData.independent) {
          return res.status(404).json({
            success: false,
            error: "Independent IPFS file not found",
            message: `File with hash ${ipfsHash} not found or not independent`,
          });
        }

        // Remove from GunDB
        gun.get("ipfs-files").get(ipfsHash).put(null);

        // Also remove from files collection if it exists there
        gun.get("files").get(ipfsHash).put(null);

        // Optionally unpin from IPFS if it's pinned
        if (ipfsManager.isEnabled()) {
          try {
            const isPinned = await ipfsManager.isPinned(ipfsHash);
            if (isPinned) {
              await ipfsManager.unpin(ipfsHash);
              console.log(
                `[IPFS Independent] Unpinned file from IPFS: ${ipfsHash}`
              );
            }
          } catch (ipfsError) {
            console.warn(
              `[IPFS Independent] Error unpinning file: ${ipfsError.message}`
            );
            // Continue anyway since we're removing from database
          }
        }

        console.log(`[IPFS Independent] Deleted independent file: ${ipfsHash}`);

        return res.json({
          success: true,
          message: "Independent IPFS file deleted successfully",
          ipfsHash: ipfsHash,
          fileName: fileData.name || fileData.originalName,
        });
      } catch (error) {
        console.error(
          `[IPFS Independent] Error deleting independent file: ${error.message}`
        );
        return res.status(500).json({
          success: false,
          error: error.message,
          message: "Error deleting independent IPFS file",
        });
      }
    }
  );

  // API - CLEANUP TEMPORARY FILES
  router.post(
    "/cleanup-temp",
    authenticateRequestMiddleware,
    async (req, res) => {
      try {
        const tempDir = "./temp-uploads";
        let deletedFiles = 0;
        let totalSize = 0;

        if (fs.existsSync(tempDir)) {
          const files = fs.readdirSync(tempDir);
          const now = Date.now();
          const maxAge = 24 * 60 * 60 * 1000; // 24 hours

          for (const file of files) {
            const filePath = path.join(tempDir, file);
            try {
              const stats = fs.statSync(filePath);
              const age = now - stats.mtime.getTime();

              // Delete files older than maxAge
              if (age > maxAge) {
                const fileSize = stats.size;
                fs.unlinkSync(filePath);
                deletedFiles++;
                totalSize += fileSize;
                console.log(
                  `[IPFS Independent] Cleaned up old temp file: ${file} (${fileSize} bytes)`
                );
              }
            } catch (fileError) {
              console.warn(
                `[IPFS Independent] Error processing temp file ${file}: ${fileError.message}`
              );
            }
          }
        }

        return res.json({
          success: true,
          message: "Temporary files cleanup completed",
          deletedFiles: deletedFiles,
          totalSize: totalSize,
          formattedSize: formatBytes(totalSize),
        });
      } catch (error) {
        console.error(
          `[IPFS Independent] Error during temp cleanup: ${error.message}`
        );
        return res.status(500).json({
          success: false,
          error: error.message,
          message: "Error during temporary files cleanup",
        });
      }
    }
  );

  // Helper function to format bytes
  function formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  // ===== FILE HASH INFO & TEMPORARY LINKS ENDPOINTS =====

  // API - GET FILE HASH INFORMATION
  router.get(
    "/file-info/:fileId",
    authenticateRequestMiddleware,
    async (req, res) => {
      try {
        const fileId = req.params.fileId;

        if (!fileId) {
          return res.status(400).json({
            success: false,
            error: "File ID is required",
            message: "Missing required parameter",
          });
        }

        // Get file from FileManager
        const fileData = await fileManager.getFileById(fileId);
        if (!fileData) {
          return res.status(404).json({
            success: false,
            error: "File not found",
            message: `File with ID ${fileId} not found`,
          });
        }

        // Prepare hash information
        const hashInfo = {
          fileId: fileData.id,
          fileName: fileData.originalName || fileData.name,
          contentHash: fileData.contentHash,
          ipfsHash: fileData.ipfsHash,
          sha256: fileData.contentHash, // Content hash is typically SHA-256 based
          size: fileData.size,
          mimeType: fileData.mimetype || fileData.mimeType,
          uploadedAt: fileData.timestamp || fileData.uploadedAt,
          verified: fileData.verified || false,
          directUpload: fileData.directUpload || false,
        };

        // Add additional verification info if available
        if (fileData.localPath && fs.existsSync(fileData.localPath)) {
          const stats = fs.statSync(fileData.localPath);
          hashInfo.fileSystemInfo = {
            exists: true,
            lastModified: stats.mtime,
            actualSize: stats.size,
          };
        } else if (fileData.localPath) {
          hashInfo.fileSystemInfo = {
            exists: false,
            expectedPath: fileData.localPath,
          };
        }

        // Add IPFS verification if available
        if (fileData.ipfsHash && ipfsManager.isEnabled()) {
          try {
            const isPinned = await ipfsManager.isPinned(fileData.ipfsHash);
            hashInfo.ipfsInfo = {
              hash: fileData.ipfsHash,
              url: fileData.ipfsUrl,
              isPinned: isPinned,
              gateway: ipfsManager.getDefaultGateway(),
            };
          } catch (ipfsError) {
            console.warn(
              `[IPFS API] Error checking IPFS info for ${fileData.ipfsHash}: ${ipfsError.message}`
            );
            hashInfo.ipfsInfo = {
              hash: fileData.ipfsHash,
              url: fileData.ipfsUrl,
              error: ipfsError.message,
            };
          }
        }

        return res.json({
          success: true,
          hashInfo: hashInfo,
          message: "File hash information retrieved successfully",
        });
      } catch (error) {
        console.error(
          `[IPFS API] Error getting file hash info: ${error.message}`
        );
        return res.status(500).json({
          success: false,
          error: error.message,
          message: "Error retrieving file hash information",
        });
      }
    }
  );

  // API - CREATE TEMPORARY ACCESS LINK (using GunDB/SEA encryption)
  router.post(
    "/create-temp-link",
    authenticateRequestMiddleware,
    async (req, res) => {
      try {
        const {
          fileId,
          expiresIn = 3600,
          password,
          allowedDownloads = 1,
        } = req.body; // Default 1 hour expiration

        if (!fileId) {
          return res.status(400).json({
            success: false,
            error: "File ID is required",
            message: "Missing required parameter",
          });
        }

        // Get file from FileManager
        const fileData = await fileManager.getFileById(fileId);
        if (!fileData) {
          return res.status(404).json({
            success: false,
            error: "File not found",
            message: `File with ID ${fileId} not found`,
          });
        }

        // Generate temporary token with SEA-like encryption concept
        // TODO: Implement temporary link functionality
        return res.status(501).json({
          success: false,
          error: "Not implemented",
          message: "Temporary link functionality not yet implemented",
        });
      } catch (error) {
        console.error(
          `[IPFS API] Error creating temporary link: ${error.message}`
        );
        return res.status(500).json({
          success: false,
          error: error.message,
          message: "Error creating temporary access link",
        });
      }
    }
  );

  return router;
}