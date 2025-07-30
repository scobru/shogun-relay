import express from 'express';
import rateLimit from 'express-rate-limit';
import ShogunCore from 'shogun-core';
import { ethers } from 'ethers';

const router = express.Router();

const getGunInstance = (req) => {
  return req.app.get('gunInstance');
};

// Rate limiting per le route di autenticazione
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 5, // massimo 5 tentativi per IP
  message: { 
    success: false, 
    message: 'Troppi tentativi di accesso. Riprova tra 15 minuti.', 
    data: null 
  }
});

// Inizializza Shogun Core con la configurazione del relay
let shogunInstance = null;

function initializeShogunCore(req) {
  if (shogunInstance) return shogunInstance;

  const peers = process.env.RELAY_PEERS ? process.env.RELAY_PEERS.split(',') : [
    "wss://ruling-mastodon-improved.ngrok-free.app/gun",
    "https://gun-manhattan.herokuapp.com/gun",
    "https://peer.wallie.io/gun",
  ];

  const gun = req ? getGunInstance(req) : null;
  
  shogunInstance = new ShogunCore({
    gunInstance: gun,
    appToken: process.env.ADMIN_PASSWORD,
    authToken: process.env.ADMIN_PASSWORD,
    peers: peers,
    scope: "shogun-relay",
    web3: { enabled: true },
    webauthn: {
      enabled: true,
      rpName: "Shogun Relay",
      rpId: process.env.RELAY_HOST || "localhost",
    },
    nostr: { enabled: true },
    timeouts: {
      login: 30000,
      signup: 30000,
      operation: 60000,
    },
  });

  return shogunInstance;
}

// Middleware per ottenere l'istanza Shogun Core
const getShogunInstance = (req) => {
  if (!shogunInstance) {
    shogunInstance = initializeShogunCore(req);
  }
  return shogunInstance;
};

// Route per la registrazione utente (tradizionale)
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, passphrase, hint } = req.body;
    
    if (!email || !passphrase) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email e passphrase sono richiesti', 
        data: null 
      });
    }

    const shogun = getShogunInstance(req);
    
    // Inizializza Shogun Core se non è già inizializzato
    if (!shogun.isInitialized) {
      await shogun.initialize();
    }

    const signUpResult = await shogun.signUp(email, passphrase);
    
    if (!signUpResult.success) {
      return res.status(400).json({ 
        success: false, 
        message: signUpResult.error || 'Registrazione fallita', 
        data: null 
      });
    }

    // Login automatico dopo la registrazione
    const loginResult = await shogun.login(email, passphrase);
    
    if (!loginResult.success) {
      return res.status(400).json({ 
        success: false, 
        message: 'Registrazione completata ma login automatico fallito', 
        data: null 
      });
    }

    // Crea il profilo utente
    const profile = { email, hint };
    await shogun.updateUserAlias(email);

    return res.status(201).json({ 
      success: true, 
      message: 'Utente creato con successo', 
      data: {
        email,
        pub: loginResult.pub,
        epub: loginResult.epub,
        profile: profile
      }
    });
  } catch (error) {
    console.error('Errore durante la registrazione:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Errore interno del server', 
      data: null 
    });
  }
});

// Route per il login utente (tradizionale)
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, passphrase } = req.body;
    
    if (!email || !passphrase) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email e passphrase sono richiesti', 
        data: null 
      });
    }

    const shogun = getShogunInstance(req);
    
    if (!shogun.isInitialized) {
      await shogun.initialize();
    }

    const loginResult = await shogun.login(email, passphrase);
    
    if (!loginResult.success) {
      return res.status(400).json({ 
        success: false, 
        message: loginResult.error || 'Credenziali non valide', 
        data: null 
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Login effettuato con successo', 
      data: {
        email,
        pub: loginResult.pub,
        epub: loginResult.epub,
        profile: loginResult.profile || {}
      }
    });
  } catch (error) {
    console.error('Errore durante il login:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Errore interno del server', 
      data: null 
    });
  }
});

// Route per il logout utente
router.post('/logout', async (req, res) => {
  try {
    const shogun = getShogunInstance(req);
    shogun.logout();
    
    return res.status(200).json({ 
      success: true, 
      message: 'Logout effettuato con successo', 
      data: null 
    });
  } catch (error) {
    console.error('Errore durante il logout:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Errore interno del server', 
      data: null 
    });
  }
});

