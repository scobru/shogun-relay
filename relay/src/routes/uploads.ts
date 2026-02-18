import express, { Request, Response, Router, NextFunction } from "express";
import http from "http";
import { loggers } from "../utils/logger";
import { authConfig } from "../config";
import { validateAdminToken } from "../utils/auth-utils";
import { GUN_PATHS } from "../utils/gun-paths";
import { adminOrApiKeyAuthMiddleware } from "../middleware/admin-or-api-key-auth";

// Extended Request interface with custom properties
interface CustomRequest extends Request {
  authType?: string;
}

const router: Router = express.Router();

// Middleware per ottenere l'istanza Gun dal relay
const getGunInstance = (req: Request): any => {
  return req.app.get("gunInstance");
};

const GUN_META_KEYS = ["_", "#", ">", "<"];

function normalizeGunRecord(record: any): any {
  if (!record || typeof record !== "object") {
    return record;
  }

  const normalized: any = {};
  Object.entries(record).forEach(([key, value]: [string, any]) => {
    // Skip Gun metadata keys
    if (GUN_META_KEYS.includes(key)) {
      return;
    }

    // Handle Gun references (objects with # property)
    if (value && typeof value === "object") {
      if (typeof value["#"] === "string") {
        normalized[key] = value["#"];
        return;
      }

      // Recursively normalize nested objects
      normalized[key] = normalizeGunRecord(value);
      return;
    }

    // Special handling for 'files' field: if it's a JSON string, parse it
    if (key === "files" && typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          normalized[key] = parsed;
          return;
        }
      } catch (e) {
        // If parsing fails, keep as string
        loggers.uploads.debug({ err: e }, "Failed to parse files JSON string");
      }
    }

    // Copy primitive values directly
    normalized[key] = value;
  });

  return normalized;
}

// Funzione helper per ottenere tutti gli hash del sistema
async function getAllSystemHashes(req: any): Promise<Array<string>> {
  const gun = getGunInstance(req);
  if (!gun) {
    loggers.uploads.warn("Gun instance not available for system hashes");
    return [];
  }

  loggers.uploads.info("Getting all system file hashes...");

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      loggers.uploads.warn("Timeout for system hashes retrieval");
      resolve([]);
    }, 10000);

    const uploadsNode = gun.get(GUN_PATHS.UPLOADS);

    uploadsNode.once((uploadsData: any) => {
      clearTimeout(timeoutId);

      if (!uploadsData || typeof uploadsData !== "object") {
        loggers.uploads.warn("No uploads found, returning empty array");
        resolve([]);
        return;
      }

      const userAddresses = Object.keys(uploadsData).filter(
        (key) => key !== "_" && key !== "#" && key !== ">" && key !== "<"
      );

      if (userAddresses.length === 0) {
        loggers.uploads.warn("No users found, returning empty array");
        resolve([]);
        return;
      }

      let allHashes: Array<string> = [];
      let completedUsers = 0;
      const totalUsers = userAddresses.length;

      userAddresses.forEach((userAddress) => {
        const userUploadsNode = uploadsNode.get(userAddress);

        userUploadsNode.once((userData: any) => {
          completedUsers++;

          if (userData && typeof userData === "object") {
            const userHashes = Object.keys(userData).filter(
              (key) => key !== "_" && key !== "#" && key !== ">" && key !== "<"
            );
            allHashes = allHashes.concat(userHashes);
          }

          if (completedUsers === totalUsers) {
            loggers.uploads.info({ count: allHashes.length }, "Found system hashes");
            resolve(allHashes);
          }
        });
      });
    });
  });
}

// Funzione helper per eliminare upload e aggiornare MB
async function deleteUploadAndUpdateMB(
  userAddress: string,
  fileHash: string,
  fileSizeMB: number,
  req: any
): Promise<any> {
  const gun = getGunInstance(req);
  return new Promise(async (resolve, reject) => {
    try {
      gun
        .get(GUN_PATHS.UPLOADS)
        .get(userAddress)
        .get(fileHash)
        .put(null, (ack: any) => {
          if (ack && ack.err) {
            reject(new Error(ack.err));
            return;
          }

          // Use centralized helper for MB usage update
          (async () => {
            try {
              const { updateMBUsage } = await import("../utils/storage-utils.js");
              const newMB = await updateMBUsage(gun, userAddress, -fileSizeMB);
              resolve(newMB);
            } catch (error: any) {
              reject(error);
            }
          })();
        });
    } catch (error: any) {
      reject(error);
    }
  });
}

