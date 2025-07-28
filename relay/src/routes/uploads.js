import express from 'express';

const router = express.Router();

// Middleware per ottenere l'istanza Gun dal relay
const getGunInstance = (req) => {
  return req.app.get('gunInstance');
};

// Funzione helper per ottenere tutti gli hash del sistema
async function getAllSystemHashes(req) {
  const gun = getGunInstance(req);
  if (!gun) {
    console.warn('Gun instance not available for system hashes');
    return [];
  }
  
  console.log('🔍 Getting all system file hashes...');
  
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      console.log('⏰ Timeout for system hashes retrieval');
      resolve([]);
    }, 10000);

    const uploadsNode = gun.get("shogun").get("uploads");
    
    uploadsNode.once((uploadsData) => {
      clearTimeout(timeoutId);
      
      if (!uploadsData || typeof uploadsData !== "object") {
        console.log('📋 No uploads found, returning empty array');
        resolve([]);
        return;
      }

      const userAddresses = Object.keys(uploadsData).filter(
        (key) => key !== "_" && key !== "#" && key !== ">" && key !== "<"
      );

      if (userAddresses.length === 0) {
        console.log('📋 No users found, returning empty array');
        resolve([]);
        return;
      }

      let allHashes = [];
      let completedUsers = 0;
      const totalUsers = userAddresses.length;

      userAddresses.forEach((userAddress) => {
        const userUploadsNode = uploadsNode.get(userAddress);
        
        userUploadsNode.once((userData) => {
          completedUsers++;

          if (userData && typeof userData === "object") {
            const userHashes = Object.keys(userData).filter(
              (key) => key !== "_" && key !== "#" && key !== ">" && key !== "<"
            );
            allHashes = allHashes.concat(userHashes);
          }

          if (completedUsers === totalUsers) {
            console.log(`📋 Found ${allHashes.length} system hashes`);
            resolve(allHashes);
          }
        });
      });
    });
  });
}

// Funzione helper per ottenere l'utilizzo MB off-chain
async function getOffChainMBUsage(userAddress, req) {
  const gun = getGunInstance(req);
  if (!gun) {
    console.warn('Gun instance not available for MB usage calculation');
    return 0;
  }
  
  console.log(`🔍 Calculating offchain MB usage for: ${userAddress}`);
  
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      console.log(`⏰ Timeout for MB usage calculation for: ${userAddress}`);
      resolve(0);
    }, 10000);

    const uploadsNode = gun.get("shogun").get("uploads").get(userAddress);
    
    uploadsNode.once((parentData) => {
      clearTimeout(timeoutId);
      
      if (!parentData || typeof parentData !== "object") {
        console.log(`📋 No uploads found for ${userAddress}, returning 0 MB`);
        resolve(0);
        return;
      }

      const hashKeys = Object.keys(parentData).filter(
        (key) => key !== "_" && key !== "#" && key !== ">" && key !== "<"
      );

      if (hashKeys.length === 0) {
        console.log(`📋 No files found for ${userAddress}, returning 0 MB`);
        resolve(0);
        return;
      }

      let totalMB = 0;
      let completedReads = 0;
      const totalReads = hashKeys.length;

      hashKeys.forEach((hash) => {
        uploadsNode.get(hash).once((uploadData) => {
          completedReads++;

          if (uploadData && uploadData.sizeMB) {
            totalMB += uploadData.sizeMB;
          }

          if (completedReads === totalReads) {
            console.log(`📊 Final MB calculation for ${userAddress}: ${totalMB} MB from ${totalReads} files`);
            resolve(totalMB);
          }
        });
      });
    });
  });
}