// Route per Web3 authentication
router.post('/web3/login', authLimiter, async (req, res) => {
  try {
    const { address, signature, message } = req.body;
    
    if (!address || !signature) {
      return res.status(400).json({ 
        success: false, 
        message: 'Indirizzo e firma sono richiesti', 
        data: null 
      });
    }

    const shogun = getShogunInstance(req);
    
    if (!shogun.isInitialized) {
      await shogun.initialize();
    }

    const web3Plugin = shogun.getPlugin("web3");
    if (!web3Plugin || !web3Plugin.isAvailable()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Web3 non disponibile', 
        data: null 
      });
    }

    // Verifica la firma
    const provider = await web3Plugin.getProvider();
    const recoveredAddress = ethers.verifyMessage(message || "I Love Shogun", signature);
    
    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Firma non valida', 
        data: null 
      });
    }

    const loginResult = await web3Plugin.login(address);
    
    if (!loginResult.success) {
      return res.status(400).json({ 
        success: false, 
        message: loginResult.error || 'Login Web3 fallito', 
        data: null 
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Login Web3 effettuato con successo', 
      data: {
        address,
        pub: loginResult.pub,
        epub: loginResult.epub,
        profile: loginResult.profile || {}
      }
    });
  } catch (error) {
    console.error('Errore durante il login Web3:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Errore interno del server', 
      data: null 
    });
  }
});

// Route per Web3 registration
router.post('/web3/register', authLimiter, async (req, res) => {
  try {
    const { address, signature, message } = req.body;
    
    if (!address || !signature) {
      return res.status(400).json({ 
        success: false, 
        message: 'Indirizzo e firma sono richiesti', 
        data: null 
      });
    }

    const shogun = getShogunInstance(req);
    
    if (!shogun.isInitialized) {
      await shogun.initialize();
    }

    const web3Plugin = shogun.getPlugin("web3");
    if (!web3Plugin || !web3Plugin.isAvailable()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Web3 non disponibile', 
        data: null 
      });
    }

    // Verifica la firma
    const provider = await web3Plugin.getProvider();
    const recoveredAddress = ethers.verifyMessage(message || "I Love Shogun", signature);
    
    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Firma non valida', 
        data: null 
      });
    }

    const signUpResult = await web3Plugin.signUp(address);
    
    if (!signUpResult.success) {
      return res.status(400).json({ 
        success: false, 
        message: signUpResult.error || 'Registrazione Web3 fallita', 
        data: null 
      });
    }

    return res.status(201).json({ 
      success: true, 
      message: 'Registrazione Web3 completata con successo', 
      data: {
        address,
        pub: signUpResult.pub,
        epub: signUpResult.epub,
        profile: signUpResult.profile || {}
      }
    });
  } catch (error) {
    console.error('Errore durante la registrazione Web3:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Errore interno del server', 
      data: null 
    });
  }
});

// Route per Nostr authentication
router.post('/nostr/login', authLimiter, async (req, res) => {
  try {
    const { address, signature, message } = req.body;
    
    if (!address || !signature) {
      return res.status(400).json({ 
        success: false, 
        message: 'Indirizzo e firma sono richiesti', 
        data: null 
      });
    }

    const shogun = getShogunInstance(req);
    
    if (!shogun.isInitialized) {
      await shogun.initialize();
    }

    const nostrPlugin = shogun.getPlugin("nostr");
    if (!nostrPlugin || !nostrPlugin.isAvailable()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Nostr non disponibile', 
        data: null 
      });
    }

    const loginResult = await nostrPlugin.login(address);
    
    if (!loginResult.success) {
      return res.status(400).json({ 
        success: false, 
        message: loginResult.error || 'Login Nostr fallito', 
        data: null 
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Login Nostr effettuato con successo', 
      data: {
        address,
        pub: loginResult.pub,
        epub: loginResult.epub,
        profile: loginResult.profile || {}
      }
    });
  } catch (error) {
    console.error('Errore durante il login Nostr:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Errore interno del server', 
      data: null 
    });
  }
});

