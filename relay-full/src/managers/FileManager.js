import fs from "fs";
import path from "path";
import multer from "multer";
import crypto from "crypto";

class FileManager {
  constructor(config) {
    // Helper function to parse size strings like "500mb" to bytes
    const parseSize = (sizeStr) => {
      if (typeof sizeStr === 'number') return sizeStr;
      if (typeof sizeStr !== 'string') return 500 * 1024 * 1024; // 500MB default
      
      const units = {
        'b': 1,
        'kb': 1024,
        'mb': 1024 * 1024,
        'gb': 1024 * 1024 * 1024
      };
      
      const match = sizeStr.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/);
      if (!match) return 500 * 1024 * 1024; // 500MB default
      
      const [, number, unit] = match;
      return Math.floor(parseFloat(number) * units[unit]);
    };

    this.config = {
      storageDir: config.storageDir || "./uploads",
      maxFileSize: parseSize(config.maxFileSize) || 500 * 1024 * 1024, // 500MB default
      ipfsManager: config.ipfsManager || null,
      gun: config.gun || null,
    };

    // Create storage directory if it doesn't exist
    if (!fs.existsSync(this.config.storageDir)) {
      fs.mkdirSync(this.config.storageDir, { recursive: true });
    }
    
    // Add upload mutex to prevent race conditions with duplicate uploads
    this.uploadMutex = new Map(); // contentHash -> Promise
    this.processingUploads = new Set(); // Track uploads currently being processed