// Funzione helper per salvare upload e aggiornare MB
async function saveUploadAndUpdateMB(userAddress, fileHash, uploadData, fileSizeMB, req) {
  const gun = getGunInstance(req);
  return new Promise((resolve, reject) => {
    try {
      gun.get("shogun").get("uploads").get(userAddress).get(fileHash).put(uploadData, (ack) => {
        if (ack && ack.err) {
          reject(new Error(ack.err));
          return;
        }

        gun.get("shogun").get("mbUsage").get(userAddress).once((currentData) => {
          const currentMB = currentData ? (currentData.mbUsed || 0) : 0;
          const newMB = currentMB + fileSizeMB;

          gun.get("shogun").get("mbUsage").get(userAddress).put({
            mbUsed: newMB,
            lastUpdated: Date.now(),
            userAddress: userAddress
          }, (mbAck) => {
            if (mbAck && mbAck.err) {
              reject(new Error(mbAck.err));
            } else {
              resolve(newMB);
            }
          });
        });
      });
    } catch (error) {
      reject(error);
    }
  });
}

// Funzione helper per eliminare upload e aggiornare MB
async function deleteUploadAndUpdateMB(userAddress, fileHash, fileSizeMB, req) {
  const gun = getGunInstance(req);
  return new Promise((resolve, reject) => {
    try {
      gun.get("shogun").get("uploads").get(userAddress).get(fileHash).put(null, (ack) => {
        if (ack && ack.err) {
          reject(new Error(ack.err));
          return;
        }

        gun.get("shogun").get("mbUsage").get(userAddress).once((currentData) => {
          const currentMB = currentData ? (currentData.mbUsed || 0) : 0;
          const newMB = Math.max(0, currentMB - fileSizeMB);

          gun.get("shogun").get("mbUsage").get(userAddress).put({
            mbUsed: newMB,
            lastUpdated: Date.now(),
            userAddress: userAddress
          }, (mbAck) => {
            if (mbAck && mbAck.err) {
              reject(new Error(mbAck.err));
            } else {
              resolve(newMB);
            }
          });
        });
      });
    } catch (error) {
      reject(error);
    }
  });
}

