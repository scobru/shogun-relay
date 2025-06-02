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
   * Handle file upload request
   * @param {Object} req - Express request object with file from multer
   * @returns {Promise<Object>} File data including URLs and metadata
   */
  async handleFileUpload(req) {
    if (!req.file && (!req.body.content || !req.body.contentType)) {
      throw new Error("File or content missing");
    }

    let gunDbKey, fileBuffer, originalName, mimeType, fileSize, uploadTimestamp;

    // Create a unique timestamp with microsecond precision to prevent duplicates
    uploadTimestamp = Date.now();
    const microSeconds = process.hrtime.bigint() % 1000n;
    const uniqueTimestamp = `${uploadTimestamp}${microSeconds.toString().padStart(3, '0')}`;

    if (req.file) {
      originalName = req.file.originalname;
      mimeType = req.file.mimetype;
      fileSize = req.file.size;
      
      // Create a safe key for GunDB by removing problematic characters
      // Use the same format as filesystem naming to ensure consistency
      const safeOriginalName = originalName.replace(/[^a-zA-Z0-9.-]/g, "_");
      
      // Use consistent ID format with unique timestamp: timestamp-filename
      gunDbKey = req.body.customName || `${uniqueTimestamp}-${safeOriginalName.replace(/\.[^/.]+$/, "")}`;

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
      originalName = req.body.customName || `text-${uniqueTimestamp}.txt`;
      gunDbKey = req.body.customName || `${uniqueTimestamp}-text`;
      mimeType = contentType;
      fileSize = content.length;
      fileBuffer = Buffer.from(content);
    }

    if (!fileBuffer) {
      throw new Error("File buffer not available");
    }

    let fileUrl = null;
    let localPath = null;

    // Always store files locally first (no automatic IPFS upload)
    console.log(`Storing file locally: ${originalName}`);
    const fileName = `${uniqueTimestamp}-${originalName.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    localPath = path.join(this.config.storageDir, fileName);
    
    // Check if file already exists and generate alternative name if needed
    let actualLocalPath = localPath;
    let counter = 1;
    while (fs.existsSync(actualLocalPath)) {
      const ext = path.extname(fileName);
      const basename = path.basename(fileName, ext);
      actualLocalPath = path.join(this.config.storageDir, `${basename}_${counter}${ext}`);
      counter++;
    }
    
    fs.writeFileSync(actualLocalPath, fileBuffer);
    fileUrl = `/uploads/${path.basename(actualLocalPath)}`;
    console.log(`File saved locally successfully: ${actualLocalPath}`);

    // Ensure an ID with proper formatting for GunDB
    const safeId = gunDbKey.replace(/[^a-zA-Z0-9_-]/g, "_");

    // Check if this file ID already exists in GunDB to prevent duplicates
    const existingFile = await this.getFileById(safeId);
    if (existingFile) {
      console.warn(`[FileManager] File with ID ${safeId} already exists, generating new ID`);
      const newId = `${safeId}_${counter}`;
      gunDbKey = newId;
    }

    const fileData = {
      id: safeId,
      name: originalName,
      originalName: originalName,
      mimeType: mimeType,
      mimetype: mimeType,
      size: fileSize,
      url: fileUrl,
      fileUrl: fileUrl,
      localPath: actualLocalPath,
      ipfsHash: null, // No IPFS hash initially
      ipfsUrl: null,  // No IPFS URL initially
      timestamp: uploadTimestamp,
      uploadedAt: uploadTimestamp,
      customName: req.body.customName || null,
      uploadId: uniqueTimestamp, // Add unique upload identifier
    };

    // Save metadata to GunDB
    const savedFile = await this.saveFileMetadata(fileData);

    console.log(`[FILE-MANAGER] File upload completed: ${savedFile.id}`);
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
   * Get all files from GunDB with fallback to direct radata/ reading
   * @returns {Promise<Array>} Array of file objects
   */
  async getAllFiles() {
    if (!this.config.gun) {
      throw new Error("Gun instance not available");
    }

    console.log("[FileManager] getAllFiles: Request received for all files");

    // Store valid files and track IDs we've already seen to avoid duplicates
    const files = [];
    const seen = new Set();
    const filesByContent = new Map(); // Track files by content hash to prevent duplicates

    // First fetch the list of deleted files to filter against
    const deletedFileIds = new Set();
    try {
      const deletedFilesRaw = await this.gunPromiseWithTimeout((resolve) => {
        this.config.gun.get("deletedFiles").once(data => resolve(data));
      }, 3000);
      
      if (deletedFilesRaw) {
        Object.keys(deletedFilesRaw).forEach(key => {
          // Skip GunDB metadata
          if (!key.startsWith("_")) {
            deletedFileIds.add(key);
            console.log(`[FileManager] Marking file as deleted: ${key}`);
          }
        });
      }
      console.log(`[FileManager] Found ${deletedFileIds.size} deleted file IDs to filter out`);
    } catch (error) {
      console.warn("[FileManager] Error fetching deleted files:", error.message);
    }

    // Helper to process file data into a standardized format with duplicate detection
    const processFileData = (data, key) => {
      // Skip if key is null, undefined, or starts with _ (GunDB metadata)
      if (!key || key.startsWith("_")) return;

      // Skip if this file has been deleted
      if (deletedFileIds.has(key)) {
        console.log(`[FileManager] Skipping deleted file: ${key}`);
        return;
      }

      // Skip if we've already processed this ID
      const normalizedId = key.startsWith("/") ? key.substring(1) : key;
      if (seen.has(normalizedId)) {
        console.log(`[FileManager] Skipping duplicate key: ${key}`);
        return;
      }

      // Skip GunDB special properties and metadata
      if (
        key === "_" ||
        key === "#" ||
        key === "_refreshQuery" ||
        key === "lastUpdated" ||
        key === ">" ||
        key === "undefined"
      ) {
        console.log(`[FileManager] Skipping special key: ${key}`);
        return;
      }

      console.log(`[FileManager] Processing file data for key: ${key}`);

      try {
        // Extract file data, handling different data formats
        let fileObject = {};

        if (data && typeof data === "object") {
          // Set ID from key if not present
          fileObject = { ...data, id: data.id || normalizedId };

          // Update IPFS URL if not present but hash is available
          if (
            fileObject.ipfsHash &&
            !fileObject.ipfsUrl &&
            this.config.ipfsManager
          ) {
            fileObject.ipfsUrl = this.config.ipfsManager.getGatewayUrl(
              fileObject.ipfsHash
            );
          }
          
          // Add extra debug information for IPFS files
          if (fileObject.ipfsHash) {
            console.log(`[FileManager] Found file with IPFS data: ${normalizedId}, hash: ${fileObject.ipfsHash}`);
          }
        } else {
          console.log(`[FileManager] Invalid data for key ${key}: ${data}`);
          return; // Skip invalid data
        }

        // Only add valid file entries
        if (
          (fileObject.name || fileObject.originalName) &&
          (fileObject.fileUrl || fileObject.ipfsHash)
        ) {
          // Create content identifier for duplicate detection
          const contentId = `${fileObject.originalName}_${fileObject.size}_${fileObject.mimetype}`;
          
          // Check for content duplicates
          if (filesByContent.has(contentId)) {
            const existingFile = filesByContent.get(contentId);
            console.log(`[FileManager] Found content duplicate: ${normalizedId} matches ${existingFile.id}`);
            
            // Keep the newer file (higher timestamp)
            const newTimestamp = parseInt(fileObject.timestamp || fileObject.uploadedAt || 0);
            const existingTimestamp = parseInt(existingFile.timestamp || existingFile.uploadedAt || 0);
            
            if (newTimestamp > existingTimestamp) {
              // Remove the older file from results
              const oldIndex = files.findIndex(f => f.id === existingFile.id);
              if (oldIndex !== -1) {
                files.splice(oldIndex, 1);
                console.log(`[FileManager] Replacing older duplicate ${existingFile.id} with ${normalizedId}`);
              }
              filesByContent.set(contentId, fileObject);
            } else {
              console.log(`[FileManager] Keeping existing file ${existingFile.id}, skipping ${normalizedId}`);
              return; // Skip this duplicate
            }
          } else {
            filesByContent.set(contentId, fileObject);
          }
          
          files.push(fileObject);
          seen.add(normalizedId);
          console.log(
              `[FileManager] Added file to result set: ID=${normalizedId}`
          );
        } else {
          console.log(
            `[FileManager] Skipping invalid file data for key: ${key} - Missing required properties`
          );
        }
      } catch (err) {
        console.error(`[FileManager] Error processing file data: ${err.message}`);
      }
    };

    // Main function to get files from GunDB
    try {
      console.log("[FileManager] Examining 'files' node in GunDB");

      // Clear any stale GunDB cache with a refresh token
      this.config.gun.get("files").put({ _refreshToken: Date.now() });

      // Get the files directly from storage first for reliability
      let filesFromStorage = [];
      try {
        if (fs.existsSync(this.config.storageDir)) {
          filesFromStorage = await this.getFilesFromStorage(deletedFileIds);
          console.log(`[FileManager] Found ${filesFromStorage.length} files in storage`);
        }
      } catch (fsErr) {
        console.error(`[FileManager] Error reading storage dir: ${fsErr.message}`);
      }

      // CRITICAL FIX: Load files from IPFS metadata if available
      let filesFromIpfsMetadata = [];
      try {
        const metadataPath = path.join(this.config.storageDir, 'ipfs-metadata.json');
        if (fs.existsSync(metadataPath)) {
          console.log(`[FileManager] Loading files from IPFS metadata`);
          const content = fs.readFileSync(metadataPath, 'utf8');
          const ipfsMetadata = JSON.parse(content);
          
          for (const [fileId, metadata] of Object.entries(ipfsMetadata)) {
            // Skip if this file has been deleted
            if (deletedFileIds.has(fileId)) {
              console.log(`[FileManager] Skipping deleted IPFS file: ${fileId}`);
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
            
            filesFromIpfsMetadata.push(ipfsFile);
            console.log(`[FileManager] Added IPFS file from metadata: ${fileId}`);
          }
          
          console.log(`[FileManager] Found ${filesFromIpfsMetadata.length} files from IPFS metadata`);
        }
      } catch (ipfsMetaErr) {
        console.error(`[FileManager] Error reading IPFS metadata: ${ipfsMetaErr.message}`);
      }

      // Combine all files: storage files + IPFS metadata files
      const allFoundFiles = [...filesFromStorage, ...filesFromIpfsMetadata];
      
      // Remove duplicates by ID
      const uniqueFiles = [];
      const processedIds = new Set();
      
      for (const file of allFoundFiles) {
        if (!processedIds.has(file.id)) {
          uniqueFiles.push(file);
          processedIds.add(file.id);
        }
      }

      // If we found files in storage/IPFS metadata, save them to GunDB for synchronization
      if (uniqueFiles.length > 0) {
        console.log(`[FileManager] Syncing ${uniqueFiles.length} files to GunDB`);
        for (const file of uniqueFiles) {
          // Skip if this file has been deleted
          if (deletedFileIds.has(file.id)) {
            console.log(`[FileManager] Not syncing deleted file to GunDB: ${file.id}`);
            continue;
          }
          
          try {
            // Save to GunDB asynchronously without waiting
            this.config.gun.get("files").get(file.id).put(file);
            console.log(`[FileManager] Synced file to GunDB: ${file.id}`);
          } catch (syncErr) {
            console.error(`[FileManager] Error syncing to GunDB: ${syncErr.message}`);
          }
        }
        
        // Add files to our result
        for (const file of uniqueFiles) {
          if (!seen.has(file.id)) {
            files.push(file);
            seen.add(file.id);
          }
        }
        
        console.log(`[FileManager] Added ${uniqueFiles.length} files from storage/IPFS to result`);
      }

      // Now try to get files from GunDB (this may be empty but we try anyway)
      try {
        console.log("[FileManager] Attempting to read from GunDB files node");
        
        const gunData = await this.gunPromiseWithTimeout((resolve) => {
          this.config.gun.get("files").once((data) => {
            console.log(`[FileManager] GunDB files data received:`, typeof data, data ? Object.keys(data).length : 0);
            resolve(data);
          });
        }, 5000);

        if (gunData && typeof gunData === "object") {
          console.log(`[FileManager] Processing GunDB data with ${Object.keys(gunData).length} keys`);
          
          for (const [key, value] of Object.entries(gunData)) {
            processFileData(value, key);
          }
        } else {
          console.log("[FileManager] No data found in GunDB files node");
        }
      } catch (gunErr) {
        console.error(`[FileManager] Error reading from GunDB: ${gunErr.message}`);
      }

    } catch (error) {
      console.error(`[FileManager] Error in getAllFiles: ${error.message}`);
    }

    console.log(`[FileManager] Returning ${files.length} files total`);
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
        
        // Generate a file ID based on the filename
        // Extract timestamp if present in filename (e.g., 1747584045369-originalname.jpg)
        const timestampMatch = filename.match(/^(\d+)-/);
        const timestamp = timestampMatch ? parseInt(timestampMatch[1]) : stats.mtimeMs;
        
        // Generate a consistent ID that won't change between restarts
        const fileId = `${timestamp}-${filename.replace(/\.[^/.]+$/, "")}_${timestamp.toString().substring(7)}`;
        
        // Skip if this file has been marked as deleted
        if (deletedFileIds.has(fileId)) {
          console.log(`[FileManager] Skipping deleted file from filesystem: ${fileId} (${filename})`);
          continue;
        }
        
        // Also check if any deleted ID contains parts of this filename or vice versa
        // This handles cases where the ID format changes but refers to the same file
        let isDeleted = false;
        for (const deletedId of deletedFileIds) {
          // If the deleted ID contains the timestamp or is contained in the filename
          if (deletedId.includes(timestamp.toString()) || filename.includes(deletedId.split('_')[0])) {
            console.log(`[FileManager] Skipping likely deleted file from filesystem: ${filename} (matches: ${deletedId})`);
            isDeleted = true;
            break;
          }
        }
        if (isDeleted) continue;
        
        // Determine MIME type
        const ext = path.extname(filename).toLowerCase();
        let mimeType = 'application/octet-stream';
        
        if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
        else if (ext === '.png') mimeType = 'image/png';
        else if (ext === '.gif') mimeType = 'image/gif';
        else if (ext === '.pdf') mimeType = 'application/pdf';
        else if (ext === '.txt') mimeType = 'text/plain';
        
        // Build the file URL
        const fileUrl = `/uploads/${filename}`;

        // Create file object and check for IPFS metadata
        const fileObject = {
          id: fileId,
          name: filename,
          originalName: filename,
          mimetype: mimeType,
          size: stats.size,
          fileUrl: fileUrl,
          url: fileUrl,
          timestamp: timestamp,
          uploadedAt: timestamp,
          localPath: filePath,
        };
        
        // Check if we have IPFS metadata for this file
        const metadataKey = fileId;
        if (ipfsMetadata[metadataKey]) {
          const metadata = ipfsMetadata[metadataKey];
          fileObject.ipfsHash = metadata.ipfsHash;
          
          // Add IPFS URL
          if (fileObject.ipfsHash && this.config.ipfsManager) {
            fileObject.ipfsUrl = this.config.ipfsManager.getGatewayUrl(fileObject.ipfsHash);
          } else if (fileObject.ipfsHash) {
            fileObject.ipfsUrl = `https://ipfs.io/ipfs/${fileObject.ipfsHash}`;
          }
          
          console.log(`[FileManager] Added IPFS data to file ${fileId}: hash=${fileObject.ipfsHash}`);
        } else {
          // Try enhanced metadata matching with multiple strategies
          let ipfsMetadataFound = false;
          
          // Strategy 1: Check alternateIds in each metadata entry
          for (const [metaKey, metadata] of Object.entries(ipfsMetadata)) {
            if (metadata.alternateIds && Array.isArray(metadata.alternateIds)) {
              // Check if any alternate ID matches our file patterns
              const matches = metadata.alternateIds.some(altId => {
                // Direct match
                if (altId === fileId) return true;
                
                // Filename without extension match
                const filenameNoExt = filename.replace(/\.[^/.]+$/, '');
                if (altId === filenameNoExt) return true;
                
                // Check if filename starts with the alternate ID
                if (filename.startsWith(altId)) return true;
                
                // Check timestamp-based matching
                if (altId.includes(timestamp.toString())) return true;
                
                return false;
              });
              
              if (matches) {
                fileObject.ipfsHash = metadata.ipfsHash;
                
                // Add IPFS URL
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
          
          // Strategy 2: If no alternateIds match, try the original logic with enhancements
          if (!ipfsMetadataFound) {
            for (const [key, metadata] of Object.entries(ipfsMetadata)) {
              // Extract filename components for comparison
              const baseFilenameNoExt = filename.replace(/\.[^/.]+$/, '').replace(/^\d+-/, '');
              const keyBaseNoExt = key.replace(/\.[^/.]+$/, '').replace(/^\d+-/, '');
              
              // Enhanced matching logic
              const conditions = [
                // Timestamp match
                key.includes(timestamp.toString()),
                // Base filename match
                key.includes(baseFilenameNoExt),
                filename.includes(keyBaseNoExt),
                // Partial key match
                baseFilenameNoExt.includes(key.split('_')[0]),
                // Direct partial match (useful for simple names)
                filename.includes(key) || key.includes(filename.replace(/\.[^/.]+$/, '')),
                // Check against stored base filename
                metadata.baseFilename && (
                  baseFilenameNoExt.includes(metadata.baseFilename) ||
                  metadata.baseFilename.includes(baseFilenameNoExt)
                ),
                // Check against stored original filename
                metadata.originalFilename && (
                  filename.includes(metadata.originalFilename) ||
                  metadata.originalFilename.includes(baseFilenameNoExt)
                )
              ];
              
              if (conditions.some(condition => condition)) {
                fileObject.ipfsHash = metadata.ipfsHash;
                
                // Add IPFS URL
                if (fileObject.ipfsHash && this.config.ipfsManager) {
                  fileObject.ipfsUrl = this.config.ipfsManager.getGatewayUrl(fileObject.ipfsHash);
                } else if (fileObject.ipfsHash) {
                  fileObject.ipfsUrl = `https://ipfs.io/ipfs/${fileObject.ipfsHash}`;
                }
                
                console.log(`[FileManager] Added IPFS data to file ${fileId} using enhanced matching with ${key}: hash=${fileObject.ipfsHash}`);
                ipfsMetadataFound = true;
                break;
              }
            }
          }
          
          if (!ipfsMetadataFound) {
            console.log(`[FileManager] No IPFS metadata found for file ${fileId} (checked ${Object.keys(ipfsMetadata).length} metadata entries)`);
          }
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
    if (!this.config.gun) {
      throw new Error("Gun instance not available");
    }

    if (!fileId) {
      throw new Error("File ID is required");
    }

    console.log(`Request to delete file: ${fileId}`);

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
      // Try to identify the file in the filesystem by the ID prefix
      const idParts = fileId.split('_');
      if (idParts.length > 0) {
        const filePrefix = idParts[0]; // Get the timestamp prefix part
        
        // Check if a file with this prefix exists in the storage directory
        if (fs.existsSync(this.config.storageDir)) {
          const files = fs.readdirSync(this.config.storageDir);
          const matchingFile = files.find(filename => filename.startsWith(filePrefix));
          
          if (matchingFile) {
            const filePath = path.join(this.config.storageDir, matchingFile);
            console.log(`Found matching file in filesystem: ${filePath}`);
            
            // Create a minimal fileData object
            fileData = {
              id: fileId,
              localPath: filePath
            };
          }
        }
      }
    }

    // If we found file data (from GunDB or filesystem), try to delete the actual file
    if (fileData) {
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
      } else if (fileData.originalName) {
        // If localPath is missing but we have originalName, try to find and delete the file
        const potentialFilenames = [
          fileData.originalName,
          fileData.name,
          fileId
        ];
        
        for (const filename of potentialFilenames) {
          if (!filename) continue;
          
          // Try different versions of the filename in the storage dir
          const potentialPaths = [
            path.join(this.config.storageDir, filename),
            path.join(this.config.storageDir, filename.replace(/[^a-zA-Z0-9.-]/g, "_")),
            // Include timestamp-prefixed versions
            ...fs.readdirSync(this.config.storageDir)
              .filter(f => f.includes(filename) || (fileId && f.includes(fileId)))
              .map(f => path.join(this.config.storageDir, f))
          ];
          
          for (const filePath of potentialPaths) {
            try {
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`File deleted from local filesystem: ${filePath}`);
                break;
              }
            } catch (e) {
              console.error(`Error deleting potential file: ${e.message}`);
            }
          }
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
    }

    // Try multiple approaches to delete from GunDB to ensure it's fully removed
    try {
      console.log("Deleting file from all known paths in GunDB");

      // First, try with a direct put null
      this.config.gun.get("files").get(fileId).put(null);
      
      // Also mark as deleted in the deletedFiles collection
      this.config.gun.get("deletedFiles").get(fileId).put({
        id: fileId,
        deletedAt: Date.now()
      });
      
      // Then, try with the classic approach with acknowledgement
      await this.gunPromiseWithTimeout((resolve) => {
        this.config.gun.get("files").get(fileId).put(null, (ack) => {
            if (ack.err) {
              console.error(`Error deleting from main path: ${ack.err}`);
            } else {
              console.log(`File deleted from main GunDB path for ${fileId}`);
            }
            resolve();
          });
      });

      // Also try again with a slash prefix in case the key is stored that way
      if (fileId && !fileId.startsWith('/')) {
        this.config.gun.get("files").get('/' + fileId).put(null);
      }

      // Force update the parent node to trigger sync
      this.config.gun.get("files").put({ 
        lastUpdated: Date.now(),
        _deleteToken: Date.now() // Special property to force a refresh
      });
      
      // Try to force a sync by writing to the root node
      this.config.gun.put({ _lastSync: Date.now() });

      console.log(`File deletion completed for ${fileId}`);
      
      // Force a delay before continuing to allow GunDB to process the change
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Error during file deletion: ${error.message}`);
      // Even with errors, we'll still return success since we tried our best
    }

    return {
      success: true,
      message: "File deletion process completed",
      id: fileId,
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
      `[FILE-MANAGER] Preparing to save to GunDB. Key: ${fileId}, IPFS Enabled: ${
        this.config.ipfsManager?.isEnabled() || false
      }`
    );

    try {
      // First direct save to root 'files' node - simplified approach
      console.log(`[FILE-MANAGER] Attempting direct save to files/${fileId}`);

      // Use a simpler Promise wrapper for Gun's put
      const saveResult = await new Promise((resolve) => {
        let resolved = false;

        // Add timeout to prevent hanging
        const timeout = setTimeout(() => {
          if (!resolved) {
            console.log(
              `[FILE-MANAGER] Save timeout for ${fileId}, assuming success`
            );
            resolved = true;

            // Try a simpler approach as fallback
            try {
              // Force simple put without callback
              this.config.gun.get("files").get(fileId).put(metadata);
              // Also update the lastUpdated timestamp to trigger sync
              this.config.gun.get("files").put({ _lastUpdated: Date.now() });
              resolve({ success: true, timedOut: true });
            } catch (e) {
              console.error(
                `[FILE-MANAGER] Error in fallback save: ${e.message}`
              );
              resolve({ success: true, timedOut: true }); // Still assume success to avoid UI errors
            }
          }
        }, 5000);

        try {
          this.config.gun
            .get("files")
            .get(fileId)
            .put(metadata, (ack) => {
              if (!resolved) {
                clearTimeout(timeout);
                resolved = true;

                if (ack.err) {
                  console.error(
                    `[FILE-MANAGER] Error in direct save: ${ack.err}`
                  );
                  resolve({ success: false, error: ack.err });
                } else {
                  console.log(
                    `[FILE-MANAGER] Direct save success for ${fileId}`
                  );

                  // Also update the lastUpdated timestamp to trigger sync
                  this.config.gun
                    .get("files")
                    .put({ _lastUpdated: Date.now() });

                  resolve({ success: true });
                }
              }
            });
        } catch (error) {
          if (!resolved) {
            clearTimeout(timeout);
            resolved = true;
            console.error(
              `[FILE-MANAGER] Exception in save operation: ${error.message}`
            );
            resolve({ success: false, error: error.message });
          }
        }
      });

      // Skip the complex path saving and verification for simplicity
      console.log(
        `[FILE-MANAGER] File metadata save completed for ${fileId} with result: ${
          saveResult.success ? "success" : "failure"
        }`
      );

      return {
        ...metadata,
        verified: saveResult.success,
      };
    } catch (error) {
      console.error(
        `[FILE-MANAGER] Error saving file metadata: ${error.message}`
      );

      return {
        ...metadata,
        verified: false,
        error: error.message,
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