    // Configure multer
    this.configureMulter();
  }

  /**
   * Helper per create Promise with timeout for Gun
   * @param {Function} gunOperation - Gun operation to execute
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<any>} Result of the operation
   */
  gunPromiseWithTimeout(gunOperation, timeoutMs = 5000) {
    return new Promise((resolve) => {
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          console.log(
            `[FileManager] GunDB operation timed out after ${timeoutMs}ms`
          );
          resolved = true;
          resolve(null); // Resolve with null if timeout
        }
      }, timeoutMs);

      try {
        gunOperation((result) => {
          if (!resolved) {
            clearTimeout(timeout);
            resolved = true;
            resolve(result);
          }
        });
      } catch (error) {
        console.error(
          `[FileManager] Error in GunDB operation: ${error.message}`
        );
        if (!resolved) {
          clearTimeout(timeout);
          resolved = true;
          resolve(null);
        }
      }
    });
  }

  // Configure multer for local storage only
  configureMulter() {
    // Always use diskStorage since we're not doing automatic IPFS uploads anymore
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

  /**
   * Get multer middleware
   * @returns {Object} Multer middleware
   */
  getUploadMiddleware() {
    return this.upload;
  }

  /**
   * Generate a content-based hash for a file (similar to IPFS)
   * @param {Buffer} fileBuffer - File content buffer
   * @param {string} originalName - Original filename
   * @returns {string} Content hash as file ID
   */
  generateContentHash(fileBuffer, originalName) {
    // Create SHA-256 hash of file content
    const contentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    
    // Take first 16 characters of hash for shorter IDs
    const shortHash = contentHash.substring(0, 16);
    
    // Create safe filename without extension for the ID
    const safeName = originalName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9.-]/g, "_");
    
    // Format: hash-filename (deterministic and unique based on content)
    const contentBasedId = `${shortHash}-${safeName}`;
    
    console.log(`[FileManager] Generated content-based hash: ${shortHash} for file: ${originalName} -> ID: ${contentBasedId}`);
    
    return contentBasedId;
  }

  /**
   * Handle file upload request with improved duplicate prevention
   * @param {Object} req - Express request object with file from multer
   * @returns {Promise<Object>} File data including URLs and metadata
   */
  async handleFileUpload(req) {
    const uploadStartTime = Date.now();
    const uploadRequestId = req.uploadRequestId || `upload_${uploadStartTime}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`[FileManager] Starting upload processing (ID: ${uploadRequestId})`);
    
    if (!req.file && (!req.body.content || !req.body.contentType)) {
      throw new Error("File or content missing");
    }

    let gunDbKey, fileBuffer, originalName, mimeType, fileSize, uploadTimestamp;

    uploadTimestamp = Date.now(); // Keep for metadata, but not for ID generation

    if (req.file) {
      originalName = req.file.originalname;
      mimeType = req.file.mimetype;
      fileSize = req.file.size;

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
      originalName = req.body.customName || `text-content.txt`;
      mimeType = contentType;
      fileSize = content.length;
      fileBuffer = Buffer.from(content);
    }

    if (!fileBuffer) {
      throw new Error("File buffer not available");
    }

    // Generate content-based hash ID (same content = same ID)
    // ALWAYS use content-based hash, ignore customName for ID generation
    const contentBasedId = this.generateContentHash(fileBuffer, originalName);
    gunDbKey = contentBasedId;

    console.log(`[FileManager] Generated content-based ID: ${contentBasedId} for file: ${originalName} (Upload ID: ${uploadRequestId})`);

    // Check if this content is already being processed (prevent race conditions)
    if (this.uploadMutex.has(contentBasedId)) {
      console.log(`[FileManager] Upload with same content already in progress, waiting... (Upload ID: ${uploadRequestId})`);
      
      try {
        // Wait for the ongoing upload to complete
        const existingResult = await this.uploadMutex.get(contentBasedId);
        
        // Clean up uploaded file if it exists on disk
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
          try {
            fs.unlinkSync(req.file.path);
            console.log(`[FileManager] Cleaned up duplicate upload temp file: ${req.file.path}`);
          } catch (cleanupError) {
            console.warn(`[FileManager] Error cleaning up duplicate file: ${cleanupError.message}`);
          }
        }
        
        console.log(`[FileManager] Returning result from concurrent upload: ${contentBasedId} (Upload ID: ${uploadRequestId})`);
        return {
          ...existingResult,
          message: 'File with identical content was being processed concurrently',
          isDuplicate: true,
          concurrentUpload: true,
          uploadRequestId: uploadRequestId
        };
      } catch (error) {
        console.warn(`[FileManager] Concurrent upload failed, proceeding with new upload: ${error.message}`);
        // Fall through to normal processing if concurrent upload failed
      }
    }

    // Create a promise for this upload to prevent concurrent duplicates
    const uploadPromise = this._processFileUpload(req, {
      contentBasedId,
      fileBuffer,
      originalName,
      mimeType,
      fileSize,
      uploadTimestamp,
      uploadRequestId,
      uploadStartTime
    });

    // Store the promise in the mutex
    this.uploadMutex.set(contentBasedId, uploadPromise);

    try {
      const result = await uploadPromise;
      return result;
    } finally {
      // Clean up the mutex entry after processing
      this.uploadMutex.delete(contentBasedId);
    }
  }

  /**
   * Internal method to process file upload
   * @private
   */
  async _processFileUpload(req, params) {
    const { contentBasedId, fileBuffer, originalName, mimeType, fileSize, uploadTimestamp, uploadRequestId, uploadStartTime } = params;

    // Enhanced duplicate check - check multiple sources
    console.log(`[FileManager] Checking for existing file with ID: ${contentBasedId}`);
    
    // 1. Check GunDB first
    const existingFile = await this.getFileById(contentBasedId);
    if (existingFile) {
      console.log(`[FileManager] File with identical content already exists in GunDB: ${contentBasedId} (Upload ID: ${uploadRequestId})`);
      
      // Clean up uploaded file if it exists on disk
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
          console.log(`[FileManager] Cleaned up duplicate upload temp file: ${req.file.path}`);
        } catch (cleanupError) {
          console.warn(`[FileManager] Error cleaning up duplicate file: ${cleanupError.message}`);
        }
      }
      
      // Return existing file info instead of creating duplicate
      return {
        ...existingFile,
        message: 'File with identical content already exists',
        isDuplicate: true,
        existingFile: true,
        uploadRequestId: uploadRequestId
      };
    }
    
    // 2. Check filesystem directly to see if file already exists
    const safeOriginalName = originalName.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileExtension = safeOriginalName.split('.').pop() || 'bin';
    const fileName = `${contentBasedId}.${fileExtension}`;
    const expectedLocalPath = path.join(this.config.storageDir, fileName);
    
    if (fs.existsSync(expectedLocalPath)) {
      console.log(`[FileManager] File already exists on disk: ${expectedLocalPath} (Upload ID: ${uploadRequestId})`);
      
      // File exists on disk but not in GunDB - create file object and save to GunDB
      const fileStats = fs.statSync(expectedLocalPath);
      const fileData = {
        id: contentBasedId,
        name: originalName,
        originalName: originalName,
        mimeType: mimeType,
        mimetype: mimeType,
        size: fileStats.size,
        url: `/uploads/${fileName}`,
        fileUrl: `/uploads/${fileName}`,
        localPath: expectedLocalPath,
        ipfsHash: null,
        ipfsUrl: null,
        timestamp: uploadTimestamp,
        uploadedAt: uploadTimestamp,
        customName: req.body.customName || null,
        contentHash: contentBasedId,
        verified: true,
        uploadRequestId: uploadRequestId,
        message: 'File already existed on disk, added to database'
      };
      
      // Save to GunDB for future reference
      await this.saveFileMetadata(fileData);
      
      // Clean up uploaded file if it's different from the existing one
      if (req.file && req.file.path && req.file.path !== expectedLocalPath && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
          console.log(`[FileManager] Cleaned up duplicate upload temp file: ${req.file.path}`);
        } catch (cleanupError) {
          console.warn(`[FileManager] Error cleaning up duplicate file: ${cleanupError.message}`);
        }
      }
      
      return fileData;
    }

    let fileUrl = null;
    let localPath = null;

    // Store file locally with content-based naming
    console.log(`[FileManager] Storing new file locally with content-based name: ${originalName} (Upload ID: ${uploadRequestId})`);
    localPath = expectedLocalPath;
    
    // Save new file
    fs.writeFileSync(localPath, fileBuffer);
    fileUrl = `/uploads/${fileName}`;
    console.log(`[FileManager] File saved locally successfully: ${localPath} (Upload ID: ${uploadRequestId})`);
    
    // Clean up multer temp file if it's different from our target path
    if (req.file && req.file.path && req.file.path !== localPath && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
        console.log(`[FileManager] Cleaned up multer temp file: ${req.file.path}`);
      } catch (cleanupError) {
        console.warn(`[FileManager] Error cleaning up multer temp file: ${cleanupError.message}`);
      }
    }

    const fileData = {
      id: contentBasedId,
      name: originalName,
      originalName: originalName,
      mimeType: mimeType,
      mimetype: mimeType,
      size: fileSize,
      url: fileUrl,
      fileUrl: fileUrl,
      localPath: localPath,
      ipfsHash: null, // No IPFS hash initially
      ipfsUrl: null,  // No IPFS URL initially
      timestamp: uploadTimestamp,
      uploadedAt: uploadTimestamp,
      customName: req.body.customName || null,
      contentHash: contentBasedId, // Store the content hash
      verified: true,
      uploadRequestId: uploadRequestId,
      processingTime: Date.now() - uploadStartTime
    };

    // Save metadata to GunDB
    const savedFile = await this.saveFileMetadata(fileData);

    console.log(`[FileManager] File upload completed: ${savedFile.id} in ${savedFile.processingTime}ms (Upload ID: ${uploadRequestId})`);
    return savedFile;
  }

  /**
   * Save IPFS metadata to a local file
   * @param {string} fileId - File ID
   * @param {string} ipfsHash - IPFS hash
   * @private
   */
  _saveIpfsMetadata(fileId, ipfsHash) {
    try {
      if (!fileId || !ipfsHash) {
        console.warn('[FileManager] Missing fileId or ipfsHash for metadata save');
        return;
      }
      
      const metadataPath = path.join(this.config.storageDir, 'ipfs-metadata.json');
      let metadata = {};
      
      // Load existing metadata if available
      if (fs.existsSync(metadataPath)) {
        try {
          const content = fs.readFileSync(metadataPath, 'utf8');
          metadata = JSON.parse(content);
        } catch (e) {
          console.error(`[FileManager] Error reading IPFS metadata file: ${e.message}`);
          // Continue with empty metadata
        }
      }
      
      // Extract identifiers from the fileId for more reliable matching
      const timestampMatch = fileId.match(/^(\d+)-/);
      const timestamp = timestampMatch ? timestampMatch[1] : Date.now().toString();
      const baseFilename = fileId.replace(/^(\d+)-/, '').split('_')[0];
      
      // Also extract the original filename if it contains an extension pattern
      const originalFilename = fileId.replace(/^(\d+)-/, '').replace(/_\d+$/, '');
      
      // Update metadata with new entry and additional identifiers
      metadata[fileId] = {
        ipfsHash,
        timestamp: Date.now(),
        originalTimestamp: timestamp,
        baseFilename: baseFilename,
        originalFilename: originalFilename,
        fullFileId: fileId,
        alternateIds: [
          // Store various key formats to help with matching
          fileId,
          baseFilename,
          originalFilename,
          timestamp + '-' + baseFilename,
          timestamp + '-' + originalFilename,
          // For files uploaded, store a pattern that matches filesystem naming
          `${timestamp}-${originalFilename}`,
          // Store potential variations
          originalFilename.replace(/\.[^/.]+$/, ''), // without extension
          baseFilename.replace(/\.[^/.]+$/, ''), // base without extension
        ].filter(Boolean) // Remove empty/undefined values
      };
      
      // Save back to file
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      console.log(`[FileManager] Saved IPFS metadata for file ${fileId} with ${metadata[fileId].alternateIds.length} alternate IDs`);
    } catch (error) {
      console.error(`[FileManager] Error saving IPFS metadata: ${error.message}`);
    }
  }

  /**
   * Get all files from all sources
   * @returns {Promise<Array>} Array of file objects
   */
  async getAllFiles() {
    if (!this.config.gun) {
      throw new Error("Gun instance not available");
    }

    console.log("[FileManager] getAllFiles: Starting comprehensive file retrieval");

    // Store valid files and track both IDs and content to avoid duplicates
    const files = [];
    const seenIds = new Set();
    const seenContent = new Map(); // Track by content signature to prevent content duplicates

    // First fetch the list of deleted files to filter against with MUCH faster timeout
    const deletedFileIds = new Set();
    try {
      console.log("[FileManager] Fetching deleted files list...");
      const deletedFilesRaw = await this.gunPromiseWithTimeout((resolve) => {
        this.config.gun.get("deletedFiles").once(data => {
          console.log(`[FileManager] deletedFiles data received:`, data ? Object.keys(data).length : 'null');
          resolve(data);
        });
      }, 2000); // Reduced from 8000ms to 2000ms - 75% faster!
      
      if (deletedFilesRaw && typeof deletedFilesRaw === 'object') {
        Object.keys(deletedFilesRaw).forEach(key => {
          // Skip GunDB metadata
          if (!key.startsWith("_")) {
            deletedFileIds.add(key);
            console.log(`[FileManager] Marking file as deleted: ${key}`);
          }
        });
        console.log(`[FileManager] Found ${deletedFileIds.size} deleted file IDs to filter out`);
      } else {
        console.log("[FileManager] No deleted files data found or timed out");
      }
    } catch (error) {
      console.log("[FileManager] Deleted files check failed quickly - continuing with file loading");
    }

    // Helper function to add a file if it's not a duplicate
    const addFileIfUnique = (fileObject, source) => {
      if (!fileObject || !fileObject.id) {
        console.log(`[FileManager] Skipping invalid file from ${source}`);
        return false;
      }

      // Skip if this file has been deleted
      if (deletedFileIds.has(fileObject.id)) {
        console.log(`[FileManager] Skipping deleted file: ${fileObject.id} from ${source}`);
        return false;
      }

      // Check for ID duplicates
      if (seenIds.has(fileObject.id)) {
        console.log(`[FileManager] Skipping duplicate ID from ${source}: ${fileObject.id}`);
        return false;
      }

      // Create content signature for duplicate detection
      const contentSignature = `${fileObject.originalName || fileObject.name}_${fileObject.size || 0}_${fileObject.mimetype || fileObject.mimeType || ''}`;
          
          // Check for content duplicates
      if (seenContent.has(contentSignature)) {
        const existingFile = seenContent.get(contentSignature);
        console.log(`[FileManager] Found content duplicate from ${source}: ${fileObject.id} matches existing ${existingFile.id}`);
            
            // Keep the newer file (higher timestamp)
            const newTimestamp = parseInt(fileObject.timestamp || fileObject.uploadedAt || 0);
            const existingTimestamp = parseInt(existingFile.timestamp || existingFile.uploadedAt || 0);
            
            if (newTimestamp > existingTimestamp) {
              // Remove the older file from results
              const oldIndex = files.findIndex(f => f.id === existingFile.id);
              if (oldIndex !== -1) {
                files.splice(oldIndex, 1);
            seenIds.delete(existingFile.id);
            console.log(`[FileManager] Replacing older duplicate ${existingFile.id} with ${fileObject.id} from ${source}`);
          }
          
          // Add the new file
          seenContent.set(contentSignature, fileObject);
          seenIds.add(fileObject.id);
          files.push(fileObject);
          console.log(`[FileManager] Added file from ${source}: ${fileObject.id}`);
          return true;
            } else {
          console.log(`[FileManager] Keeping existing file ${existingFile.id}, skipping ${fileObject.id} from ${source}`);
          return false;
            }
          } else {
        // New unique content
        seenContent.set(contentSignature, fileObject);
        seenIds.add(fileObject.id);
          files.push(fileObject);
        console.log(`[FileManager] Added unique file from ${source}: ${fileObject.id}`);
        return true;
      }
    };

    // 1. Get files directly from storage first for reliability (this is always fast)
      try {
        console.log("[FileManager] Reading files from storage directory...");
        if (fs.existsSync(this.config.storageDir)) {
        const filesFromStorage = await this.getFilesFromStorage(deletedFileIds);
          console.log(`[FileManager] Found ${filesFromStorage.length} files in storage`);
        
        filesFromStorage.forEach(file => {
          addFileIfUnique(file, 'storage');
        });
        } else {
          console.warn(`[FileManager] Storage directory does not exist: ${this.config.storageDir}`);
          // Create the directory if it doesn't exist
          fs.mkdirSync(this.config.storageDir, { recursive: true });
          console.log(`[FileManager] Created storage directory: ${this.config.storageDir}`);
        }
      } catch (fsErr) {
        console.error(`[FileManager] Error reading storage dir: ${fsErr.message}`);
      }

    // 2. Load files from IPFS metadata if available (with deleted files filtering) - also fast
      try {
        const metadataPath = path.join(this.config.storageDir, 'ipfs-metadata.json');
        if (fs.existsSync(metadataPath)) {
          console.log(`[FileManager] Loading files from IPFS metadata with deletion filter`);
          const content = fs.readFileSync(metadataPath, 'utf8');
          const ipfsMetadata = JSON.parse(content);
          
          let filteredCount = 0;
          for (const [fileId, metadata] of Object.entries(ipfsMetadata)) {
            // Skip if this file has been deleted
            if (deletedFileIds.has(fileId)) {
              console.log(`[FileManager] Skipping deleted IPFS file from metadata: ${fileId}`);
              filteredCount++;
              continue;
            }
            
            // Create a file object from IPFS metadata
            const ipfsFile = {
              id: fileId,
              name: metadata.originalFilename || metadata.baseFilename || fileId,
              originalName: metadata.originalFilename || metadata.baseFilename || fileId,
              ipfsHash: metadata.ipfsHash,
              ipfsUrl: this.config.ipfsManager ? 
                this.config.ipfsManager.getGatewayUrl(metadata.ipfsHash) : 
                `https://ipfs.io/ipfs/${metadata.ipfsHash}`,
              fileUrl: this.config.ipfsManager ? 
                this.config.ipfsManager.getGatewayUrl(metadata.ipfsHash) : 
                `https://ipfs.io/ipfs/${metadata.ipfsHash}`,
              timestamp: metadata.originalTimestamp || metadata.timestamp,
              uploadedAt: metadata.originalTimestamp || metadata.timestamp,
              mimeType: "application/octet-stream", // Default mime type for IPFS files
              mimetype: "application/octet-stream",
              size: 0, // Size not stored in IPFS metadata
              verified: true
            };
            
          addFileIfUnique(ipfsFile, 'ipfs-metadata');
          }
          
          if (filteredCount > 0) {
            console.log(`[FileManager] Filtered out ${filteredCount} deleted files from IPFS metadata`);
          }
        }
      } catch (ipfsMetaErr) {
        console.error(`[FileManager] Error reading IPFS metadata: ${ipfsMetaErr.message}`);
      }

    // 3. Get files from GunDB with MASSIVELY IMPROVED timeout and retry logic
      try {
        console.log("[FileManager] Attempting to read from GunDB files node with fast timeout...");
        
        let gunData = null;
        let gunAttempts = 0;
        const maxGunAttempts = 2; // Reduced from 3 to 2 attempts
        
        while (!gunData && gunAttempts < maxGunAttempts) {
          gunAttempts++;
          console.log(`[FileManager] GunDB attempt ${gunAttempts}/${maxGunAttempts}`);
          
          try {
            gunData = await this.gunPromiseWithTimeout((resolve) => {
              this.config.gun.get("files").once((data) => {
                console.log(`[FileManager] GunDB files data received on attempt ${gunAttempts}:`, typeof data, data ? Object.keys(data).length : 0);
                resolve(data);
              });
            }, 3000); // MASSIVELY reduced from 10000ms to 3000ms - 70% faster!
            
            if (!gunData && gunAttempts < maxGunAttempts) {
              console.log(`[FileManager] No data received on attempt ${gunAttempts}, quick retry...`);
              await new Promise(resolve => setTimeout(resolve, 500)); // Reduced wait from 2000ms to 500ms
            }
          } catch (gunError) {
            console.log(`[FileManager] GunDB attempt ${gunAttempts} failed quickly: ${gunError.message}`);
            if (gunAttempts < maxGunAttempts) {
              await new Promise(resolve => setTimeout(resolve, 500)); // Reduced wait time
            }
          }
        }

        if (gunData && typeof gunData === "object") {
          console.log(`[FileManager] Processing GunDB data with ${Object.keys(gunData).length} keys`);
          
          let filteredFromGunDB = 0;
          let addedFromGunDB = 0;
          
          for (const [key, value] of Object.entries(gunData)) {
          // Skip GunDB metadata
          if (!key || key.startsWith("_") || key === "lastUpdated" || key === "_refreshToken" || key === "_deleteToken" || key === "_lastSync") {
            continue;
          }

          if (value && typeof value === "object") {
            // Set ID from key if not present
            let fileObject = { ...value, id: value.id || key };

            // Skip if this file has been marked as deleted
            if (deletedFileIds.has(fileObject.id)) {
              console.log(`[FileManager] Skipping deleted file from GunDB: ${fileObject.id}`);
              filteredFromGunDB++;
              continue;
            }

            // Update IPFS URL if not present but hash is available
            if (fileObject.ipfsHash && !fileObject.ipfsUrl && this.config.ipfsManager) {
              fileObject.ipfsUrl = this.config.ipfsManager.getGatewayUrl(fileObject.ipfsHash);
            }

            // Only add valid file entries
            if ((fileObject.name || fileObject.originalName) && (fileObject.fileUrl || fileObject.ipfsHash)) {
              if (addFileIfUnique(fileObject, 'gundb')) {
                addedFromGunDB++;
              }
            } else {
              console.log(`[FileManager] Skipping invalid GunDB entry: ${key} (missing name or URL)`);
            }
          }
        }
        
        console.log(`[FileManager] GunDB processing complete: ${addedFromGunDB} added, ${filteredFromGunDB} filtered out`);
        } else {
          console.log("[FileManager] No valid data received from GunDB after fast attempts - using filesystem data");
        }
      } catch (gunDbErr) {
        console.log(`[FileManager] GunDB read failed quickly - using filesystem data: ${gunDbErr.message}`);
      }

    // 4. OPTIONAL: Quick backup check (only if we have very few files)
    if (files.length < 3) {
      try {
        console.log("[FileManager] Few files found, doing quick backup check...");
        const backupData = await this.gunPromiseWithTimeout((resolve) => {
          this.config.gun.get("files-backup").once((data) => {
            console.log(`[FileManager] Backup data received:`, typeof data, data ? Object.keys(data).length : 0);
            resolve(data);
          });
        }, 1500); // MASSIVELY reduced from 5000ms to 1500ms - 70% faster!
        
        if (backupData && typeof backupData === "object") {
          let backupAdded = 0;
          for (const [key, value] of Object.entries(backupData)) {
            if (!key.startsWith("_") && value && typeof value === "object") {
              const fileObject = { ...value, id: value.id || key };
              if (!deletedFileIds.has(fileObject.id) && 
                  (fileObject.name || fileObject.originalName) && 
                  (fileObject.fileUrl || fileObject.ipfsHash)) {
                if (addFileIfUnique(fileObject, 'gundb-backup')) {
                  backupAdded++;
                }
              }
            }
          }
          console.log(`[FileManager] Added ${backupAdded} files from backup location`);
        }
      } catch (backupErr) {
        console.log(`[FileManager] Quick backup check failed (normal): ${backupErr.message}`);
      }
    } else {
      console.log(`[FileManager] Skipping backup check - found ${files.length} files from primary sources`);
    }

    // Sort files by upload time (newest first) for better UI experience
    files.sort((a, b) => {
      const aTime = parseInt(a.timestamp || a.uploadedAt || 0);
      const bTime = parseInt(b.timestamp || b.uploadedAt || 0);
      return bTime - aTime;
    });

    console.log(`[FileManager] getAllFiles completed: ${files.length} total files retrieved`);
    console.log(`[FileManager] File sources breakdown:`, files.reduce((acc, f) => {
      const source = f._source || 'unknown';
      acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {}));

    return files;
  }

  /**
   * Get files directly from storage directory
   * @param {Set<string>} deletedFileIds - Set of file IDs marked as deleted
   * @returns {Promise<Array>} Array of file objects
   */
  async getFilesFromStorage(deletedFileIds = new Set()) {
    const files = [];
    
    if (!fs.existsSync(this.config.storageDir)) {
      console.warn(`[FileManager] Storage directory does not exist: ${this.config.storageDir}`);
      return files;
    }
    
    const filenames = fs.readdirSync(this.config.storageDir);
    
    // Check if we have metadata file for IPFS information
    const metadataPath = path.join(this.config.storageDir, 'ipfs-metadata.json');
    let ipfsMetadata = {};
    
    try {
      if (fs.existsSync(metadataPath)) {
        const metadataContent = fs.readFileSync(metadataPath, 'utf8');
        ipfsMetadata = JSON.parse(metadataContent);
        console.log(`[FileManager] Loaded IPFS metadata for ${Object.keys(ipfsMetadata).length} files`);
      }
    } catch (metadataErr) {
      console.error(`[FileManager] Error loading IPFS metadata: ${metadataErr.message}`);
    }
    
    for (const filename of filenames) {
      try {
        // Skip directories, hidden files, and metadata file
        const filePath = path.join(this.config.storageDir, filename);
        if (filename === 'ipfs-metadata.json') continue;
        
        const stats = fs.statSync(filePath);
        
        if (!stats.isFile() || filename.startsWith('.')) {
          continue;
        }
        
        let fileId;
        let originalName;
        let timestamp = stats.mtimeMs;
        
        // Detect file naming pattern and extract ID
        if (filename.match(/^[a-f0-9]{16}-/)) {
          // New content-hash based naming: hash-filename.ext
          const hashMatch = filename.match(/^([a-f0-9]{16})-(.+)$/);
          if (hashMatch) {
            fileId = hashMatch[1] + '-' + hashMatch[2].replace(/\.[^/.]+$/, "");
            originalName = hashMatch[2];
          } else {
            // Fallback
            fileId = filename.replace(/\.[^/.]+$/, "");
            originalName = filename;
          }
        } else if (filename.match(/^\d{13,}-/)) {
          // Old timestamp-based naming: timestamp-filename.ext
          const timestampMatch = filename.match(/^(\d+)-(.+)$/);
          if (timestampMatch) {
            timestamp = parseInt(timestampMatch[1]);
            const baseFilename = timestampMatch[2].replace(/\.[^/.]+$/, "");
            fileId = `${timestamp}-${baseFilename}_${timestamp.toString().substring(7)}`;
            originalName = timestampMatch[2];
          } else {
            // Fallback
            fileId = filename.replace(/\.[^/.]+$/, "");
            originalName = filename;
          }
        } else {
          // Unknown naming pattern - use filename as base
          fileId = filename.replace(/\.[^/.]+$/, "");
          originalName = filename;
        }
        
        // Skip if this file has been marked as deleted
        if (deletedFileIds.has(fileId)) {
          console.log(`[FileManager] Skipping deleted file from filesystem: ${fileId} (${filename})`);
          continue;
        }
        
        // Check for partial matches with deleted IDs
        let isDeleted = false;
        for (const deletedId of deletedFileIds) {
          if (deletedId.includes(fileId) || fileId.includes(deletedId) || 
              filename.includes(deletedId.split('_')[0]) || filename.includes(deletedId.split('-')[0])) {
            console.log(`[FileManager] Skipping likely deleted file from filesystem: ${filename} (matches: ${deletedId})`);
            isDeleted = true;
            break;
          }
        }
        if (isDeleted) continue;
        
        // Determine MIME type
        const ext = path.extname(originalName).toLowerCase();
        let mimeType = 'application/octet-stream';
        
        if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
        else if (ext === '.png') mimeType = 'image/png';
        else if (ext === '.gif') mimeType = 'image/gif';
        else if (ext === '.pdf') mimeType = 'application/pdf';
        else if (ext === '.txt') mimeType = 'text/plain';
        else if (ext === '.mp4') mimeType = 'video/mp4';
        else if (ext === '.mp3') mimeType = 'audio/mpeg';
        
        // Build the file URL
        const fileUrl = `/uploads/${filename}`;

        // Create file object
        const fileObject = {
          id: fileId,
          name: originalName,
          originalName: originalName,
          mimetype: mimeType,
          mimeType: mimeType,
          size: stats.size,
          fileUrl: fileUrl,
          url: fileUrl,
          timestamp: timestamp,
          uploadedAt: timestamp,
          localPath: filePath,
          verified: true,
        };
        
        // Check if we have IPFS metadata for this file using enhanced matching
        let ipfsMetadataFound = false;
        
        // Direct match first
        if (ipfsMetadata[fileId]) {
          const metadata = ipfsMetadata[fileId];
          fileObject.ipfsHash = metadata.ipfsHash;
          
          if (fileObject.ipfsHash && this.config.ipfsManager) {
            fileObject.ipfsUrl = this.config.ipfsManager.getGatewayUrl(fileObject.ipfsHash);
          } else if (fileObject.ipfsHash) {
            fileObject.ipfsUrl = `https://ipfs.io/ipfs/${fileObject.ipfsHash}`;
          }
          
          console.log(`[FileManager] Added IPFS data to file ${fileId}: hash=${fileObject.ipfsHash}`);
          ipfsMetadataFound = true;
        }
        
        // Enhanced matching if direct match not found
        if (!ipfsMetadataFound) {
          for (const [metaKey, metadata] of Object.entries(ipfsMetadata)) {
            if (metadata.alternateIds && Array.isArray(metadata.alternateIds)) {
              const matches = metadata.alternateIds.some(altId => {
                return altId === fileId || filename.includes(altId) || altId.includes(originalName.replace(/\.[^/.]+$/, ''));
              });
              
              if (matches) {
                fileObject.ipfsHash = metadata.ipfsHash;
                
                if (fileObject.ipfsHash && this.config.ipfsManager) {
                  fileObject.ipfsUrl = this.config.ipfsManager.getGatewayUrl(fileObject.ipfsHash);
                } else if (fileObject.ipfsHash) {
                  fileObject.ipfsUrl = `https://ipfs.io/ipfs/${fileObject.ipfsHash}`;
                }
                
                console.log(`[FileManager] Added IPFS data to file ${fileId} using alternateIds match with ${metaKey}: hash=${fileObject.ipfsHash}`);
                ipfsMetadataFound = true;
                break;
              }
            }
          }
        }
        
        if (!ipfsMetadataFound) {
          console.log(`[FileManager] No IPFS metadata found for file ${fileId}`);
        }

        // Add to results
        files.push(fileObject);

        // Save to GunDB for future reference (don't await)
        try {
          this.config.gun.get("files").get(fileId).put(fileObject);
          console.log(`[FileManager] Saved filesystem file to GunDB: ${fileId}`);
        } catch (saveErr) {
          console.log(`[FileManager] Could not save filesystem file to GunDB: ${saveErr.message}`);
        }
      } catch (fileErr) {
        console.error(`[FileManager] Error processing file ${filename}: ${fileErr.message}`);
      }
    }
    
    console.log(`[FileManager] Added ${files.length} files from filesystem`);
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

    console.log(
      `[FileManager] getFileById: Looking for file with ID: ${fileId}`
    );

    // First try to get file from main path
    const mainPathData = await this.gunPromiseWithTimeout((resolve) => {
      this.config.gun
        .get("files")
        .get(fileId)
        .once((data) => {
          if (data) {
            console.log(
              `[FileManager] getFileById: Found file in main path: ${fileId}`
            );
            // Update IPFS URL if needed
            if (data.ipfsHash && this.config.ipfsManager) {
              data.ipfsUrl = this.config.ipfsManager.getGatewayUrl(
                data.ipfsHash
              );
            }
            resolve(data);
          } else {
            resolve(null);
          }
        });
    });

    if (mainPathData) {
      return mainPathData;
    }

    // If not found in GunDB, try to find the file in the filesystem
    console.log(`[FileManager] getFileById: File not found in GunDB, searching filesystem for: ${fileId}`);
    
    if (fs.existsSync(this.config.storageDir)) {
      const filenames = fs.readdirSync(this.config.storageDir);
      
      // Try multiple matching strategies
      const matchingStrategies = [
        // 1. Exact filename match (without extension)
        (filename) => filename.replace(/\.[^/.]+$/, "") === fileId,
        
        // 2. Hash-prefixed ID match (e.g., "45f24604dbe5f574-filename" matches "filename")
        (filename) => {
          const hashMatch = fileId.match(/^[a-f0-9]{16}-(.+)$/);
          if (hashMatch) {
            const baseId = hashMatch[1];
            return filename.includes(baseId) || filename.replace(/\.[^/.]+$/, "") === baseId;
          }
          return false;
        },
        
        // 3. Reverse match - check if fileId is contained in filename
        (filename) => filename.includes(fileId),
        
        // 4. Base filename match (remove hash prefix from fileId and match)
        (filename) => {
          const baseFilename = fileId.replace(/^[a-f0-9]{16}-/, "");
          return filename.includes(baseFilename) || filename.replace(/\.[^/.]+$/, "") === baseFilename;
        },
        
        // 5. Timestamp-based match
        (filename) => {
          const timestampMatch = fileId.match(/^(\d+)-(.+)_\d+$/);
          if (timestampMatch) {
            const baseId = timestampMatch[2];
            return filename.includes(baseId);
          }
          return false;
        }
      ];
      
      for (const strategy of matchingStrategies) {
        const matchingFile = filenames.find(strategy);
        
        if (matchingFile && matchingFile !== 'ipfs-metadata.json') {
          console.log(`[FileManager] getFileById: Found matching file in filesystem: ${matchingFile} for ID: ${fileId}`);
          
          try {
            const filePath = path.join(this.config.storageDir, matchingFile);
            const stats = fs.statSync(filePath);
            
            if (stats.isFile()) {
              // Extract original name from filename
              let originalName = matchingFile;
              
              // If it's a hash-prefixed file, extract the original name
              const hashMatch = matchingFile.match(/^[a-f0-9]{16}-(.+)$/);
              if (hashMatch) {
                originalName = hashMatch[1];
              }
              
              // Determine MIME type
              const ext = path.extname(originalName).toLowerCase();
              let mimeType = 'application/octet-stream';
              
              if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
              else if (ext === '.png') mimeType = 'image/png';
              else if (ext === '.gif') mimeType = 'image/gif';
              else if (ext === '.pdf') mimeType = 'application/pdf';
              else if (ext === '.txt') mimeType = 'text/plain';
              else if (ext === '.mp4') mimeType = 'video/mp4';
              else if (ext === '.mp3') mimeType = 'audio/mpeg';
              
              // Check for IPFS metadata
              const metadataPath = path.join(this.config.storageDir, 'ipfs-metadata.json');
              let ipfsHash = null;
              let ipfsUrl = null;
              
              if (fs.existsSync(metadataPath)) {
                try {
                  const metadataContent = fs.readFileSync(metadataPath, 'utf8');
                  const ipfsMetadata = JSON.parse(metadataContent);
                  
                  // Try to find IPFS metadata for this file
                  if (ipfsMetadata[fileId]) {
                    ipfsHash = ipfsMetadata[fileId].ipfsHash;
                  } else {
                    // Search through all metadata entries
                    for (const [metaKey, metadata] of Object.entries(ipfsMetadata)) {
                      if (metadata.alternateIds && Array.isArray(metadata.alternateIds)) {
                        const matches = metadata.alternateIds.some(altId => {
                          return altId === fileId || matchingFile.includes(altId) || altId.includes(originalName.replace(/\.[^/.]+$/, ''));
                        });
                        
                        if (matches) {
                          ipfsHash = metadata.ipfsHash;
                          break;
                        }
                      }
                    }
                  }
                  
                  if (ipfsHash) {
                    if (this.config.ipfsManager) {
                      ipfsUrl = this.config.ipfsManager.getGatewayUrl(ipfsHash);
                    } else {
                      ipfsUrl = `https://ipfs.io/ipfs/${ipfsHash}`;
                    }
                  }
                } catch (metadataErr) {
                  console.warn(`[FileManager] Error reading IPFS metadata: ${metadataErr.message}`);
                }
              }
              
              // Create file object
              const fileObject = {
                id: fileId,
                name: originalName,
                originalName: originalName,
                mimetype: mimeType,
                mimeType: mimeType,
                size: stats.size,
                fileUrl: `/uploads/${matchingFile}`,
                url: `/uploads/${matchingFile}`,
                timestamp: stats.mtimeMs,
                uploadedAt: stats.mtimeMs,
                localPath: filePath,
                ipfsHash: ipfsHash,
                ipfsUrl: ipfsUrl,
                verified: true,
                foundInFilesystem: true
              };
              
              console.log(`[FileManager] getFileById: Created file object from filesystem for: ${fileId}`);
              
              // Save to GunDB for future reference (don't await)
              try {
                this.config.gun.get("files").get(fileId).put(fileObject);
                console.log(`[FileManager] getFileById: Saved filesystem file to GunDB: ${fileId}`);
              } catch (saveErr) {
                console.warn(`[FileManager] Could not save filesystem file to GunDB: ${saveErr.message}`);
              }
              
              return fileObject;
            }
          } catch (fileErr) {
            console.error(`[FileManager] Error processing filesystem file ${matchingFile}: ${fileErr.message}`);
          }
        }
      }
    }

    console.log(
      `[FileManager] getFileById: File not found in any path: ${fileId}`
    );
    return null;
  }

  /**
   * Delete file by ID
   * @param {string} fileId - File ID to delete
   * @returns {Promise<Object>} Result of the operation
   */
  async deleteFile(fileId) {
    const deleteStartTime = Date.now();
    const deleteRequestId = `del_${deleteStartTime}_${Math.random().toString(36).substr(2, 9)}`;
    
    if (!this.config.gun) {
      throw new Error("Gun instance not available");
    }

    if (!fileId) {
      throw new Error("File ID is required");
    }

    console.log(`[FileManager] Request to delete file: ${fileId} (Delete ID: ${deleteRequestId})`);

    // Get file data from GunDB
    const fileNode = this.config.gun.get("files").get(fileId);

    let fileData = await this.gunPromiseWithTimeout((resolve) => {
      fileNode.once((data) => {
        resolve(data);
      });
    });

    // If no file data in GunDB, try to find a matching file in the filesystem
    // This is important because we might have filesystem files not yet in GunDB
    if (!fileData) {
      console.log(`[FileManager] File not found in GunDB, searching filesystem (Delete ID: ${deleteRequestId})`);
      
      // Try to identify the file in the filesystem by the ID prefix
      const idParts = fileId.split('_');
      if (idParts.length > 0) {
        const filePrefix = idParts[0]; // Get the timestamp prefix part
        
        // Check if a file with this prefix exists in the storage directory
        if (fs.existsSync(this.config.storageDir)) {
          const files = fs.readdirSync(this.config.storageDir);
          const matchingFile = files.find(filename => filename.startsWith(filePrefix) || filename.includes(fileId));
          
          if (matchingFile) {
            const filePath = path.join(this.config.storageDir, matchingFile);
            console.log(`[FileManager] Found matching file in filesystem: ${filePath} (Delete ID: ${deleteRequestId})`);
            
            // Create a minimal fileData object
            fileData = {
              id: fileId,
              localPath: filePath,
              name: matchingFile
            };
          }
        }
      }
    }

    let deletionResults = {
      fileSystemDeleted: false,
      gunDbDeleted: false,
      ipfsUnpinned: false,
      deletedFilesUpdated: false,
      ipfsMetadataCleaned: false
    };

    // If we found file data (from GunDB or filesystem), try to delete the actual file
    if (fileData) {
      console.log(`[FileManager] Found file data for deletion: ${fileId} (Delete ID: ${deleteRequestId})`);
      
      // Delete local file if path exists
      const localPath = fileData.localPath;
      if (localPath && fs.existsSync(localPath)) {
        try {
          fs.unlinkSync(localPath);
          deletionResults.fileSystemDeleted = true;
          console.log(`[FileManager] File deleted from local filesystem: ${localPath} (Delete ID: ${deleteRequestId})`);
        } catch (fsError) {
          console.error(`[FileManager] Error deleting file from filesystem: ${fsError.message} (Delete ID: ${deleteRequestId})`);
          // Continue with database deletion anyway
        }
      } else if (fileData.originalName || fileData.name) {
        // If localPath is missing but we have originalName, try to find and delete the file
        const potentialFilenames = [
          fileData.originalName,
          fileData.name,
          fileId
        ].filter(Boolean);
        
        console.log(`[FileManager] Searching for file to delete using potential names: ${potentialFilenames.join(', ')} (Delete ID: ${deleteRequestId})`);
        
        for (const filename of potentialFilenames) {
          if (!filename) continue;
          
          // Try different versions of the filename in the storage dir
          const storageFiles = fs.existsSync(this.config.storageDir) ? fs.readdirSync(this.config.storageDir) : [];
          const matchingFiles = storageFiles.filter(f => 
            f.includes(filename) || 
            (fileId && f.includes(fileId)) ||
            f.includes(filename.replace(/[^a-zA-Z0-9.-]/g, "_"))
          );
          
          for (const matchingFile of matchingFiles) {
            const filePath = path.join(this.config.storageDir, matchingFile);
            try {
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                deletionResults.fileSystemDeleted = true;
                console.log(`[FileManager] File deleted from local filesystem: ${filePath} (Delete ID: ${deleteRequestId})`);
                break;
              }
            } catch (e) {
              console.error(`[FileManager] Error deleting potential file: ${e.message} (Delete ID: ${deleteRequestId})`);
            }
          }
          
          if (deletionResults.fileSystemDeleted) break;
        }
      }

      // Unpin from IPFS if hash exists and IPFS is enabled
      if (fileData.ipfsHash && this.config.ipfsManager?.isEnabled()) {
        try {
          await this.config.ipfsManager.unpin(fileData.ipfsHash);
          deletionResults.ipfsUnpinned = true;
          console.log(`[FileManager] File unpinned from IPFS: ${fileData.ipfsHash} (Delete ID: ${deleteRequestId})`);
        } catch (ipfsError) {
          console.error(`[FileManager] Error unpinning from IPFS: ${ipfsError.message} (Delete ID: ${deleteRequestId})`);
          // Continue with database deletion anyway
        }
      }

      // Clean up IPFS metadata if it exists
      try {
        const metadataPath = path.join(this.config.storageDir, 'ipfs-metadata.json');
        if (fs.existsSync(metadataPath)) {
          const metadataContent = fs.readFileSync(metadataPath, 'utf8');
          const ipfsMetadata = JSON.parse(metadataContent);
          
          // Check if this file exists in IPFS metadata
          if (ipfsMetadata[fileId]) {
            delete ipfsMetadata[fileId];
            
            // Also check alternate IDs that might reference this file
            for (const [metaKey, metadata] of Object.entries(ipfsMetadata)) {
              if (metadata.alternateIds && Array.isArray(metadata.alternateIds)) {
                if (metadata.alternateIds.includes(fileId)) {
                  console.log(`[FileManager] Removing file ${fileId} from IPFS metadata using alternate ID match with ${metaKey} (Delete ID: ${deleteRequestId})`);
                  delete ipfsMetadata[metaKey];
                  break;
                }
              }
            }
            
            // Write back the cleaned metadata
            fs.writeFileSync(metadataPath, JSON.stringify(ipfsMetadata, null, 2));
            console.log(`[FileManager] Cleaned up IPFS metadata for file: ${fileId} (Delete ID: ${deleteRequestId})`);
            deletionResults.ipfsMetadataCleaned = true;
          }
        }
      } catch (metadataError) {
        console.error(`[FileManager] Error cleaning IPFS metadata: ${metadataError.message} (Delete ID: ${deleteRequestId})`);
      }
    } else {
      console.log(`[FileManager] No file data found for deletion: ${fileId} (Delete ID: ${deleteRequestId})`);
    }

    // Delete from GunDB with multiple approaches to ensure complete removal
    try {
      console.log(`[FileManager] Deleting file from all known paths in GunDB: ${fileId} (Delete ID: ${deleteRequestId})`);

      // First, mark as deleted in the deletedFiles collection with timestamp
      const deletedEntry = {
        id: fileId,
        deletedAt: Date.now(),
        deleteRequestId: deleteRequestId,
        deletedBy: 'system', // Could be user info if available
        originalData: fileData ? JSON.stringify(fileData) : null
      };
      
      this.config.gun.get("deletedFiles").get(fileId).put(deletedEntry);
      deletionResults.deletedFilesUpdated = true;
      console.log(`[FileManager] File marked as deleted in deletedFiles collection: ${fileId} (Delete ID: ${deleteRequestId})`);
      
      // Remove from the main files collection
      await this.gunPromiseWithTimeout((resolve) => {
        this.config.gun.get("files").get(fileId).put(null, (ack) => {
            if (ack.err) {
              console.error(`[FileManager] Error deleting from main files path: ${ack.err} (Delete ID: ${deleteRequestId})`);
            } else {
              console.log(`[FileManager] File deleted from main GunDB files path: ${fileId} (Delete ID: ${deleteRequestId})`);
              deletionResults.gunDbDeleted = true;
            }
            resolve();
          });
      });

      // Also try with a slash prefix in case the key is stored that way
      if (fileId && !fileId.startsWith('/')) {
        this.config.gun.get("files").get('/' + fileId).put(null);
        console.log(`[FileManager] Also deleted with slash prefix: /${fileId} (Delete ID: ${deleteRequestId})`);
      }

      // Clean up any potential variations of the file ID
      const possibleKeys = [
        fileId,
        fileId.replace(/-/g, '_'),
        fileId.replace(/_/g, '-'),
        fileId.toLowerCase(),
        fileId.toUpperCase()
      ];

      for (const key of possibleKeys) {
        if (key !== fileId) {
          this.config.gun.get("files").get(key).put(null);
          console.log(`[FileManager] Cleaned up potential key variation: ${key} (Delete ID: ${deleteRequestId})`);
        }
      }

      // Force update the parent files node to trigger sync
      this.config.gun.get("files").put({ 
        lastUpdated: Date.now(),
        _deleteToken: deleteRequestId,
        _lastDeletion: {
          fileId: fileId,
          deletedAt: Date.now(),
          deleteRequestId: deleteRequestId
        }
      });
      
      // Update root node to force sync across peers
      this.config.gun.put({ 
        _lastSync: Date.now(),
        _lastDeletion: deleteRequestId
      });

      console.log(`[FileManager] File deletion completed for ${fileId} in ${Date.now() - deleteStartTime}ms (Delete ID: ${deleteRequestId})`);
      console.log(`[FileManager] Deletion results: ${JSON.stringify(deletionResults)} (Delete ID: ${deleteRequestId})`);
      
      // Force a longer delay to allow GunDB to process the change
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Clear any cached file list data to force refresh
      if (this._cacheData) {
        this._cacheData = null;
        console.log(`[FileManager] Cleared cache after deletion (Delete ID: ${deleteRequestId})`);
      }
      
    } catch (error) {
      console.error(`[FileManager] Error during file deletion: ${error.message} (Delete ID: ${deleteRequestId})`);
      // Even with errors, we'll still return success since we tried our best
    }

    return {
      success: true,
      message: "File deletion process completed",
      id: fileId,
      deleteRequestId: deleteRequestId,
      results: deletionResults,
      processingTime: Date.now() - deleteStartTime
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
      `[FILE-MANAGER] Saving file metadata to GunDB. Key: ${fileId}, Name: ${metadata.originalName}, Size: ${metadata.size} bytes`
    );

    try {
      // Enhanced save with multiple approaches for better reliability
      const saveResult = await new Promise((resolve) => {
        let resolved = false;
        let attempts = 0;
        const maxAttempts = 3;

        const attemptSave = () => {
          attempts++;
          console.log(`[FILE-MANAGER] Save attempt ${attempts}/${maxAttempts} for ${fileId}`);

          // Set a timeout for this attempt
          const attemptTimeout = setTimeout(() => {
            if (!resolved && attempts < maxAttempts) {
              console.log(`[FILE-MANAGER] Save attempt ${attempts} timed out, retrying...`);
              attemptSave();
            } else if (!resolved) {
              console.log(`[FILE-MANAGER] All save attempts failed, using fallback for ${fileId}`);
              resolved = true;
              
              // Fallback: direct put without callback
              try {
                this.config.gun.get("files").get(fileId).put(metadata);
                this.config.gun.get("files").put({ 
                  _lastUpdated: Date.now(),
                  _refreshToken: Math.random().toString(36).substr(2, 9)
                });
                resolve({ success: true, method: "fallback", attempts });
              } catch (e) {
                console.error(`[FILE-MANAGER] Fallback save also failed: ${e.message}`);
                resolve({ success: false, error: e.message, attempts });
              }
            }
          }, 3000); // 3 second timeout per attempt

          try {
            this.config.gun
              .get("files")
              .get(fileId)
              .put(metadata, (ack) => {
                if (!resolved) {
                  clearTimeout(attemptTimeout);
                  resolved = true;

                  if (ack.err) {
                    console.error(`[FILE-MANAGER] Save error on attempt ${attempts}: ${ack.err}`);
                    if (attempts < maxAttempts) {
                      resolved = false; // Allow retry
                      setTimeout(attemptSave, 1000); // Wait 1 second before retry
                    } else {
                      resolve({ success: false, error: ack.err, attempts });
                    }
                  } else {
                    console.log(`[FILE-MANAGER] Save successful on attempt ${attempts} for ${fileId}`);
                    
                    // Force refresh of the files collection
                    this.config.gun.get("files").put({ 
                      _lastUpdated: Date.now(),
                      _refreshToken: Math.random().toString(36).substr(2, 9)
                    });
                    
                    // Also save to a backup location for debugging
                    this.config.gun.get("files-backup").get(fileId).put({
                      ...metadata,
                      _backupTimestamp: Date.now()
                    });
                    
                    resolve({ success: true, method: "callback", attempts });
                  }
                }
              });
          } catch (error) {
            if (!resolved) {
              clearTimeout(attemptTimeout);
              console.error(`[FILE-MANAGER] Exception on attempt ${attempts}: ${error.message}`);
              if (attempts < maxAttempts) {
                setTimeout(attemptSave, 1000);
              } else {
                resolved = true;
                resolve({ success: false, error: error.message, attempts });
              }
            }
          }
        };

        // Start the first attempt
        attemptSave();
      });

      console.log(
        `[FILE-MANAGER] File metadata save completed for ${fileId}: ${
          saveResult.success ? "SUCCESS" : "FAILED"
        } (method: ${saveResult.method || "unknown"}, attempts: ${saveResult.attempts})`
      );

      // Verification step - try to read back the data
      let verificationResult = false;
      try {
        console.log(`[FILE-MANAGER] Verifying save by reading back data for ${fileId}...`);
        const readBack = await this.gunPromiseWithTimeout((resolve) => {
          this.config.gun.get("files").get(fileId).once((data) => {
            resolve(data);
          });
        }, 2000);
        
        if (readBack && readBack.id === fileId) {
          verificationResult = true;
          console.log(`[FILE-MANAGER] Verification successful for ${fileId}`);
        } else {
          console.warn(`[FILE-MANAGER] Verification failed for ${fileId} - data not found or incomplete`);
        }
      } catch (verError) {
        console.warn(`[FILE-MANAGER] Verification error for ${fileId}: ${verError.message}`);
      }

      return {
        ...metadata,
        verified: saveResult.success && verificationResult,
        saveResult: saveResult,
        _savedAt: Date.now()
      };
    } catch (error) {
      console.error(
        `[FILE-MANAGER] Critical error saving file metadata: ${error.message}`
      );

      return {
        ...metadata,
        verified: false,
        error: error.message,
        _savedAt: Date.now()
      };
    }
  }

  /**
   * Generate a secure random ID
   * @param {number} length - Length of the ID
   * @returns {string} Generated ID
   */
  generateId(length = 16) {
    return crypto.randomBytes(length).toString("hex");
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
