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
    
    // Ottieni gli eventi recenti dal GunDB
    const eventsNode = gun.get("shogun").get("chain_events");
    
    // Per ora restituiamo un messaggio informativo
    // In una implementazione completa, dovremmo leggere tutti gli eventi dal GunDB
    
    res.json({
      success: true,
      message: "Eventi disponibili nel GunDB",
      limit: limit,
      note: "Implementazione completa richiede lettura asincrona dal GunDB"
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

export default router; 