import express from 'express';
import { ethers } from 'ethers';

const router = express.Router();

// Route per avviare l'ascolto eventi
router.post("/start-events", async (req, res) => {
  try {
    const startChainEventListener = req.app.get("startChainEventListener");
    if (!startChainEventListener) {
      return res.status(500).json({
        success: false,
        error: "Funzione event listener non disponibile"
      });
    }

    console.log("🎧 Starting Chain contract event listener...");

    const result = await startChainEventListener();

    res.json({
      success: result,
      message: result ? "Event listener avviato" : "Event listener non avviato"
    });

  } catch (error) {
    console.error("❌ Chain event listener error:", error);
    res.status(500).json({
      success: false,
      error: "Errore avvio event listener",
      details: error.message
    });
  }
});

// Route per ottenere lo stato del contratto Chain
router.get("/status", async (req, res) => {
  try {
    const chainContract = req.app.get("chainContract");
    
    if (!chainContract) {
      return res.json({
        success: false,
        status: "not_initialized",
        message: "Contratto Chain non inizializzato"
      });
    }

    // Ottieni informazioni sul contratto
    const address = chainContract.target;
    const owner = await chainContract.owner();

    res.json({
      success: true,
      status: "initialized",
      address: address,
      owner: owner,
      network: "Sepolia"
    });

  } catch (error) {
    console.error("❌ Chain status error:", error);
    res.status(500).json({
      success: false,
      error: "Errore ottenimento stato contratto",
      details: error.message
    });
  }
});

// Route per testare la conversione degli hash
router.get("/hash-test/:hash", async (req, res) => {
  try {
    const { hash } = req.params;
    
    // Funzione per convertire hash keccak256 in stringhe leggibili
    function hashToReadableString(hash) {
      if (!hash || typeof hash !== 'string') {
        return hash;
      }
      
      // Se è un hash keccak256 (64 caratteri hex + 0x)
      if (hash.startsWith('0x') && hash.length === 66) {
        // Per ora, usa i primi 8 caratteri come identificatore leggibile
        return `hash_${hash.substring(2, 10)}`;
      }
      
      return hash;
    }

    const readableString = hashToReadableString(hash);
    
    res.json({
      success: true,
      originalHash: hash,
      readableString: readableString,
      isKeccak256: hash.startsWith('0x') && hash.length === 66,
      note: "Converte hash keccak256 in stringhe leggibili per GunDB"
    });

  } catch (error) {
    console.error("❌ Hash test error:", error);
    res.status(500).json({
      success: false,
      error: "Errore test hash",
      details: error.message
    });
  }
});

// Route per leggere i dati grezzi dal contratto
router.get("/contract-read/:soul/:key", async (req, res) => {
  try {
    const { soul, key } = req.params;
    const chainContract = req.app.get("chainContract");
    
    if (!chainContract) {
      return res.status(500).json({
        success: false,
        error: "Contratto Chain non inizializzato"
      });
    }

    console.log(`🔍 Reading from contract: soul=${soul}, key=${key}`);

    // Converti in bytes come fa il contratto
    const soulBytes = ethers.toUtf8Bytes(soul);
    const keyBytes = ethers.toUtf8Bytes(key);

    try {
      // Leggi dal contratto
      const value = await chainContract.getNode(soulBytes, keyBytes);
      
      console.log("🔍 Raw contract response:", {
        value: value,
        valueType: typeof value,
        valueLength: value ? value.length : 0
      });

      // Prova a decodificare il valore
      let decodedValue;
      try {
        decodedValue = ethers.toUtf8String(value);
        console.log("✅ Value decoded successfully:", decodedValue);
      } catch (decodeError) {
        console.warn("⚠️ Could not decode value:", decodeError.message);
        decodedValue = value;
      }

      res.json({
        success: true,
        request: { soul, key },
        contractResponse: {
          rawValue: value,
          decodedValue: decodedValue,
          valueHex: value ? ethers.hexlify(value) : null
        },
        encoding: {
          soulBytes: Array.from(soulBytes),
          keyBytes: Array.from(keyBytes),
          soulHex: ethers.hexlify(soulBytes),
          keyHex: ethers.hexlify(keyBytes)
        }
      });

    } catch (contractError) {
      console.error("❌ Contract read error:", contractError);
      res.json({
        success: false,
        error: "Errore lettura dal contratto",
        details: contractError.message,
        request: { soul, key },
        encoding: {
          soulBytes: Array.from(soulBytes),
          keyBytes: Array.from(keyBytes),
          soulHex: ethers.hexlify(soulBytes),
          keyHex: ethers.hexlify(keyBytes)
        }
      });
    }

  } catch (error) {
    console.error("❌ Contract read error:", error);
    res.status(500).json({
      success: false,
      error: "Errore lettura contratto",
      details: error.message
    });
  }
});