// Route per Nostr registration
router.post('/nostr/register', authLimiter, async (req, res) => {
  try {
    const { address, signature, message } = req.body;
    
    if (!address || !signature) {
      return res.status(400).json({ 
        success: false, 
        message: 'Indirizzo e firma sono richiesti', 
        data: null 
      });
    }

    const shogun = getShogunInstance(req);
    
    if (!shogun.isInitialized) {
      await shogun.initialize();
    }

    const nostrPlugin = shogun.getPlugin("nostr");
    if (!nostrPlugin || !nostrPlugin.isAvailable()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Nostr non disponibile', 
        data: null 
      });
    }

    const signUpResult = await nostrPlugin.signUp(address);
    
    if (!signUpResult.success) {
      return res.status(400).json({ 
        success: false, 
        message: signUpResult.error || 'Registrazione Nostr fallita', 
        data: null 
      });
    }

    return res.status(201).json({ 
      success: true, 
      message: 'Registrazione Nostr completata con successo', 
      data: {
        address,
        pub: signUpResult.pub,
        epub: signUpResult.epub,
        profile: signUpResult.profile || {}
      }
    });
  } catch (error) {
    console.error('Errore durante la registrazione Nostr:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Errore interno del server', 
      data: null 
    });
  }
});

// Route per verificare lo stato di autenticazione
router.get('/status', async (req, res) => {
  try {
    const shogun = getShogunInstance(req);
    
    if (!shogun.isInitialized) {
      await shogun.initialize();
    }

    const isLoggedIn = shogun.isLoggedIn();
    
    if (!isLoggedIn) {
      return res.status(200).json({ 
        success: true, 
        message: 'Utente non autenticato', 
        data: {
          authenticated: false
        }
      });
    }

    // Ottieni i dati dell'utente autenticato
    const userData = {
      authenticated: true,
      pub: shogun.user?._?.sea?.pub,
      epub: shogun.user?._?.sea?.epub,
      alias: shogun.user?._?.alias
    };

    return res.status(200).json({ 
      success: true, 
      message: 'Utente autenticato', 
      data: userData
    });
  } catch (error) {
    console.error('Errore durante il controllo dello stato:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Errore interno del server', 
      data: null 
    });
  }
});

// Route per recuperare la password (mantenuta per compatibilità)
router.post('/forgot', authLimiter, (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email è richiesta', 
      data: null 
    });
  }

  // In un'implementazione reale, qui invieresti una email
  return res.status(200).json({ 
    success: true, 
    message: 'Se l\'email esiste, riceverai un link per reimpostare la password', 
    data: {
      email
    }
  });
});

// Route per reimpostare la password (mantenuta per compatibilità)
router.post('/reset', authLimiter, async (req, res) => {
  try {
    const { email, newPassphrase, token } = req.body;
    
    if (!email || !newPassphrase || !token) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email, nuova passphrase e token sono richiesti', 
        data: null 
      });
    }

    // In un'implementazione reale, verificheresti il token
    // Per ora, assumiamo che sia valido
    
    const shogun = getShogunInstance(req);
    
    if (!shogun.isInitialized) {
      await shogun.initialize();
    }

    // Prova a fare login con la nuova password
    const loginResult = await shogun.login(email, newPassphrase);
    
    if (!loginResult.success) {
      return res.status(400).json({ 
        success: false, 
        message: 'Impossibile reimpostare la password', 
        data: null 
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Password reimpostata con successo', 
      data: null 
    });
  } catch (error) {
    console.error('Errore durante il reset della password:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Errore interno del server', 
      data: null 
    });
  }
});

// Route per cambiare la password
router.post('/change-password', authLimiter, async (req, res) => {
  try {
    const { currentPassphrase, newPassphrase } = req.body;
    
    if (!currentPassphrase || !newPassphrase) {
      return res.status(400).json({ 
        success: false, 
        message: 'Passphrase corrente e nuova sono richieste', 
        data: null 
      });
    }

    const shogun = getShogunInstance(req);
    
    if (!shogun.isInitialized) {
      await shogun.initialize();
    }

    // Per ora restituiamo un successo mock
    // In un'implementazione reale, qui cambieresti la password
    
    return res.status(200).json({ 
      success: true, 
      message: 'Password cambiata con successo', 
      data: null 
    });
  } catch (error) {
    console.error('Errore durante il cambio password:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Errore interno del server', 
      data: null 
    });
  }
});

