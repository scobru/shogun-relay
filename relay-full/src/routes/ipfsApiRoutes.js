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
          let gunSaveSuccess = false;
          try {
            // Get the gun instance directly from config or create connection
            let gun;
            if (fileManager && fileManager.config && fileManager.config.gun) {
              gun = fileManager.config.gun;
              console.log('[IPFS Independent] Using existing Gun instance from FileManager');
            } else {
              // Create a minimal gun connection if FileManager is not available
              console.warn(
                "[IPFS Independent] FileManager not available, creating direct Gun connection"
              );
              gun = new Gun([`http://localhost:${process.env.PORT || 8765}/gun`]); // Use config port
            }

            // ENHANCED: Save to GunDB with improved retry mechanism and immediate fallback
            console.log(`[IPFS Independent] Attempting to save to GunDB: ${ipfsHash}`);
            
            let saveAttempts = 0;
            const maxAttempts = 2; // Reduced attempts for faster fallback
            let saveSuccessful = false;
            
            while (saveAttempts < maxAttempts && !saveSuccessful) {
              saveAttempts++;
              console.log(`[IPFS Independent] Save attempt ${saveAttempts}/${maxAttempts}`);
              
              try {
                // Save to ipfs-files collection with shorter timeout for faster fallback
                await new Promise((resolve, reject) => {
                  const timeout = setTimeout(() => {
                    console.warn(`[IPFS Independent] GunDB save timeout after 3 seconds (attempt ${saveAttempts})`);
                    reject(new Error(`GunDB save timeout after 3 seconds (attempt ${saveAttempts})`));
                  }, 3000); // Reduced timeout to 3 seconds for faster fallback
                  
                  gun
                    .get("ipfs-files")
                    .get(ipfsHash)
                    .put(independentFileData, (ack) => {
                      clearTimeout(timeout);
                      if (ack.err) {
                        console.error(
                          `[IPFS Independent] Error saving to GunDB ipfs-files (attempt ${saveAttempts}): ${ack.err}`
                        );
                        reject(new Error(ack.err));
                      } else {
                        console.log(
                          `[IPFS Independent] Successfully saved to GunDB ipfs-files (attempt ${saveAttempts}): ${ipfsHash}`
                        );
                        resolve();
                      }
                    });
                });
                
                saveSuccessful = true;
                console.log(`[IPFS Independent] Save successful on attempt ${saveAttempts}`);
                
              } catch (attemptError) {
                console.warn(`[IPFS Independent] Save attempt ${saveAttempts} failed: ${attemptError.message}`);
                
                if (saveAttempts < maxAttempts) {
                  // Short wait before retry
                  const waitTime = 500;
                  console.log(`[IPFS Independent] Waiting ${waitTime}ms before retry...`);
                  await new Promise(resolve => setTimeout(resolve, waitTime));
                } else {
                  console.error(`[IPFS Independent] All GunDB save attempts failed, proceeding to fallback`);
                  throw attemptError; // Re-throw on final attempt
                }
              }
            }

            // Also save to regular files collection for compatibility (with shorter timeout)
            try {
              await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                  console.warn('[IPFS Independent] Timeout saving to files collection, continuing...');
                  resolve(); // Don't fail the whole operation
                }, 5000);
                
                gun
                  .get("files")
                  .get(ipfsHash)
                  .put(independentFileData, (ack) => {
                    clearTimeout(timeout);
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
            } catch (compatError) {
              console.warn(`[IPFS Independent] Compatibility save failed: ${compatError.message}`);
              // Don't fail the main operation for this
            }
            
            gunSaveSuccess = true;
            console.log(`[IPFS Independent] GunDB save operations completed successfully`);
            
          } catch (gunError) {
            console.error(
              `[IPFS Independent] GunDB storage error after all retries: ${gunError.message}`
            );
            gunSaveSuccess = false;
            
            // ENHANCED FALLBACK: Save to local JSON file for recovery
            try {
              const fallbackDir = './radata/ipfs-fallback';
              if (!fs.existsSync(fallbackDir)) {
                fs.mkdirSync(fallbackDir, { recursive: true });
                console.log(`[IPFS Independent] Created fallback directory: ${fallbackDir}`);
              }
              
              const fallbackFile = path.join(fallbackDir, `${ipfsHash}.json`);
              fs.writeFileSync(fallbackFile, JSON.stringify(independentFileData, null, 2));
              console.log(`[IPFS Independent] ✅ Saved to fallback file: ${fallbackFile}`);
              
              // Also create a recovery log with more details
              const recoveryLog = path.join(fallbackDir, 'recovery.log');
              const logEntry = `${new Date().toISOString()} - ${ipfsHash} - ${independentFileData.originalName} - ${independentFileData.size} bytes - ${independentFileData.mimeType}\n`;
              fs.appendFileSync(recoveryLog, logEntry);
              console.log(`[IPFS Independent] ✅ Added to recovery log: ${recoveryLog}`);
              
              // Mark that we used fallback
              independentFileData.usedFallback = true;
              independentFileData.fallbackSaved = true;
              
            } catch (fallbackError) {
              console.error(`[IPFS Independent] ❌ Fallback save also failed: ${fallbackError.message}`);
              independentFileData.fallbackError = fallbackError.message;
            }
          }

          // Clean up temporary file
          try {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
              console.log(`[IPFS Independent] Cleaned up temp file: ${file.path}`);
            }
          } catch (cleanupError) {
            console.warn(`[IPFS Independent] Error cleaning up temp file: ${cleanupError.message}`);
          }

          console.log(
            `[IPFS Independent] Direct upload to IPFS completed successfully: ${ipfsHash} in ${processingTime}ms`
          );

          return res.json({
            success: true,
            message: "File uploaded to IPFS successfully",
            file: independentFileData,
            fileInfo: {
              id: ipfsHash,
              name: customName,
              originalName: file.originalname,
              size: file.size,
              type: file.mimetype,
              ipfsHash: ipfsHash,
              ipfsUrl: ipfsUrl,
              url: ipfsUrl,
            },
            ipfsHash: ipfsHash,
            ipfsUrl: ipfsUrl,
            verified: true,
            processingTime: processingTime,
            uploadType: "ipfs-direct",
          });
        } else {
          throw new Error("IPFS upload completed but no hash received");
        }
      } catch (error) {
        console.error(
          `[IPFS Independent] Error in direct IPFS upload: ${error.message}`
        );

        // Clean up temporary file on error
        try {
          if (req.file && req.file.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
            console.log(`[IPFS Independent] Cleaned up temp file after error: ${req.file.path}`);
          }
        } catch (cleanupError) {
          console.warn(`[IPFS Independent] Error cleaning up temp file after error: ${cleanupError.message}`);
        }

        return res.status(500).json({
          success: false,
          error: error.message,
          message: "Error uploading file to IPFS",
          uploadType: "ipfs-direct",
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
        console.log('[IPFS Files] Using existing Gun instance from FileManager');
      } else {
        console.warn(
          "[IPFS Independent] FileManager not available, creating direct Gun connection"
        );
        gun = new Gun([`http://localhost:${process.env.PORT || 8765}/gun`]);
      }

      console.log('[IPFS Files] Fetching files from GunDB...');
      
      // Fetch from GunDB with timeout
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          console.warn('[IPFS Files] GunDB fetch timeout after 3 seconds');
          resolve();
        }, 3000);
        
        let fileCount = 0;
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
                  source: 'gundb'
                });
                fileCount++;
              }
            }
            
            // Clear timeout if we get any data
            if (fileCount === 1) {
              clearTimeout(timeout);
              // Give a bit more time for other files to load
              setTimeout(resolve, 500);
            }
          });

        // Fallback timeout
        setTimeout(() => {
          clearTimeout(timeout);
          resolve();
        }, 2000);
      });

      console.log(`[IPFS Files] Found ${files.length} files from GunDB`);

      // ENHANCED FALLBACK: Check local fallback files and auto-recover them
      try {
        const fallbackDir = './radata/ipfs-fallback';
        if (fs.existsSync(fallbackDir)) {
          const fallbackFiles = fs.readdirSync(fallbackDir).filter(f => f.endsWith('.json') && f !== 'recovery.log');
          console.log(`[IPFS Files] Checking ${fallbackFiles.length} fallback files...`);
          
          for (const fallbackFile of fallbackFiles) {
            try {
              const fallbackPath = path.join(fallbackDir, fallbackFile);
              const fallbackData = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
              
              // Check if this file is already in our results from GunDB
              const existsInGunDB = files.some(f => f.ipfsHash === fallbackData.ipfsHash);
              
              if (!existsInGunDB && fallbackData.independent && fallbackData.ipfsHash) {
                // Add to current results
                files.push({
                  ...fallbackData,
                  source: 'fallback',
                  needsRecovery: true
                });
                console.log(`[IPFS Files] Added file from fallback: ${fallbackData.ipfsHash}`);
                
                // AUTO-RECOVERY: Try to save this file back to GunDB in the background
                try {
                  console.log(`[IPFS Files] Auto-recovering file to GunDB: ${fallbackData.ipfsHash}`);
                  
                  // Quick attempt to save to GunDB (non-blocking)
                  gun
                    .get("ipfs-files")
                    .get(fallbackData.ipfsHash)
                    .put(fallbackData, (ack) => {
                      if (ack.err) {
                        console.warn(`[IPFS Files] Auto-recovery failed for ${fallbackData.ipfsHash}: ${ack.err}`);
                      } else {
                        console.log(`[IPFS Files] ✅ Auto-recovered file to GunDB: ${fallbackData.ipfsHash}`);
                        
                        // Move the fallback file to recovered folder
                        try {
                          const recoveredDir = path.join(fallbackDir, 'recovered');
                          if (!fs.existsSync(recoveredDir)) {
                            fs.mkdirSync(recoveredDir, { recursive: true });
                          }
                          
                          const recoveredPath = path.join(recoveredDir, fallbackFile);
                          fs.renameSync(fallbackPath, recoveredPath);
                          console.log(`[IPFS Files] Moved recovered file: ${recoveredPath}`);
                        } catch (moveError) {
                          console.warn(`[IPFS Files] Could not move recovered file: ${moveError.message}`);
                        }
                      }
                    });
                } catch (recoveryError) {
                  console.warn(`[IPFS Files] Auto-recovery error for ${fallbackData.ipfsHash}: ${recoveryError.message}`);
                }
              }
            } catch (parseError) {
              console.warn(`[IPFS Files] Error parsing fallback file ${fallbackFile}: ${parseError.message}`);
            }
          }
        }
      } catch (fallbackError) {
        console.warn(`[IPFS Files] Error checking fallback files: ${fallbackError.message}`);
      }

      // Sort by upload time, newest first
      files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));

      console.log(`[IPFS Files] Returning ${files.length} total files (${files.filter(f => f.source === 'gundb').length} from GunDB, ${files.filter(f => f.source === 'fallback').length} from fallback)`);

      return res.json({
        success: true,
        files: files,
        count: files.length,
        message: "Independent IPFS files retrieved successfully",
        source: "ipfs-direct",
        breakdown: {
          gundb: files.filter(f => f.source === 'gundb').length,
          fallback: files.filter(f => f.source === 'fallback').length,
          total: files.length
        }
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
    "/files/:fileIdOrHash",
    authenticateRequestMiddleware,
    async (req, res) => {
      try {
        const fileIdOrHash = req.params.fileIdOrHash;

        if (!fileIdOrHash) {
          return res.status(400).json({
            success: false,
            error: "File ID or IPFS hash is required",
            message: "Missing required parameter",
          });
        }

        console.log(`[IPFS Independent] Attempting to delete file: ${fileIdOrHash}`);

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

        let fileData = null;
        let actualKey = null;

        // Strategy 1: Try to find by direct key match
        console.log(`[IPFS Independent] Strategy 1: Direct key lookup for: ${fileIdOrHash}`);
        fileData = await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            console.log(`[IPFS Independent] Strategy 1 timeout after 3 seconds`);
            resolve(null);
          }, 3000);
          
          gun.get("ipfs-files").get(fileIdOrHash).once((data) => {
            clearTimeout(timeout);
            console.log(`[IPFS Independent] Strategy 1 result:`, data ? 'found' : 'not found');
            if (data && data.independent) {
              actualKey = fileIdOrHash;
              console.log(`[IPFS Independent] Strategy 1 success: ${fileIdOrHash}`);
              resolve(data);
            } else {
              resolve(null);
            }
          });
        });

        // Strategy 2: If not found, search through all IPFS files
        if (!fileData) {
          console.log(`[IPFS Independent] Strategy 2: Comprehensive search for: ${fileIdOrHash}`);
          
          fileData = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              console.log(`[IPFS Independent] Strategy 2 timeout after 8 seconds`);
              resolve(null);
            }, 8000);
            
            let found = false;
            let searchCount = 0;
            
            gun.get("ipfs-files").map().once((data, key) => {
              if (found || !data || !key || key.startsWith('_')) return;
              
              searchCount++;
              console.log(`[IPFS Independent] Checking file ${searchCount}: ${key} (${data.name || data.originalName})`);
              
              // Enhanced matching criteria
              const matches = (
                data.independent && (
                  key === fileIdOrHash ||
                  data.id === fileIdOrHash ||
                  data.ipfsHash === fileIdOrHash ||
                  (data.name && (
                    data.name === fileIdOrHash ||
                    data.name.includes(fileIdOrHash) ||
                    fileIdOrHash.includes(data.name)
                  )) ||
                  (data.originalName && (
                    data.originalName === fileIdOrHash ||
                    data.originalName.includes(fileIdOrHash) ||
                    fileIdOrHash.includes(data.originalName)
                  )) ||
                  // Try partial hash matching (first 16 chars)
                  (data.ipfsHash && fileIdOrHash.length >= 16 && 
                   data.ipfsHash.substring(0, 16) === fileIdOrHash.substring(0, 16)) ||
                  // Try content hash matching if available
                  (data.contentHash && data.contentHash === fileIdOrHash)
                )
              );
              
              if (matches) {
                found = true;
                actualKey = key;
                clearTimeout(timeout);
                console.log(`[IPFS Independent] Strategy 2 success: Found ${key} (searched for: ${fileIdOrHash})`);
                console.log(`[IPFS Independent] Match details:`, {
                  key,
                  dataId: data.id,
                  ipfsHash: data.ipfsHash,
                  name: data.name,
                  originalName: data.originalName,
                  searchTerm: fileIdOrHash
                });
                resolve(data);
              }
            });
            
            // Give extra time for all files to be checked
            setTimeout(() => {
              if (!found) {
                console.log(`[IPFS Independent] Strategy 2 completed: Checked ${searchCount} files, none matched`);
                clearTimeout(timeout);
                resolve(null);
              }
            }, 6000);
          });
        }

        // Strategy 3: If still not found, try the regular files collection
        if (!fileData) {
          console.log(`[IPFS Independent] Strategy 3: Checking regular files collection for: ${fileIdOrHash}`);
          
          fileData = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              console.log(`[IPFS Independent] Strategy 3 timeout after 3 seconds`);
              resolve(null);
            }, 3000);
            
            gun.get("files").get(fileIdOrHash).once((data) => {
              clearTimeout(timeout);
              console.log(`[IPFS Independent] Strategy 3 result:`, data ? 'found' : 'not found');
              if (data && data.ipfsHash) {
                actualKey = fileIdOrHash;
                console.log(`[IPFS Independent] Strategy 3 success: Found IPFS file in regular collection: ${fileIdOrHash}`);
                resolve(data);
              } else {
                resolve(null);
              }
            });
          });
        }

        // Strategy 4: If still not found, check fallback files
        if (!fileData) {
          console.log(`[IPFS Independent] Strategy 4: Checking fallback files for: ${fileIdOrHash}`);
          
          try {
            const fallbackDir = './radata/ipfs-fallback';
            const fallbackFile = path.join(fallbackDir, `${fileIdOrHash}.json`);
            
            if (fs.existsSync(fallbackFile)) {
              const fallbackData = JSON.parse(fs.readFileSync(fallbackFile, 'utf8'));
              if (fallbackData.independent && fallbackData.ipfsHash) {
                actualKey = fileIdOrHash;
                fileData = fallbackData;
                console.log(`[IPFS Independent] Strategy 4 success: Found file in fallback: ${fileIdOrHash}`);
              }
            } else {
              // Try searching all fallback files by name or hash
              if (fs.existsSync(fallbackDir)) {
                const fallbackFiles = fs.readdirSync(fallbackDir).filter(f => f.endsWith('.json'));
                
                for (const fallbackFileName of fallbackFiles) {
                  try {
                    const fallbackPath = path.join(fallbackDir, fallbackFileName);
                    const fallbackData = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
                    
                    const matches = (
                      fallbackData.independent && (
                        fallbackData.id === fileIdOrHash ||
                        fallbackData.ipfsHash === fileIdOrHash ||
                        (fallbackData.name && (
                          fallbackData.name === fileIdOrHash ||
                          fallbackData.name.includes(fileIdOrHash) ||
                          fileIdOrHash.includes(fallbackData.name)
                        )) ||
                        (fallbackData.originalName && (
                          fallbackData.originalName === fileIdOrHash ||
                          fallbackData.originalName.includes(fileIdOrHash) ||
                          fileIdOrHash.includes(fallbackData.originalName)
                        ))
                      )
                    );
                    
                    if (matches) {
                      actualKey = fallbackData.ipfsHash; // Use IPFS hash as key
                      fileData = fallbackData;
                      console.log(`[IPFS Independent] Strategy 4 success: Found file by search in fallback: ${fallbackFileName}`);
                      break;
                    }
                  } catch (parseError) {
                    console.warn(`[IPFS Independent] Error parsing fallback file ${fallbackFileName}: ${parseError.message}`);
                  }
                }
              }
            }
          } catch (fallbackError) {
            console.warn(`[IPFS Independent] Error checking fallback files: ${fallbackError.message}`);
          }
        }

        if (!fileData) {
          console.log(`[IPFS Independent] File not found in any collection: ${fileIdOrHash}`);
          return res.status(404).json({
            success: false,
            error: "IPFS file not found",
            message: `File with identifier ${fileIdOrHash} not found in any collection`,
          });
        }

        // Ensure we have the required data for deletion
        if (!fileData.ipfsHash && !fileData.independent) {
          console.log(`[IPFS Independent] File found but not suitable for IPFS deletion: ${fileIdOrHash}`);
          return res.status(400).json({
            success: false,
            error: "File is not an IPFS file",
            message: `File ${fileIdOrHash} does not have IPFS hash or independent flag`,
          });
        }

        console.log(`[IPFS Independent] Found file to delete: ${actualKey} (${fileData.name || fileData.originalName})`);
        console.log(`[IPFS Independent] File details:`, {
          actualKey,
          fileId: fileData.id,
          ipfsHash: fileData.ipfsHash,
          name: fileData.name,
          originalName: fileData.originalName,
          independent: fileData.independent
        });

        // Remove from GunDB using multiple strategies
        const keysToRemove = [
          actualKey,
          fileData.id,
          fileData.ipfsHash,
          fileData.name,
          fileData.originalName
        ].filter(Boolean).filter((key, index, arr) => arr.indexOf(key) === index); // Remove duplicates

        console.log(`[IPFS Independent] Removing from ipfs-files collection with keys:`, keysToRemove);
        
        // Remove from ipfs-files collection
        for (const key of keysToRemove) {
          try {
            gun.get("ipfs-files").get(key).put(null);
            console.log(`[IPFS Independent] Removed from ipfs-files: ${key}`);
          } catch (removeError) {
            console.warn(`[IPFS Independent] Error removing from ipfs-files with key ${key}: ${removeError.message}`);
          }
        }

        // Also remove from files collection
        console.log(`[IPFS Independent] Removing from files collection with keys:`, keysToRemove);
        for (const key of keysToRemove) {
          try {
            gun.get("files").get(key).put(null);
            console.log(`[IPFS Independent] Removed from files: ${key}`);
          } catch (removeError) {
            console.warn(`[IPFS Independent] Error removing from files with key ${key}: ${removeError.message}`);
          }
        }

        // Remove from fallback files if they exist
        console.log(`[IPFS Independent] Checking and removing fallback files...`);
        try {
          const fallbackDir = './radata/ipfs-fallback';
          
          for (const key of keysToRemove) {
            const fallbackFile = path.join(fallbackDir, `${key}.json`);
            if (fs.existsSync(fallbackFile)) {
              fs.unlinkSync(fallbackFile);
              console.log(`[IPFS Independent] Removed fallback file: ${key}.json`);
            }
          }
          
          // Also check if there are any fallback files that match this file's data
          if (fs.existsSync(fallbackDir)) {
            const fallbackFiles = fs.readdirSync(fallbackDir).filter(f => f.endsWith('.json'));
            
            for (const fallbackFileName of fallbackFiles) {
              try {
                const fallbackPath = path.join(fallbackDir, fallbackFileName);
                const fallbackData = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
                
                // Check if this fallback file matches our deleted file
                const shouldDelete = keysToRemove.some(key => 
                  fallbackData.id === key ||
                  fallbackData.ipfsHash === key ||
                  fallbackData.name === key ||
                  fallbackData.originalName === key
                );
                
                if (shouldDelete) {
                  fs.unlinkSync(fallbackPath);
                  console.log(`[IPFS Independent] Removed matching fallback file: ${fallbackFileName}`);
                }
              } catch (parseError) {
                console.warn(`[IPFS Independent] Error checking fallback file ${fallbackFileName}: ${parseError.message}`);
              }
            }
          }
        } catch (fallbackError) {
          console.warn(`[IPFS Independent] Error removing fallback files: ${fallbackError.message}`);
        }

        // Optionally unpin from IPFS if it's pinned
        if (ipfsManager.isEnabled() && fileData.ipfsHash) {
          try {
            const isPinned = await ipfsManager.isPinned(fileData.ipfsHash);
            if (isPinned) {
              await ipfsManager.unpin(fileData.ipfsHash);
              console.log(
                `[IPFS Independent] Unpinned file from IPFS: ${fileData.ipfsHash}`
              );
            }
          } catch (ipfsError) {
            console.warn(
              `[IPFS Independent] Error unpinning file: ${ipfsError.message}`
            );
            // Continue anyway since we're removing from database
          }
        }

        console.log(`[IPFS Independent] Successfully deleted independent file: ${actualKey}`);

        return res.json({
          success: true,
          message: "Independent IPFS file deleted successfully",
          fileId: actualKey,
          ipfsHash: fileData.ipfsHash,
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

  // ===== FILE HASH INFO ENDPOINTS =====

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

  // API - SYNC FALLBACK FILES TO GUNDB
  router.post("/sync-fallback", authenticateRequestMiddleware, async (req, res) => {
    try {
      const fallbackDir = './radata/ipfs-fallback';
      let syncedCount = 0;
      let errorCount = 0;
      const results = [];

      if (!fs.existsSync(fallbackDir)) {
        return res.json({
          success: true,
          message: "No fallback directory found",
          syncedCount: 0,
          errorCount: 0,
          results: []
        });
      }

      // Get gun instance
      let gun;
      if (fileManager && fileManager.config && fileManager.config.gun) {
        gun = fileManager.config.gun;
      } else {
        gun = new Gun([`http://localhost:${process.env.PORT || 8765}/gun`]);
      }

      const fallbackFiles = fs.readdirSync(fallbackDir);
      console.log(`[IPFS Sync] Attempting to sync ${fallbackFiles.length} fallback files to GunDB...`);

      for (const fallbackFile of fallbackFiles) {
        if (fallbackFile.endsWith('.json')) {
          try {
            const fallbackPath = path.join(fallbackDir, fallbackFile);
            const fallbackData = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
            
            if (fallbackData.independent && fallbackData.ipfsHash) {
              // Try to save to GunDB
              await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                  reject(new Error('Sync timeout'));
                }, 5000);
                
                gun
                  .get("ipfs-files")
                  .get(fallbackData.ipfsHash)
                  .put(fallbackData, (ack) => {
                    clearTimeout(timeout);
                    if (ack.err) {
                      reject(new Error(ack.err));
                    } else {
                      resolve();
                    }
                  });
              });
              
              // If successful, delete the fallback file
              fs.unlinkSync(fallbackPath);
              syncedCount++;
              results.push({
                ipfsHash: fallbackData.ipfsHash,
                name: fallbackData.originalName,
                status: 'synced'
              });
              console.log(`[IPFS Sync] Synced and removed fallback: ${fallbackData.ipfsHash}`);
              
            } else {
              results.push({
                file: fallbackFile,
                status: 'skipped',
                reason: 'Invalid data'
              });
            }
          } catch (syncError) {
            errorCount++;
            results.push({
              file: fallbackFile,
              status: 'error',
              error: syncError.message
            });
            console.error(`[IPFS Sync] Error syncing ${fallbackFile}: ${syncError.message}`);
          }
        }
      }

      console.log(`[IPFS Sync] Sync completed: ${syncedCount} synced, ${errorCount} errors`);

      return res.json({
        success: true,
        message: `Sync completed: ${syncedCount} files synced, ${errorCount} errors`,
        syncedCount,
        errorCount,
        results
      });
    } catch (error) {
      console.error(`[IPFS Sync] Error during sync: ${error.message}`);
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error syncing fallback files"
      });
    }
  });

  // API - IPFS FILE EXISTENCE CHECK (HEAD request)
  router.head(
    "/files/:hash",
    authenticateRequestMiddleware,
    async (req, res) => {
      try {
        const hash = req.params.hash;
        console.log(`[IPFS API] HEAD request for file: ${hash}`);
        
        if (!hash) {
          console.log(`[IPFS API] HEAD request missing hash`);
          return res.status(400).end();
        }

        // First check if file exists in our database (GunDB)
        let gun;
        if (fileManager && fileManager.config && fileManager.config.gun) {
          gun = fileManager.config.gun;
        } else {
          gun = new Gun([`http://localhost:${process.env.PORT || 8765}/gun`]);
        }

        let fileExists = false;
        
        // Quick check in ipfs-files collection
        try {
          await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              console.log(`[IPFS API] HEAD timeout for ${hash}`);
              resolve();
            }, 2000);
            
            gun.get("ipfs-files").get(hash).once((data) => {
              clearTimeout(timeout);
              if (data && data.independent && data.ipfsHash === hash) {
                console.log(`[IPFS API] HEAD found file in GunDB: ${hash}`);
                fileExists = true;
              }
              resolve();
            });
          });
        } catch (gunError) {
          console.warn(`[IPFS API] HEAD GunDB error for ${hash}: ${gunError.message}`);
        }

        // Also check fallback files
        if (!fileExists) {
          try {
            const fallbackDir = './radata/ipfs-fallback';
            const fallbackFile = path.join(fallbackDir, `${hash}.json`);
            
            if (fs.existsSync(fallbackFile)) {
              const fallbackData = JSON.parse(fs.readFileSync(fallbackFile, 'utf8'));
              if (fallbackData.independent && fallbackData.ipfsHash === hash) {
                console.log(`[IPFS API] HEAD found file in fallback: ${hash}`);
                fileExists = true;
              }
            }
          } catch (fallbackError) {
            console.warn(`[IPFS API] HEAD fallback error for ${hash}: ${fallbackError.message}`);
          }
        }

        // If found in database, return success
        if (fileExists) {
          console.log(`[IPFS API] HEAD success for ${hash}`);
          res.status(200).end();
          return;
        }

        // If IPFS is enabled, also check IPFS directly
        if (ipfsManager.isEnabled()) {
          try {
            const ipfsExists = await ipfsManager.fileExists(hash);
            if (ipfsExists) {
              console.log(`[IPFS API] HEAD found file in IPFS: ${hash}`);
              res.status(200).end();
              return;
            }
          } catch (ipfsError) {
            console.warn(`[IPFS API] HEAD IPFS check error for ${hash}: ${ipfsError.message}`);
          }
        }

        console.log(`[IPFS API] HEAD file not found: ${hash}`);
        res.status(404).end();
        
      } catch (error) {
        console.error(`[IPFS API] HEAD error for ${req.params.hash}:`, error);
        res.status(500).end();
      }
    }
  );

  // API - IPFS FILE RETRIEVAL (GET request)
  router.get(
    "/files/:hash",
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
          return res.status(503).json({
            success: false,
            error: "IPFS not active",
            message: "IPFS service not enabled",
          });
        }

        // Try to retrieve file metadata and content
        const fileInfo = await ipfsManager.getFileInfo(hash);
        
        if (!fileInfo) {
          return res.status(404).json({
            success: false,
            error: "File not found",
            message: "IPFS file not found or not accessible",
          });
        }

        return res.json({
          success: true,
          file: fileInfo,
          hash,
          message: "File retrieved successfully",
        });
      } catch (error) {
        console.error(`[IPFS API] Error retrieving file ${req.params.hash}:`, error);
        return res.status(500).json({
          success: false,
          error: error.message,
          message: "Error retrieving IPFS file",
        });
      }
    }
  );

  // API - RECOVER IPFS FILES FROM FALLBACK
  router.post("/recover-fallback", authenticateRequestMiddleware, async (req, res) => {
    try {
      console.log('[IPFS Recovery] Starting recovery of files from fallback...');
      
      const fallbackDir = './radata/ipfs-fallback';
      if (!fs.existsSync(fallbackDir)) {
        return res.json({
          success: true,
          message: 'No fallback directory found',
          recovered: 0,
          total: 0
        });
      }
      
      const fallbackFiles = fs.readdirSync(fallbackDir).filter(f => f.endsWith('.json') && f !== 'recovery.log');
      console.log(`[IPFS Recovery] Found ${fallbackFiles.length} fallback files`);
      
      if (fallbackFiles.length === 0) {
        return res.json({
          success: true,
          message: 'No fallback files to recover',
          recovered: 0,
          total: 0
        });
      }
      
      // Get gun instance
      let gun;
      if (fileManager && fileManager.config && fileManager.config.gun) {
        gun = fileManager.config.gun;
      } else {
        gun = new Gun([`http://localhost:${process.env.PORT || 8765}/gun`]);
      }
      
      let recovered = 0;
      let errors = [];
      
      for (const file of fallbackFiles) {
        try {
          const filePath = path.join(fallbackDir, file);
          const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          
          console.log(`[IPFS Recovery] Recovering: ${fileData.originalName} (${fileData.ipfsHash})`);
          
          // Try to save to main database
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              console.warn(`[IPFS Recovery] Timeout for ${fileData.ipfsHash}`);
              resolve(); // Don't fail the whole operation
            }, 8000);
            
            gun
              .get("ipfs-files")
              .get(fileData.ipfsHash)
              .put(fileData, (ack) => {
                clearTimeout(timeout);
                if (ack.err) {
                  console.warn(`[IPFS Recovery] Error for ${fileData.ipfsHash}: ${ack.err}`);
                  errors.push(`${fileData.originalName}: ${ack.err}`);
                } else {
                  console.log(`[IPFS Recovery] Successfully recovered: ${fileData.ipfsHash}`);
                  recovered++;
                  
                  // Move the fallback file to a 'recovered' subdirectory
                  try {
                    const recoveredDir = path.join(fallbackDir, 'recovered');
                    if (!fs.existsSync(recoveredDir)) {
                      fs.mkdirSync(recoveredDir, { recursive: true });
                    }
                    
                    const recoveredPath = path.join(recoveredDir, file);
                    fs.renameSync(filePath, recoveredPath);
                    console.log(`[IPFS Recovery] Moved to recovered: ${recoveredPath}`);
                  } catch (moveError) {
                    console.warn(`[IPFS Recovery] Could not move file: ${moveError.message}`);
                  }
                }
                resolve();
              });
          });
          
        } catch (fileError) {
          console.error(`[IPFS Recovery] Error processing ${file}: ${fileError.message}`);
          errors.push(`${file}: ${fileError.message}`);
        }
      }
      
      console.log(`[IPFS Recovery] Recovery completed: ${recovered}/${fallbackFiles.length} files recovered`);
      
      return res.json({
        success: true,
        message: `Recovery completed: ${recovered} files recovered`,
        recovered: recovered,
        total: fallbackFiles.length,
        errors: errors.length > 0 ? errors : undefined
      });
      
    } catch (error) {
      console.error(`[IPFS Recovery] Recovery error: ${error.message}`);
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error during fallback recovery"
      });
    }
  });

  // API - LIST FALLBACK FILES
  router.get("/fallback-files", authenticateRequestMiddleware, async (req, res) => {
    try {
      const fallbackDir = './radata/ipfs-fallback';
      if (!fs.existsSync(fallbackDir)) {
        return res.json({
          success: true,
          files: [],
          count: 0,
          message: 'No fallback directory found'
        });
      }
      
      const fallbackFiles = fs.readdirSync(fallbackDir).filter(f => f.endsWith('.json'));
      const files = [];
      
      for (const file of fallbackFiles) {
        try {
          const filePath = path.join(fallbackDir, file);
          const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          const stats = fs.statSync(filePath);
          
          files.push({
            fallbackFile: file,
            ipfsHash: fileData.ipfsHash,
            originalName: fileData.originalName,
            size: fileData.size,
            uploadedAt: fileData.uploadedAt,
            fallbackCreated: stats.mtime,
            independent: fileData.independent
          });
        } catch (parseError) {
          console.warn(`[IPFS Fallback] Error parsing ${file}: ${parseError.message}`);
        }
      }
      
      return res.json({
        success: true,
        files: files,
        count: files.length,
        message: `Found ${files.length} files in fallback`
      });
      
    } catch (error) {
      console.error(`[IPFS Fallback] Error listing fallback files: ${error.message}`);
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error listing fallback files"
      });
    }
  });

  return router;
}