// Route per testare la decodifica dei dati dal contratto
router.get("/decode-test/:soul/:key", async (req, res) => {
  try {
    const { soul, key } = req.params;
    const chainContract = req.app.get("chainContract");
    
    if (!chainContract) {
      return res.status(500).json({
        success: false,
        error: "Contratto Chain non inizializzato"
      });
    }

    console.log(`🔍 Testing decode for soul: ${soul}, key: ${key}`);

    // Converti le stringhe in bytes (simula quello che fa il contratto)
    const soulBytes = ethers.toUtf8Bytes(soul);
    const keyBytes = ethers.toUtf8Bytes(key);
    
    console.log("🔍 Encoded bytes:", {
      soulBytes: soulBytes,
      keyBytes: keyBytes,
      soulHex: ethers.hexlify(soulBytes),
      keyHex: ethers.hexlify(keyBytes)
    });

    // Prova a decodificare
    try {
      const decodedSoul = ethers.toUtf8String(soulBytes);
      const decodedKey = ethers.toUtf8String(keyBytes);
      
      res.json({
        success: true,
        original: { soul, key },
        encoded: {
          soulBytes: Array.from(soulBytes),
          keyBytes: Array.from(keyBytes),
          soulHex: ethers.hexlify(soulBytes),
          keyHex: ethers.hexlify(keyBytes)
        },
        decoded: {
          soul: decodedSoul,
          key: decodedKey
        },
        note: "Questo test mostra come i dati vengono codificati/decodificati"
      });
    } catch (decodeError) {
      res.json({
        success: false,
        error: "Decode failed",
        details: decodeError.message,
        original: { soul, key },
        encoded: {
          soulBytes: Array.from(soulBytes),
          keyBytes: Array.from(keyBytes),
          soulHex: ethers.hexlify(soulBytes),
          keyHex: ethers.hexlify(keyBytes)
        }
      });
    }

  } catch (error) {
    console.error("❌ Decode test error:", error);
    res.status(500).json({
      success: false,
      error: "Errore test decodifica",
      details: error.message
    });
  }
});

// Route per leggere i dati da GunDB
router.get("/read/:soul/:key?", async (req, res) => {
  try {
    const { soul, key } = req.params;
    const gun = req.app.get("gunInstance");
    
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: "Gun non inizializzato"
      });
    }

    if (!soul) {
      return res.status(400).json({
        success: false,
        error: "Soul è richiesto"
      });
    }

    console.log(`🔍 Reading from GunDB: soul="${soul}", key="${key || 'all'}"`);

    // Se non è specificata una chiave, leggi tutto il nodo
    if (!key) {
      const node = gun.get(soul);
      const data = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          console.warn("⚠️ Timeout reading from GunDB");
          reject(new Error("Timeout"));
        }, 3000);

        node.once((data) => {
          clearTimeout(timeoutId);
          resolve(data);
        });
      });

      res.json({
        success: true,
        soul: soul,
        data: data,
        timestamp: Date.now()
      });
    } else {
      // Leggi una chiave specifica
      const node = gun.get(soul).get(key);
      const data = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          console.warn("⚠️ Timeout reading from GunDB");
          reject(new Error("Timeout"));
        }, 3000);

        node.once((data) => {
          clearTimeout(timeoutId);
          resolve(data);
        });
      });

      res.json({
        success: true,
        soul: soul,
        key: key,
        value: data,
        timestamp: Date.now()
      });
    }

  } catch (error) {
    console.error("❌ Chain read error:", error);
    res.status(500).json({
      success: false,
      error: "Errore lettura da GunDB",
      details: error.message
    });
  }
});