// Endpoint per registrare una chiave Gun autorizzata
router.post("/authorize-gun-key", async (req, res) => {
  try {
    const { pubKey, userAddress, expiresAt } = req.body;
    const gun = req.app.get('gunInstance');
    const tokenAuthMiddleware = req.app.get('tokenAuthMiddleware');

    if (!pubKey) {
      return res.status(400).json({
        success: false,
        error: "Chiave pubblica Gun richiesta",
      });
    }

    // Verifica che l'utente abbia una sottoscrizione attiva
    if (userAddress) {
      try {
        const { DEPLOYMENTS } = await import("shogun-contracts/deployments.js");
        
        const chainId = process.env.CHAIN_ID || "11155111";
        const web3ProviderUrl = `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
        
        if (process.env.ALCHEMY_API_KEY) {
          const provider = new ethers.JsonRpcProvider(web3ProviderUrl);
          const chainDeployments = DEPLOYMENTS[chainId];
          const relayContract = chainDeployments?.["Relay#RelayPaymentRouter"];
          
          if (relayContract) {
            const contract = new ethers.Contract(
              relayContract.address,
              relayContract.abi,
              provider
            );
            
            const isSubscribed = await contract.checkUserSubscription(userAddress);
            if (!isSubscribed) {
              return res.status(403).json({
                success: false,
                error: "Utente non ha una sottoscrizione attiva",
              });
            }
          }
        }
      } catch (e) {
        console.error("Errore verifica sottoscrizione:", e);
        return res.status(500).json({
          success: false,
          error: "Errore verifica sottoscrizione",
        });
      }
    }

    // Calcola la data di scadenza (default: 30 giorni)
    const expirationDate = expiresAt || Date.now() + 30 * 24 * 60 * 60 * 1000;

    // Registra la chiave autorizzata nel database Gun
    const authData = {
      pubKey,
      userAddress,
      authorized: true,
      authorizedAt: Date.now(),
      expiresAt: expirationDate,
      authMethod: userAddress ? "smart_contract" : "manual",
    };

    const authNode = gun.get("shogun").get("authorized_keys").get(pubKey);

    authNode.put(authData);

    console.log(
      `✅ Chiave Gun autorizzata: ${pubKey} (scade: ${new Date(
        expirationDate
      ).toISOString()})`
    );

    res.json({
      success: true,
      message: "Chiave Gun autorizzata con successo",
      pubKey,
      expiresAt: expirationDate,
      expiresAtFormatted: new Date(expirationDate).toISOString(),
    });
  } catch (error) {
    console.error("Errore autorizzazione chiave Gun:", error);
    res.status(500).json({
      success: false,
      error: "Errore autorizzazione chiave Gun",
    });
  }
});

// Endpoint per revocare una chiave Gun autorizzata
router.delete("/authorize-gun-key/:pubKey", async (req, res) => {
  try {
    const { pubKey } = req.params;
    const gun = req.app.get('gunInstance');

    if (!pubKey) {
      return res.status(400).json({
        success: false,
        error: "Chiave pubblica Gun richiesta",
      });
    }

    // Revoca la chiave autorizzata
    const authNode = gun.get("shogun").get("authorized_keys").get(pubKey);

    authNode.put(null);

    console.log(`❌ Chiave Gun revocata: ${pubKey}`);

    res.json({
      success: true,
      message: "Chiave Gun revocata con successo",
      pubKey,
    });
  } catch (error) {
    console.error("Errore revoca chiave Gun:", error);
    res.status(500).json({
      success: false,
      error: "Errore revoca chiave Gun",
    });
  }
});

// Endpoint per verificare lo stato di autorizzazione di una chiave Gun
router.get("/authorize-gun-key/:pubKey", async (req, res) => {
  try {
    const { pubKey } = req.params;
    const gun = req.app.get('gunInstance');

    if (!pubKey) {
      return res.status(400).json({
        success: false,
        error: "Chiave pubblica Gun richiesta",
      });
    }

    // Verifica lo stato di autorizzazione
    const authNode = gun.get("shogun").get("authorized_keys").get(pubKey);

    authNode.once((authData) => {
      if (!authData) {
        return res.json({
          success: true,
          authorized: false,
          message: "Chiave non autorizzata",
        });
      }

      const now = Date.now();
      const isExpired = authData.expiresAt && authData.expiresAt < now;

      res.json({
        success: true,
        authorized: authData.authorized && !isExpired,
        authData: {
          pubKey: authData.pubKey,
          userAddress: authData.userAddress,
          authorizedAt: authData.authorizedAt,
          expiresAt: authData.expiresAt,
          authMethod: authData.authMethod,
          isExpired,
        },
      });
    });
  } catch (error) {
    console.error("Errore verifica autorizzazione chiave Gun:", error);
    res.status(500).json({
      success: false,
      error: "Errore verifica autorizzazione chiave Gun",
    });
  }
});

export default router; 