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

    res.json({
      success: result,
      message: result ? "Sincronizzazione completata" : "Sincronizzazione fallita"
    });

  } catch (error) {
    console.error("❌ Chain sync error:", error);
    res.status(500).json({
      success: false,
      error: "Errore sincronizzazione",
      details: error.message
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

export default router; 