// Route per ottenere gli eventi recenti dal GunDB
router.get("/events", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: "Gun non inizializzato"
      });
    }

    const limit = parseInt(req.query.limit) || 50;
    
    console.log(`🔍 Reading chain events from GunDB, limit: ${limit}`);
    
    // Ottieni gli eventi recenti dal GunDB
    const eventsNode = gun.get("shogun").get("chain_events");
    
    // Per ora restituiamo un messaggio informativo
    // In una implementazione completa, dovremmo leggere tutti gli eventi dal GunDB
    
    res.json({
      success: true,
      message: "Eventi disponibili nel GunDB",
      limit: limit,
      note: "Implementazione completa richiede lettura asincrona dal GunDB",
      endpoint: "/api/v1/chain/read/shogun/chain_events per leggere gli eventi"
    });

  } catch (error) {
    console.error("❌ Chain events error:", error);
    res.status(500).json({
      success: false,
      error: "Errore ottenimento eventi",
      details: error.message
    });
  }
});

// Route per testare lo stato del contratto e delle funzioni
router.get("/test", async (req, res) => {
  try {
    const chainContract = req.app.get("chainContract");
    const syncChainContractToGun = req.app.get("syncChainContractToGun");
    
    const testResults = {
      contractInitialized: !!chainContract,
      syncFunctionAvailable: !!syncChainContractToGun,
      timestamp: Date.now()
    };
    
    if (chainContract) {
      try {
        const address = chainContract.target;
        const owner = await chainContract.owner();
        testResults.contractDetails = {
          address: address,
          owner: owner,
          hasQueryFilter: !!chainContract.queryFilter,
          hasFilters: !!chainContract.filters,
          hasNodeUpdatedFilter: !!(chainContract.filters && chainContract.filters.NodeUpdated)
        };
      } catch (error) {
        testResults.contractError = error.message;
      }
    }
    
    res.json({
      success: true,
      testResults: testResults
    });

  } catch (error) {
    console.error("❌ Chain test error:", error);
    res.status(500).json({
      success: false,
      error: "Errore test",
      details: error.message
    });
  }
});

// Route per testare la sincronizzazione con dati specifici
router.post("/test-sync", async (req, res) => {
  try {
    const { soul, key, value } = req.body;
    
    if (!soul || !key || value === undefined) {
      return res.status(400).json({
        success: false,
        error: "Soul, key e value sono richiesti"
      });
    }

    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: "Gun non inizializzato"
      });
    }

    console.log("🧪 Test sync with data:", { soul, key, value });

    // Scrivi i dati su GunDB
    const dataNode = gun.get(soul);
    await new Promise((resolve, reject) => {
      dataNode.get(key).put(value, (ack) => {
        if (ack.err) {
          reject(ack.err);
        } else {
          resolve();
        }
      });
    });

    console.log("✅ Test data written to GunDB");

    res.json({
      success: true,
      message: "Test data written to GunDB",
      data: { soul, key, value }
    });

  } catch (error) {
    console.error("❌ Test sync error:", error);
    res.status(500).json({
      success: false,
      error: "Errore test sync",
      details: error.message
    });
  }
});

// Route per sincronizzare con parametri personalizzabili
router.post("/sync-custom", async (req, res) => {
  try {
    const { fromBlock, toBlock, forceSync } = req.body;
    
    const syncChainContractToGun = req.app.get("syncChainContractToGun");
    if (!syncChainContractToGun) {
      return res.status(500).json({
        success: false,
        error: "Funzione sync non disponibile"
      });
    }

    console.log("🔄 Starting custom Chain contract to GunDB sync...", { fromBlock, toBlock, forceSync });

    // Se non specificati, usa i valori di default
    const syncParams = {
      fromBlock: fromBlock || null,
      toBlock: toBlock || null,
      forceSync: forceSync || false
    };

    const result = await syncChainContractToGun(syncParams);
    
    console.log("📊 Custom sync result:", result);

    if (result === true) {
      res.json({
        success: true,
        message: "Sincronizzazione personalizzata completata con successo",
        params: syncParams
      });
    } else if (result === false) {
      res.json({
        success: false,
        error: "Sincronizzazione personalizzata fallita - controlla i log del server",
        params: syncParams
      });
    } else {
      res.json({
        success: false,
        error: "Risultato sincronizzazione non valido",
        details: `Risultato: ${result}`,
        params: syncParams
      });
    }

  } catch (error) {
    console.error("❌ Custom chain sync error:", error);
    res.status(500).json({
      success: false,
      error: "Errore sincronizzazione personalizzata",
      details: error.message || "Errore sconosciuto"
    });
  }
});