// ROUTE SPECIFICHE - DEVONO ESSERE PRIMA DELLA ROUTE GENERICA /:identifier

// Endpoint per ottenere tutti gli hash del sistema (per il pin manager)
router.get("/system-hashes", async (req, res) => {
  try {
    loggers.uploads.info("System hashes endpoint called");

    const hashes = await getAllSystemHashes(req);

    loggers.uploads.info({ count: hashes.length }, "Returning system hashes");

    res.json({
      success: true,
      hashes: hashes,
      count: hashes.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    loggers.uploads.error({ err: error }, "System hashes error");
    res.status(500).json({
      success: false,
      error: "Errore interno del server",
      details: error.message,
    });
  }
});

// Endpoint per ottenere gli hash dal nodo systemhash
router.get("/system-hashes-map", async (req, res) => {
  try {
    loggers.uploads.info("System hashes map endpoint called");

    const gun = getGunInstance(req);
    if (!gun) {
      loggers.uploads.warn("Gun instance not available for system hashes map");
      return res.status(500).json({
        success: false,
        error: "Gun instance not available",
      });
    }

    const systemHashesMap = await new Promise<Record<string, any>>((resolve) => {
      const timeoutId = setTimeout(() => {
        loggers.uploads.warn("Timeout for system hashes map retrieval");
        resolve({});
      }, 10000);

      const systemHashesNode = gun.get(GUN_PATHS.SYSTEM_HASH);

      systemHashesNode.once(async (systemHashesData: any) => {
        clearTimeout(timeoutId);

        loggers.uploads.debug({ systemHashesData }, "Raw systemHashesData from Gun");

        if (!systemHashesData || typeof systemHashesData !== "object") {
          loggers.uploads.warn("No system hashes found, returning empty map");
          resolve({});
          return;
        }

        // Ottieni le chiavi degli hash (escludi metadati Gun)
        const hashKeys = Object.keys(systemHashesData).filter(
          (key) => key !== "_" && key !== "#" && key !== ">" && key !== "<"
        );

        loggers.uploads.info({ count: hashKeys.length, keys: hashKeys }, "Found hash keys");

        if (hashKeys.length === 0) {
          loggers.uploads.warn("No hashes to process");
          resolve({});
          return;
        }

        // Per ogni hash, recupera i dati completi con un .once() separato
        const hashMap: any = {};
        let completed = 0;

        hashKeys.forEach((hashKey) => {
          systemHashesNode.get(hashKey).once((hashData: any) => {
            completed++;

            loggers.uploads.info({ hashKey }, "Processing hash");
            loggers.uploads.debug({ hashData }, "Raw data");

            if (hashData && typeof hashData === "object") {
              // Normalizza i dati rimuovendo i metadati Gun
              const normalized = normalizeGunRecord(hashData);
              loggers.uploads.debug({ normalized }, "Normalized data");
              hashMap[hashKey] = normalized;
            } else {
              loggers.uploads.warn({ hashKey }, "Invalid data for hash");
            }

            // Se abbiamo processato tutti gli hash, risolvi la promise
            if (completed === hashKeys.length) {
              loggers.uploads.info(
                { count: Object.keys(hashMap).length },
                "Found system hashes in map"
              );
              loggers.uploads.debug({ hashMap }, "Final hashMap");
              resolve(hashMap);
            }
          });
        });
      });
    });

    res.json({
      success: true,
      systemHashes: systemHashesMap,
      count: Object.keys(systemHashesMap).length,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    loggers.uploads.error({ err: error }, "System hashes map error");
    res.status(500).json({
      success: false,
      error: "Errore interno del server",
      details: error.message,
    });
  }
});

// Endpoint per salvare un hash nel nodo systemhash
router.post(
  "/save-system-hash",
  (req, res, next) => {
    // Only admin authentication is allowed
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];

    const adminToken = bearerToken || customToken;
    const isAdmin = validateAdminToken(adminToken);

    if (isAdmin) {
      (req as CustomRequest).authType = "admin";
      next();
    } else {
      loggers.uploads.warn({}, "Auth failed - Admin token");
      res.status(401).json({ success: false, error: "Unauthorized - Admin token required" });
    }
  },
  async (req, res) => {
    try {
      const {
        hash,
        userAddress,
        timestamp,
        fileName,
        fileSize,
        isEncrypted,
        contentType,
        relayUrl,
        originalName,
        // Campi aggiuntivi per directory e metadati completi
        files,
        fileCount,
        isDirectory,
        displayName,
        uploadedAt,
      } = req.body;

      if (!hash || !userAddress) {
        return res.status(400).json({
          success: false,
          error: "Hash e userAddress richiesti",
        });
      }

      loggers.uploads.info({ hash, userAddress }, "Saving hash to systemhash node");

      const gun = getGunInstance(req);
      if (!gun) {
        return res.status(500).json({
          success: false,
          error: "Gun instance not available",
        });
      }

      // Salva l'hash nel nodo systemhash
      await new Promise((resolve, reject) => {
        const systemHashesNode = gun.get(GUN_PATHS.SYSTEM_HASH);

        const now = Date.now();
        const hashRecord: any = {
          hash: hash,
          userAddress: userAddress,
          timestamp: timestamp || now,
          uploadedAt: uploadedAt || timestamp || now,
          savedAt: new Date().toISOString(),
        };

        // Campi base
        if (fileName) {
          hashRecord.fileName = fileName;
        }

        if (displayName) {
          hashRecord.displayName = displayName;
        } else if (fileName) {
          hashRecord.displayName = fileName;
        }

        if (typeof fileSize === "number") {
          hashRecord.fileSize = fileSize;
        }

        if (typeof isEncrypted === "boolean") {
          hashRecord.isEncrypted = isEncrypted;
        }

        if (contentType) {
          hashRecord.contentType = contentType;
        }

        if (relayUrl) {
          hashRecord.relayUrl = relayUrl;
        }

        if (originalName) {
          hashRecord.originalName = originalName;
        }

        // Campi per directory
        if (typeof isDirectory === "boolean") {
          hashRecord.isDirectory = isDirectory;
        }

        if (typeof fileCount === "number") {
          hashRecord.fileCount = fileCount;
        }

        // IMPORTANTE: Salva il campo 'files' per le directory
        // GunDB non può salvare array complessi direttamente, quindi convertiamo in JSON string
        if (files && Array.isArray(files)) {
          try {
            hashRecord.files = JSON.stringify(files);
            hashRecord.filesFormat = "json"; // Marca come JSON per il parsing
            loggers.uploads.debug(
              { fileCount: files.length },
              "Saving directory with files array as JSON string"
            );
          } catch (error) {
            loggers.uploads.warn({ err: error }, "Failed to stringify files array, skipping");
          }
        }

        loggers.uploads.debug({ hashRecord }, "Saving hash record");

        systemHashesNode.get(hash).put(hashRecord, (ack: any) => {
          if (ack && ack.err) {
            loggers.uploads.error({ err: ack.err }, "Error saving hash to systemhash node");
            reject(new Error(ack.err));
          } else {
            loggers.uploads.info(
              { hash },
              "Hash saved to systemhash node successfully with metadata"
            );
            resolve(undefined);
          }
        });
      });

      res.json({
        success: true,
        message: "Hash saved to systemhash node successfully",
        hash: hash,
        userAddress: userAddress,
        timestamp: timestamp,
      });
    } catch (error: any) {
      loggers.uploads.error({ err: error }, "Save system hash error");
      res.status(500).json({
        success: false,
        error: "Errore interno del server",
        details: error.message,
      });
    }
  }
);

// Endpoint per rimuovere un hash dal nodo systemhash
// Permette sia admin che utenti (per rimuovere i propri metadati)
router.delete(
  "/remove-system-hash/:hash",
  async (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    // Verifica se è admin
    const isAdmin = validateAdminToken(token);

    if (isAdmin) {
      (req as CustomRequest).authType = "admin";
      next();
      return;
    }

    // Se non è admin, verifica che l'utente possa rimuovere i propri metadati
    // Per ora permettiamo a chiunque con un token valido (puoi restringere in futuro)
    if (token) {
      (req as CustomRequest).authType = "user";
      next();
      return;
    }

    loggers.uploads.warn("Auth failed - No valid token");
    res.status(401).json({ success: false, error: "Unauthorized - Token required" });
  },
  async (req, res) => {
    try {
      const { hash } = req.params;
      const { userAddress } = req.body;

      if (!hash) {
        return res.status(400).json({
          success: false,
          error: "Hash richiesto",
        });
      }

      loggers.uploads.info(`Removing hash from systemhash node: ${hash}`);

      const gun = getGunInstance(req);
      if (!gun) {
        return res.status(500).json({
          success: false,
          error: "Gun instance not available",
        });
      }

      // Rimuovi l'hash dal nodo systemhash
      await new Promise((resolve, reject) => {
        const systemHashesNode = gun.get(GUN_PATHS.SYSTEM_HASH);

        systemHashesNode.get(hash).put(null, (ack: any) => {
          if (ack && ack.err) {
            loggers.uploads.error("❌ Error removing hash from systemhash node:", ack.err);
            reject(new Error(ack.err));
          } else {
            loggers.uploads.info(`✅ Hash ${hash} removed from systemhash node successfully`);
            resolve(undefined);
          }
        });
      });

      res.json({
        success: true,
        message: "Hash removed from systemhash node successfully",
        hash: hash,
        userAddress: userAddress,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      loggers.uploads.error({ err: error }, "Remove system hash error");
      res.status(500).json({
        success: false,
        error: "Errore interno del server",
        details: error.message,
      });
    }
  }
);

// ROUTE GENERICHE - DEVONO ESSERE DOPO LE ROUTE SPECIFICHE

// Endpoint per recuperare gli upload di un utente
router.get("/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    if (!identifier) {
      return res.status(400).json({ success: false, error: "Identificatore richiesto" });
    }

    loggers.uploads.info(`Loading upload for identifier: ${identifier}`);

    const gun = getGunInstance(req);
    const uploadsNode = gun.get(GUN_PATHS.UPLOADS).get(identifier);

    const getUploads = () => {
      return new Promise((resolve) => {
        let timeoutId;
        let dataReceived = false;

        timeoutId = setTimeout(() => {
          if (!dataReceived) {
            loggers.uploads.warn(`⏰ Timeout raggiunto per ${identifier}, restituendo array vuoto`);
            resolve([]);
          }
        }, 15000);

        uploadsNode.once((parentData: any) => {
          dataReceived = true;
          clearTimeout(timeoutId);

          if (!parentData || typeof parentData !== "object") {
            loggers.uploads.warn(`No data in parent node for: ${identifier}`);
            resolve([]);
            return;
          }

          const hashKeys = Object.keys(parentData).filter(
            (key) => key !== "_" && key !== "#" && key !== ">" && key !== "<"
          );

          if (hashKeys.length === 0) {
            loggers.uploads.warn(`No hash found for: ${identifier}`);
            resolve([]);
            return;
          }

          let uploadsArray: Array<any> = [];
          let completedReads = 0;
          const totalReads = hashKeys.length;

          hashKeys.forEach((hash) => {
            uploadsNode.get(hash).once((uploadData: any) => {
              completedReads++;

              if (uploadData && uploadData.hash) {
                uploadsArray.push(uploadData);
              }

              if (completedReads === totalReads) {
                uploadsArray.sort((a, b) => b.uploadedAt - a.uploadedAt);
                loggers.uploads.info(`✅ Found ${uploadsArray.length} uploads for: ${identifier}`);
                resolve(uploadsArray);
              }
            });
          });
        });
      });
    };

    const uploadsArray = (await getUploads()) as Array<any>;

    const response = {
      success: true,
      uploads: uploadsArray,
      identifier,
      count: uploadsArray.length,
      totalSizeMB: uploadsArray.reduce((sum: number, upload: any) => sum + (upload.sizeMB || 0), 0),
    };

    res.json(response);
  } catch (error: any) {
    const { identifier } = req.params;
    loggers.uploads.error({ err: error }, `Error loading upload for ${identifier}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint per eliminare un upload specifico
router.delete(
  "/:identifier/:hash",
  adminOrApiKeyAuthMiddleware,
  async (req, res) => {
    try {
      const { identifier, hash } = req.params;
      if (!identifier || !hash) {
        return res.status(400).json({ success: false, error: "Identificatore e hash richiesti" });
      }

      loggers.uploads.info(`Delete request for user: ${identifier}, file: ${hash}`);

      const gun = getGunInstance(req);
      const uploadNode = gun.get(GUN_PATHS.UPLOADS).get(identifier).get(hash);

      const fileData = await new Promise<any>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("File data read timeout"));
        }, 10000);

        uploadNode.once((data: any) => {
          clearTimeout(timeoutId);
          if (!data) {
            reject(new Error("File not found"));
          } else {
            resolve(data);
          }
        });
      });

      const fileSizeMB = Math.ceil(fileData.size / (1024 * 1024));
      loggers.uploads.info(`File size: ${fileData.size} bytes (${fileSizeMB} MB)`);

      // Remove file from uploads node in GunDB
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("Delete operation timeout"));
        }, 10000);

        uploadNode.put(null, (ack: any) => {
          clearTimeout(timeoutId);
          if (ack && ack.err) {
            loggers.uploads.error(`Error deleting file from uploads node:`, ack.err);
            reject(new Error(ack.err));
          } else {
            loggers.uploads.info(`✅ File ${hash} removed from uploads node successfully`);
            resolve(undefined);
          }
        });
      });

      // Update MB usage after deletion (legacy system)
      try {
        const { updateMBUsage } = await import("../utils/storage-utils.js");
        const newMB = await updateMBUsage(gun, identifier, -fileSizeMB);
        loggers.uploads.info(`MB usage updated: ${newMB} MB`);
      } catch (error: any) {
        loggers.uploads.warn(
          { err: error },
          `Failed to update MB usage after deletion:`,
          error.message
        );
        // Continue even if MB update fails
      }

      // Remove hash from systemhash node
      try {
        const adminToken = authConfig.adminPassword;
        if (!adminToken) {
          loggers.uploads.warn(`⚠️ ADMIN_PASSWORD not set, skipping system hash removal`);
        } else {
          // Call the remove-system-hash endpoint with admin token
          const postData = JSON.stringify({
            userAddress: identifier,
          });

          const options = {
            hostname: "localhost",
            port: 8765,
            path: `/api/v1/user-uploads/remove-system-hash/${hash}`,
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(postData),
              Authorization: `Bearer ${adminToken}`,
            },
          };

          await new Promise((resolve, reject) => {
            const req = http.request(options, (res) => {
              let data = "";
              res.on("data", (chunk) => {
                data += chunk;
              });
              res.on("end", () => {
                try {
                  const result = JSON.parse(data);
                  if (result.success) {
                    loggers.uploads.info(
                      { hash },
                      "Hash removed from systemhash node successfully via endpoint"
                    );
                    resolve(undefined);
                  } else {
                    loggers.uploads.error(
                      { err: result.error },
                      "Error removing hash from systemhash node via endpoint"
                    );
                    reject(new Error(result.error));
                  }
                } catch (parseError: any) {
                  loggers.uploads.error(
                    { err: parseError },
                    "Error parsing system hash removal response"
                  );
                  reject(new Error(parseError.message));
                }
              });
            });

            req.on("error", (error) => {
              loggers.uploads.error({ err: error }, "Error calling system hash removal endpoint");
              reject(error);
            });

            req.write(postData);
            req.end();
          });
        }
      } catch (error: any) {
        loggers.uploads.warn({ err: error }, `Failed to remove hash ${hash} from systemhash node`);
        // Continue even if systemhash removal fails
      }

      res.json({
        success: true,
        message: "Upload eliminato con successo",
        identifier,
        hash,
        deletedFile: {
          name: fileData.name,
          size: fileData.size,
          sizeMB: fileSizeMB,
        },
      });
    } catch (error: any) {
      loggers.uploads.error({ err: error }, "Delete error");
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

export default router;