// Endpoint per recuperare gli upload di un utente
router.get("/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    if (!identifier) {
      return res
        .status(400)
        .json({ success: false, error: "Identificatore richiesto" });
    }

    console.log(`📂 Caricando upload per identificatore: ${identifier}`);

    const gun = getGunInstance(req);
    const uploadsNode = gun.get("shogun").get("uploads").get(identifier);

    const getUploads = () => {
      return new Promise((resolve) => {
        let timeoutId;
        let dataReceived = false;

        timeoutId = setTimeout(() => {
          if (!dataReceived) {
            console.log(`⏰ Timeout raggiunto per ${identifier}, restituendo array vuoto`);
            resolve([]);
          }
        }, 15000);

        uploadsNode.once((parentData) => {
          dataReceived = true;
          clearTimeout(timeoutId);

          if (!parentData || typeof parentData !== "object") {
            console.log(`❌ Nessun dato nel nodo padre per: ${identifier}`);
            resolve([]);
            return;
          }

          const hashKeys = Object.keys(parentData).filter(
            (key) => key !== "_" && key !== "#" && key !== ">" && key !== "<"
          );

          if (hashKeys.length === 0) {
            console.log(`❌ Nessun hash trovato per: ${identifier}`);
            resolve([]);
            return;
          }

          let uploadsArray = [];
          let completedReads = 0;
          const totalReads = hashKeys.length;

          hashKeys.forEach((hash) => {
            uploadsNode.get(hash).once((uploadData) => {
              completedReads++;

              if (uploadData && uploadData.hash) {
                uploadsArray.push(uploadData);
              }

              if (completedReads === totalReads) {
                uploadsArray.sort((a, b) => b.uploadedAt - a.uploadedAt);
                console.log(`✅ Found ${uploadsArray.length} uploads for: ${identifier}`);
                resolve(uploadsArray);
              }
            });
          });
        });
      });
    };

    const uploadsArray = await getUploads();

    const response = {
      success: true,
      uploads: uploadsArray,
      identifier,
      count: uploadsArray.length,
      totalSizeMB: uploadsArray.reduce(
        (sum, upload) => sum + (upload.sizeMB || 0),
        0
      ),
    };

    res.json(response);
  } catch (error) {
    console.error(`💥 Errore caricamento upload per ${identifier}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint per eliminare un upload specifico
router.delete("/:identifier/:hash", (req, res, next) => {
  const walletSignatureMiddleware = req.app.get('walletSignatureMiddleware');
  if (walletSignatureMiddleware) {
    walletSignatureMiddleware(req, res, next);
  } else {
    next();
  }
}, async (req, res) => {
  try {
    const { identifier, hash } = req.params;
    if (!identifier || !hash) {
      return res
        .status(400)
        .json({ success: false, error: "Identificatore e hash richiesti" });
    }

    console.log(`🗑️ Delete request for user: ${identifier}, file: ${hash}`);

    const gun = getGunInstance(req);
    const uploadNode = gun
      .get("shogun")
      .get("uploads")
      .get(identifier)
      .get(hash);

    const fileData = await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("File data read timeout"));
      }, 10000);

      uploadNode.once((data) => {
        clearTimeout(timeoutId);
        if (!data) {
          reject(new Error("File not found"));
        } else {
          resolve(data);
        }
      });
    });

    const fileSizeMB = Math.ceil(fileData.size / (1024 * 1024));
    console.log(`📊 File size: ${fileData.size} bytes (${fileSizeMB} MB)`);

    const previousMBUsed = await getOffChainMBUsage(identifier, req);
    await deleteUploadAndUpdateMB(identifier, hash, fileSizeMB, req);
    const newMBUsed = await getOffChainMBUsage(identifier, req);

    res.json({
      success: true,
      message: "Upload eliminato con successo",
      identifier,
      hash,
      deletedFile: {
        name: fileData.name,
        size: fileData.size,
        sizeMB: fileData.sizeMB,
      },
      mbUsage: {
        previousMB: previousMBUsed,
        currentMB: newMBUsed,
        freedMB: previousMBUsed - newMBUsed,
      },
    });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint per sincronizzare i MB utilizzati
router.post("/sync-mb-usage/:userAddress", async (req, res) => {
  try {
    const { userAddress } = req.params;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: "Indirizzo utente richiesto",
      });
    }

    console.log(`🔄 Syncing MB usage for user: ${userAddress}`);

    const totalSizeMB = await getOffChainMBUsage(userAddress, req);

    const gun = getGunInstance(req);
    const uploadsNode = gun.get("shogun").get("uploads").get(userAddress);
    const fileCount = await new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve(0);
      }, 5000);

      uploadsNode.once((parentData) => {
        clearTimeout(timeoutId);
        if (!parentData || typeof parentData !== "object") {
          resolve(0);
          return;
        }
        const hashKeys = Object.keys(parentData).filter(
          (key) => key !== "_" && key !== "#" && key !== ">" && key !== "<"
        );
        resolve(hashKeys.length);
      });
    });

    console.log(`✅ MB usage synced: ${totalSizeMB} MB (${fileCount} files)`);

    res.json({
      success: true,
      message: "MB usage synchronized successfully",
      userAddress,
      mbUsed: totalSizeMB,
      fileCount: fileCount,
      lastUpdated: new Date().toISOString(),
      storage: "real-time-calculation",
    });
  } catch (error) {
    console.error("Sync MB usage error:", error);
    res.status(500).json({
      success: false,
      error: "Errore interno del server",
      details: error.message,
    });
  }
});

// Endpoint per ottenere tutti gli hash del sistema (per il pin manager)
router.get("/system-hashes", async (req, res) => {
  try {
    console.log('🔍 System hashes endpoint called');
    
    const hashes = await getAllSystemHashes(req);
    
    console.log(`📋 Returning ${hashes.length} system hashes`);
    
    res.json({
      success: true,
      hashes: hashes,
      count: hashes.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("System hashes error:", error);
    res.status(500).json({
      success: false,
      error: "Errore interno del server",
      details: error.message,
    });
  }
});

export { getOffChainMBUsage };
export default router;