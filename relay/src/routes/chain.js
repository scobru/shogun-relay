import express from 'express';

const router = express.Router();

// Route per sincronizzare dal contratto a GunDB
router.post("/sync-to-gun", async (req, res) => {
  try {
    const syncChainContractToGun = req.app.get("syncChainContractToGun");
    if (!syncChainContractToGun) {
      return res.status(500).json({
        success: false,
        error: "Funzione sync non disponibile"
      });
    }

    console.log("🔄 Starting Chain contract to GunDB sync...");

    const result = await syncChainContractToGun();
    
    console.log("📊 Sync result:", result);

    if (result === true) {
      res.json({
        success: true,
        message: "Sincronizzazione completata con successo"
      });
    } else if (result === false) {
      res.json({
        success: false,
        error: "Sincronizzazione fallita - controlla i log del server"
      });
    } else {
      res.json({
        success: false,
        error: "Risultato sincronizzazione non valido",
        details: `Risultato: ${result}`
      });
    }

  } catch (error) {
    console.error("❌ Chain sync error:", error);
    res.status(500).json({
      success: false,
      error: "Errore sincronizzazione",
      details: error.message || "Errore sconosciuto"
    });
  }
});

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