// Route per verificare lo stato del listener e testare la propagazione
router.get("/listener-status", async (req, res) => {
  try {
    const chainContract = req.app.get("chainContract");
    const gun = req.app.get("gunInstance");
    
    const status = {
      contractInitialized: !!chainContract,
      gunInitialized: !!gun,
      timestamp: Date.now()
    };
    
    if (chainContract) {
      try {
        status.contractAddress = chainContract.target;
        status.hasEventListeners = chainContract.listenerCount("NodeUpdated") > 0;
        status.listenerCount = chainContract.listenerCount("NodeUpdated");
      } catch (error) {
        status.contractError = error.message;
      }
    }
    
    res.json({
      success: true,
      status: status
    });

  } catch (error) {
    console.error("❌ Listener status error:", error);
    res.status(500).json({
      success: false,
      error: "Errore verifica listener",
      details: error.message
    });
  }
});

// Route per forzare la propagazione di un evento di test
router.post("/test-propagation", async (req, res) => {
  try {
    const { soul, key, value } = req.body;
    
    if (!soul || !key || value === undefined) {
      return res.status(400).json({
        success: false,
        error: "Soul, key e value sono richiesti"
      });
    }

    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: "Gun non inizializzato"
      });
    }

    console.log("🧪 Test propagation with data:", { soul, key, value });

    // Simula un evento di test
    const testEvent = {
      transactionHash: "0x" + "0".repeat(64),
      logIndex: 0,
      blockNumber: 0
    };

    // Chiama la funzione di propagazione
    const propagateChainEventToGun = req.app.get("propagateChainEventToGun");
    if (propagateChainEventToGun) {
      await propagateChainEventToGun(soul, key, value, testEvent);
      
      res.json({
        success: true,
        message: "Test propagation completed",
        data: { soul, key, value }
      });
    } else {
      res.status(500).json({
        success: false,
        error: "Propagation function not available"
      });
    }

  } catch (error) {
    console.error("❌ Test propagation error:", error);
    res.status(500).json({
      success: false,
      error: "Errore test propagation",
      details: error.message
    });
  }
});

// Route per riavviare il listener
router.post("/restart-listener", async (req, res) => {
  try {
    const chainContract = req.app.get("chainContract");
    const startChainEventListener = req.app.get("startChainEventListener");
    
    if (!chainContract) {
      return res.status(500).json({
        success: false,
        error: "Contratto Chain non inizializzato"
      });
    }

    console.log("🔄 Restarting Chain contract event listener...");

    // Rimuovi tutti i listener esistenti
    try {
      chainContract.removeAllListeners("NodeUpdated");
      console.log("🗑️ Removed existing listeners");
    } catch (error) {
      console.warn("⚠️ Could not remove existing listeners:", error.message);
    }

    // Riavvia il listener
    const result = await startChainEventListener();
    
    if (result) {
      // Verifica che il listener sia attivo
      const listenerCount = chainContract.listenerCount("NodeUpdated");
      const hasEventListeners = listenerCount > 0;
      
      res.json({
        success: true,
        message: "Listener riavviato con successo",
        status: {
          listenerCount: listenerCount,
          hasEventListeners: hasEventListeners,
          timestamp: Date.now()
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: "Errore riavvio listener"
      });
    }

  } catch (error) {
    console.error("❌ Restart listener error:", error);
    res.status(500).json({
      success: false,
      error: "Errore riavvio listener",
      details: error.message
    });
  }
});

export default router; 