import express from 'express';

const router = express.Router();

// Middleware per ottenere l'istanza Gun dal relay
const getGunInstance = (req) => {
  return req.app.get('gunInstance');
};

// Funzione helper per ottenere l'utilizzo MB off-chain
async function getOffChainMBUsage(userAddress) {
  const gun = getGunInstance(req);
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("MB usage read timeout"));
    }, 10000);

    gun.get("shogun").get("mbUsage").get(userAddress).once((data) => {
      clearTimeout(timeoutId);
      if (!data) {
        resolve(0);
      } else {
        resolve(data.mbUsed || 0);
      }
    });
  });
}

// Funzione helper per salvare upload e aggiornare MB
async function saveUploadAndUpdateMB(userAddress, fileHash, uploadData, fileSizeMB) {
  const gun = getGunInstance(req);
  return new Promise((resolve, reject) => {
    try {
      // Salva i dati dell'upload
      gun.get("shogun").get("uploads").get(userAddress).get(fileHash).put(uploadData, (ack) => {
        if (ack && ack.err) {
          reject(new Error(ack.err));
          return;
        }

        // Aggiorna l'utilizzo MB
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
async function deleteUploadAndUpdateMB(userAddress, fileHash, fileSizeMB) {
  const gun = getGunInstance(req);
  return new Promise((resolve, reject) => {
    try {
      // Elimina i dati dell'upload
      gun.get("shogun").get("uploads").get(userAddress).get(fileHash).put(null, (ack) => {
        if (ack && ack.err) {
          reject(new Error(ack.err));
          return;
        }

        // Aggiorna l'utilizzo MB
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
    // Recupera gli upload dal database Gun
    const uploadsNode = gun.get("shogun").get("uploads").get(identifier);

    // Usa una Promise per gestire l'asincronia di Gun
    const getUploads = () => {
      return new Promise((resolve, reject) => {
        let timeoutId;
        let dataReceived = false;

        // Timeout di 15 secondi (aumentato per dare più tempo)
        timeoutId = setTimeout(() => {
          if (!dataReceived) {
            console.log(
              `⏰ Timeout raggiunto per ${identifier}, restituendo array vuoto`
            );
            resolve([]);
          }
        }, 15000);

        // Prima leggi il nodo padre per vedere se ci sono dati
        uploadsNode.once((parentData) => {
          dataReceived = true;
          clearTimeout(timeoutId);

          console.log(`📋 Parent node data:`, parentData);
          console.log(`📋 Parent data type:`, typeof parentData);
          console.log(
            `📋 Parent data keys:`,
            parentData ? Object.keys(parentData) : "N/A"
          );

          if (!parentData || typeof parentData !== "object") {
            console.log(`❌ Nessun dato nel nodo padre per: ${identifier}`);
            resolve([]);
            return;
          }

          // Ottieni tutte le chiavi (escludendo i metadati Gun)
          const hashKeys = Object.keys(parentData).filter(
            (key) => key !== "_"
          );
          console.log(`📋 Hash keys found:`, hashKeys);

          if (hashKeys.length === 0) {
            console.log(`❌ Nessun hash trovato per: ${identifier}`);
            resolve([]);
            return;
          }

          // Leggi ogni hash individualmente dalla struttura nidificata
          let uploadsArray = [];
          let completedReads = 0;
          const totalReads = hashKeys.length;

          hashKeys.forEach((hash) => {
            console.log(`📋 Reading hash: ${hash}`);
            uploadsNode.get(hash).once((uploadData) => {
              completedReads++;
              console.log(`📋 Upload data for ${hash}:`, uploadData);

              if (uploadData && uploadData.hash) {
                uploadsArray.push(uploadData);
                console.log(`✅ Added upload for hash: ${hash}`);
              } else {
                console.warn(
                  `⚠️ Invalid upload data for hash: ${hash}`,
                  uploadData
                );
              }

              // Se abbiamo letto tutti gli hash, risolvi
              if (completedReads === totalReads) {
                // Ordina per data di upload
                uploadsArray.sort((a, b) => b.uploadedAt - a.uploadedAt);

                console.log(`📋 Final uploads array:`, uploadsArray);
                console.log(
                  `✅ Found ${uploadsArray.length} uploads for: ${identifier}`
                );

                resolve(uploadsArray);
              }
            });
          });
        });
      });
    };

    // Attendi i dati con timeout
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

    console.log(`📋 Response finale:`, response);
    res.json(response);
  } catch (error) {
    console.error(`💥 Errore caricamento upload per ${identifier}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint per eliminare un upload specifico
router.delete("/:identifier/:hash", async (req, res) => {
  try {
    const { identifier, hash } = req.params;
    if (!identifier || !hash) {
      return res
        .status(400)
        .json({ success: false, error: "Identificatore e hash richiesti" });
    }

    console.log(`🗑️ Delete request for user: ${identifier}, file: ${hash}`);

    const gun = getGunInstance(req);
    // 1. Prima recupera i dati del file per ottenere la dimensione
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

    // 2. Calcola la dimensione in MB del file
    const fileSizeMB = Math.ceil(fileData.size / (1024 * 1024));
    console.log(`📊 File size: ${fileData.size} bytes (${fileSizeMB} MB)`);

    // 3. Ottieni l'utilizzo MB corrente prima dell'eliminazione
    const previousMBUsed = await getOffChainMBUsage(identifier);

    // 4. Elimina il file
    await deleteUploadAndUpdateMB(identifier, hash, fileSizeMB);

    // 5. Ottieni il nuovo utilizzo MB dopo l'eliminazione
    const newMBUsed = await getOffChainMBUsage(identifier);

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

// Endpoint di debug per verificare il contenuto Gun di un utente
router.get("/debug/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    if (!identifier) {
      return res
        .status(400)
        .json({ success: false, error: "Identificatore richiesto" });
    }

    console.log(`🔍 Debug: Caricando contenuto Gun per: ${identifier}`);

    const gun = getGunInstance(req);
    const uploadsNode = gun.get("shogun").get("uploads").get(identifier);

    // Usa una Promise per gestire l'asincronia di Gun
    const getDebugData = () => {
      return new Promise((resolve, reject) => {
        let timeoutId;
        let dataReceived = false;

        // Timeout di 20 secondi per debug
        timeoutId = setTimeout(() => {
          if (!dataReceived) {
            console.log(`⏰ Debug timeout per ${identifier}`);
            resolve({ rawData: null, detailedData: {}, error: "Timeout" });
          }
        }, 20000);

        // Listener per i dati del nodo padre
        uploadsNode.once((parentData) => {
          dataReceived = true;
          clearTimeout(timeoutId);

          console.log(`🔍 Debug parent data:`, parentData);
          console.log(`🔍 Debug parent type:`, typeof parentData);

          if (!parentData || typeof parentData !== "object") {
            resolve({
              rawData: parentData,
              detailedData: {},
              error: "No valid parent data",
            });
            return;
          }

          // Ottieni tutte le chiavi
          const allKeys = Object.keys(parentData);
          console.log(`🔍 Debug all keys:`, allKeys);

          // Filtra le chiavi non-Gun
          const hashKeys = allKeys.filter((key) => key !== "_");
          console.log(`🔍 Debug hash keys:`, hashKeys);

          // Prepara i dati dettagliati
          const detailedData = {
            totalKeys: allKeys.length,
            hashKeys: hashKeys.length,
            gunMetadata: allKeys.includes("_"),
            hashes: hashKeys,
          };

          resolve({
            rawData: parentData,
            detailedData: detailedData,
            error: null,
          });
        });
      });
    };

    // Attendi i dati di debug
    const debugData = await getDebugData();

    res.json({
      success: true,
      identifier,
      debug: debugData,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error(`💥 Debug error per ${identifier}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router; 