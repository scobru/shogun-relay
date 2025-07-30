import express from 'express';
import rateLimit from 'express-rate-limit';
import { ethers } from 'ethers';

const router = express.Router();

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

// Middleware per ottenere l'istanza Shogun Core dal server principale
const getShogunInstance = (req) => {
  console.log("🔐 getShogunInstance called");
  
  // Ottieni l'istanza dal server principale
  const serverShogunCore = req.app.get('shogunCore');
  console.log("🔐 Server Shogun Core available:", !!serverShogunCore);
  
  if (!serverShogunCore) {
    console.error("❌ Shogun Core not available from server - authentication system unavailable");
    return null;
  }
  
  console.log("🔐 Using Shogun Core from server instance");
  return serverShogunCore;
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
    
    // Verifica che Shogun Core sia disponibile
    if (!shogun) {
      console.error("❌ Shogun Core not available for registration");
      return res.status(503).json({ 
        success: false, 
        message: 'Sistema di autenticazione non disponibile - riprova più tardi', 
        data: null 
      });
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
    
    // Verifica che Shogun Core sia disponibile
    if (!shogun) {
      console.error("❌ Shogun Core not available for login");
      return res.status(503).json({ 
        success: false, 
        message: 'Sistema di autenticazione non disponibile - riprova più tardi', 
        data: null 
      });
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
    
    // Verifica che Shogun Core sia disponibile
    if (!shogun) {
      console.error("❌ Shogun Core not available for logout");
      return res.status(503).json({ 
        success: false, 
        message: 'Sistema di autenticazione non disponibile - riprova più tardi', 
        data: null 
      });
    }

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
    
    // Verifica che Shogun Core sia disponibile
    if (!shogun) {
      console.error("❌ Shogun Core not available for Web3 login");
      return res.status(503).json({ 
        success: false, 
        message: 'Sistema di autenticazione non disponibile - riprova più tardi', 
        data: null 
      });
    }

    console.log("🔐 Processing Web3 login for address:", address.substring(0, 10) + "...");

    // Verifica la firma direttamente con ethers (senza dipendere dal plugin)
    let recoveredAddress;
    try {
      const messageToVerify = message || "I Love Shogun";
      console.log("🔐 Verifying signature for message:", messageToVerify);
      recoveredAddress = ethers.verifyMessage(messageToVerify, signature);
      console.log("🔐 Recovered address:", recoveredAddress.substring(0, 10) + "...");
    } catch (error) {
      console.error("❌ Error verifying signature:", error);
      return res.status(400).json({ 
        success: false, 
        message: 'Firma non valida', 
        data: null 
      });
    }
    
    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      console.error("❌ Address mismatch:", {
        provided: address.substring(0, 10) + "...",
        recovered: recoveredAddress.substring(0, 10) + "..."
      });
      return res.status(400).json({ 
        success: false, 
        message: 'Firma non valida - indirizzo non corrisponde', 
        data: null 
      });
    }

    console.log("🔐 Signature verified successfully");

    // Usa le credenziali derivate per il login
    const username = `web3_${address.substring(0, 10)}`;
    const password = ethers.sha256(ethers.toUtf8Bytes(signature));
    
    console.log("🔐 Attempting login with derived credentials");
    const loginResult = await shogun.login(username, password);
    
    if (!loginResult.success) {
      console.error("❌ Web3 login failed:", loginResult.error);
      return res.status(400).json({ 
        success: false, 
        message: loginResult.error || 'Login Web3 fallito', 
        data: null 
      });
    }

    console.log("🔐 Web3 login completed successfully");

    return res.status(200).json({ 
      success: true, 
      message: 'Login Web3 effettuato con successo', 
      data: {
        address,
        username,
        pub: loginResult.userPub,
        profile: { type: 'web3', address }
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
    
    // Verifica che Shogun Core sia disponibile
    if (!shogun) {
      console.error("❌ Shogun Core not available for Web3 registration");
      return res.status(503).json({ 
        success: false, 
        message: 'Sistema di autenticazione non disponibile - riprova più tardi', 
        data: null 
      });
    }

    console.log("🔐 Processing Web3 registration for address:", address.substring(0, 10) + "...");

    // Verifica la firma direttamente con ethers (senza dipendere dal plugin)
    let recoveredAddress;
    try {
      const messageToVerify = message || "I Love Shogun";
      console.log("🔐 Verifying signature for message:", messageToVerify);
      recoveredAddress = ethers.verifyMessage(messageToVerify, signature);
      console.log("🔐 Recovered address:", recoveredAddress.substring(0, 10) + "...");
    } catch (error) {
      console.error("❌ Error verifying signature:", error);
      return res.status(400).json({ 
        success: false, 
        message: 'Firma non valida', 
        data: null 
      });
    }
    
    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      console.error("❌ Address mismatch:", {
        provided: address.substring(0, 10) + "...",
        recovered: recoveredAddress.substring(0, 10) + "..."
      });
      return res.status(400).json({ 
        success: false, 
        message: 'Firma non valida - indirizzo non corrisponde', 
        data: null 
      });
    }

    console.log("🔐 Signature verified successfully");

    // Usa il metodo di autenticazione tradizionale con le credenziali derivate
    const username = `web3_${address.substring(0, 10)}`;
    const password = ethers.sha256(ethers.toUtf8Bytes(signature));
    
    console.log("🔐 Creating user with derived credentials");
    const signUpResult = await shogun.signUp(username, password);
    
    if (!signUpResult.success) {
      console.error("❌ Web3 signup failed:", signUpResult.error);
      return res.status(400).json({ 
        success: false, 
        message: signUpResult.error || 'Registrazione Web3 fallita', 
        data: null 
      });
    }

    // Login automatico dopo la registrazione
    const loginResult = await shogun.login(username, password);
    
    if (!loginResult.success) {
      console.error("❌ Web3 auto-login failed:", loginResult.error);
      return res.status(400).json({ 
        success: false, 
        message: 'Registrazione completata ma login automatico fallito', 
        data: null 
      });
    }

    console.log("🔐 Web3 registration completed successfully");

    return res.status(201).json({ 
      success: true, 
      message: 'Utente Web3 creato con successo', 
      data: {
        address,
        username,
        pub: loginResult.userPub,
        profile: { type: 'web3', address }
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
    
    // Verifica che Shogun Core sia disponibile
    if (!shogun) {
      console.error("❌ Shogun Core not available for Nostr login");
      return res.status(503).json({ 
        success: false, 
        message: 'Sistema di autenticazione non disponibile - riprova più tardi', 
        data: null 
      });
    }

    console.log("⚡ Processing Nostr login for address:", address.substring(0, 10) + "...");

    // Per ora, accettiamo la firma Nostr senza verifica crittografica
    // (in produzione dovremmo implementare la verifica completa)
    const messageToVerify = message || "I Love Shogun";
    console.log("⚡ Accepting Nostr signature for message:", messageToVerify);
    console.log("⚡ Signature length:", signature.length);
    
    // Verifica base: controlla che la firma sia presente e abbia una lunghezza ragionevole
    if (!signature || signature.length < 10) {
      console.error("❌ Nostr signature too short or missing");
      return res.status(400).json({ 
        success: false, 
        message: 'Firma Nostr troppo corta o mancante', 
        data: null 
      });
    }

    console.log("⚡ Nostr signature accepted (basic validation)");

    // Usa le credenziali derivate per il login
    const username = `nostr_${address.substring(0, 10)}`;
    const password = ethers.sha256(ethers.toUtf8Bytes(signature));
    
    console.log("⚡ Attempting login with derived credentials");
    const loginResult = await shogun.login(username, password);
    
    if (!loginResult.success) {
      console.error("❌ Nostr login failed:", loginResult.error);
      return res.status(400).json({ 
        success: false, 
        message: loginResult.error || 'Login Nostr fallito', 
        data: null 
      });
    }

    console.log("⚡ Nostr login completed successfully");

    return res.status(200).json({ 
      success: true, 
      message: 'Login Nostr effettuato con successo', 
      data: {
        address,
        username,
        pub: loginResult.userPub,
        profile: { type: 'nostr', address }
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
    
    // Verifica che Shogun Core sia disponibile
    if (!shogun) {
      console.error("❌ Shogun Core not available for Nostr registration");
      return res.status(503).json({ 
        success: false, 
        message: 'Sistema di autenticazione non disponibile - riprova più tardi', 
        data: null 
      });
    }

    console.log("⚡ Processing Nostr registration for address:", address.substring(0, 10) + "...");

    // Per ora, accettiamo la firma Nostr senza verifica crittografica
    // (in produzione dovremmo implementare la verifica completa)
    const messageToVerify = message || "I Love Shogun";
    console.log("⚡ Accepting Nostr signature for message:", messageToVerify);
    console.log("⚡ Signature length:", signature.length);
    
    // Verifica base: controlla che la firma sia presente e abbia una lunghezza ragionevole
    if (!signature || signature.length < 10) {
      console.error("❌ Nostr signature too short or missing");
      return res.status(400).json({ 
        success: false, 
        message: 'Firma Nostr troppo corta o mancante', 
        data: null 
      });
    }

    console.log("⚡ Nostr signature accepted (basic validation)");

    // Usa le credenziali derivate per la registrazione
    const username = `nostr_${address.substring(0, 10)}`;
    const password = ethers.sha256(ethers.toUtf8Bytes(signature));
    
    console.log("⚡ Creating user with derived credentials");
    const signUpResult = await shogun.signUp(username, password);
    
    if (!signUpResult.success) {
      console.error("❌ Nostr signup failed:", signUpResult.error);
      return res.status(400).json({ 
        success: false, 
        message: signUpResult.error || 'Registrazione Nostr fallita', 
        data: null 
      });
    }

    // Login automatico dopo la registrazione
    const loginResult = await shogun.login(username, password);
    
    if (!loginResult.success) {
      console.error("❌ Nostr auto-login failed:", loginResult.error);
      return res.status(400).json({ 
        success: false, 
        message: 'Registrazione completata ma login automatico fallito', 
        data: null 
      });
    }

    console.log("⚡ Nostr registration completed successfully");

    return res.status(201).json({ 
      success: true, 
      message: 'Utente Nostr creato con successo', 
      data: {
        address,
        username,
        pub: loginResult.userPub,
        profile: { type: 'nostr', address }
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
    console.log("🔐 /status route called");
    
    const shogun = getShogunInstance(req);
    console.log("🔐 Shogun instance obtained:", !!shogun);
    
    // Verifica che Shogun Core sia disponibile
    if (!shogun) {
      console.error("❌ Shogun Core not available for status check");
      return res.status(503).json({ 
        success: false, 
        message: 'Sistema di autenticazione non disponibile - riprova più tardi', 
        data: null 
      });
    }

    console.log("🔐 Checking if user is logged in...");
    const isLoggedIn = shogun.isLoggedIn();
    console.log("🔐 User logged in:", isLoggedIn);
    
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

    console.log("🔐 Returning authenticated user data");
    return res.status(200).json({ 
      success: true, 
      message: 'Utente autenticato', 
      data: userData
    });
  } catch (error) {
    console.error('❌ Errore durante il controllo dello stato:', error);
    console.error('❌ Error stack:', error.stack);
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
    
    // Verifica che Shogun Core sia disponibile
    if (!shogun) {
      console.error("❌ Shogun Core not available for password reset");
      return res.status(503).json({ 
        success: false, 
        message: 'Sistema di autenticazione non disponibile - riprova più tardi', 
        data: null 
      });
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
    
    // Verifica che Shogun Core sia disponibile
    if (!shogun) {
      console.error("❌ Shogun Core not available for password change");
      return res.status(503).json({ 
        success: false, 
        message: 'Sistema di autenticazione non disponibile - riprova più tardi', 
        data: null 
      });
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

// OAuth Routes
// Route per avviare il flusso OAuth
router.get('/oauth/:provider/authorize', async (req, res) => {
  try {
    const { provider } = req.params;
    const { action } = req.query; // 'login' o 'register'
    const shogun = getShogunInstance(req);
    
    if (!shogun) {
      console.error("❌ Shogun Core not available for OAuth");
      return res.status(503).json({ 
        success: false, 
        message: 'Sistema di autenticazione non disponibile', 
        data: null 
      });
    }

    const oauthPlugin = shogun.getPlugin("oauth");
    if (!oauthPlugin) {
      console.error("❌ OAuth plugin not found");
      return res.status(400).json({ 
        success: false, 
        message: 'Plugin OAuth non trovato', 
        data: null 
      });
    }

    console.log(`🔐 Initiating OAuth flow for provider: ${provider}, action: ${action || 'login'}`);

    // Avvia il flusso OAuth con l'azione specificata
    const result = await oauthPlugin.initiateOAuth(provider, action);
    
    if (!result.success) {
      console.error("❌ OAuth initiation failed:", result.error);
      return res.status(400).json({ 
        success: false, 
        message: result.error || 'Avvio OAuth fallito', 
        data: null 
      });
    }

    console.log(`🔐 OAuth URL generated for ${provider}:`, result.authUrl);

    // Reindirizza all'URL di autorizzazione OAuth
    res.redirect(result.authUrl);

  } catch (error) {
    console.error('Errore durante l\'avvio OAuth:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Errore interno del server', 
      data: null 
    });
  }
});

// Route per gestire il callback OAuth
router.post('/oauth/callback', async (req, res) => {
  try {
    const { provider, code, state } = req.body;
    const shogun = getShogunInstance(req);
    
    if (!shogun) {
      console.error("❌ Shogun Core not available for OAuth callback");
      return res.status(503).json({ 
        success: false, 
        message: 'Sistema di autenticazione non disponibile', 
        data: null 
      });
    }

    if (!code || !state) {
      return res.status(400).json({ 
        success: false, 
        message: 'Codice e state sono richiesti', 
        data: null 
      });
    }

    const oauthPlugin = shogun.getPlugin("oauth");
    if (!oauthPlugin) {
      console.error("❌ OAuth plugin not found");
      return res.status(400).json({ 
        success: false, 
        message: 'Plugin OAuth non trovato', 
        data: null 
      });
    }

    console.log(`🔐 Processing OAuth callback for provider: ${provider}`);

    // Completa il flusso OAuth
    const result = await oauthPlugin.completeOAuth(provider, code, state);
    
    if (!result.success) {
      console.error("❌ OAuth completion failed:", result.error);
      return res.status(400).json({ 
        success: false, 
        message: result.error || 'Completamento OAuth fallito', 
        data: null 
      });
    }

    console.log(`🔐 OAuth authentication successful for ${provider}`);

    return res.status(200).json({ 
      success: true, 
      message: 'Autenticazione OAuth completata con successo', 
      data: {
        provider,
        user: result.user,
        profile: { type: 'oauth', provider }
      }
    });

  } catch (error) {
    console.error('Errore durante il callback OAuth:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Errore interno del server', 
      data: null 
    });
  }
});

// Route GET per il callback OAuth (redirect alla pagina di autenticazione)
router.get('/oauth/callback', async (req, res) => {
  try {
    const { code, state, error, error_description, provider = 'google' } = req.query;
    
    console.log(`🔐 OAuth callback GET request for provider: ${provider}`);
    
    // Se c'è un errore OAuth, reindirizza con l'errore
    if (error) {
      console.error(`🔐 OAuth error: ${error} - ${error_description || ''}`);
      const errorUrl = `/auth?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(error_description || '')}&provider=${provider}`;
      return res.redirect(errorUrl);
    }
    
    // Se mancano i parametri richiesti, reindirizza con errore
    if (!code || !state) {
      console.error('🔐 Missing OAuth parameters: code or state');
      const errorUrl = `/auth?error=missing_parameters&provider=${provider}`;
      return res.redirect(errorUrl);
    }
    
    // Reindirizza alla pagina di autenticazione con i parametri OAuth
    const redirectUrl = `/auth?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}&provider=${provider}`;
    console.log(`🔐 Redirecting to auth page with OAuth parameters: ${redirectUrl}`);
    
    res.redirect(redirectUrl);
    
  } catch (error) {
    console.error('Errore durante il redirect OAuth callback:', error);
    const errorUrl = `/auth?error=server_error&provider=google`;
    res.redirect(errorUrl);
  }
});

// Route per login OAuth (alternativa)
router.post('/oauth/:provider/login', async (req, res) => {
  try {
    const { provider } = req.params;
    const shogun = getShogunInstance(req);
    
    if (!shogun) {
      console.error("❌ Shogun Core not available for OAuth login");
      return res.status(503).json({ 
        success: false, 
        message: 'Sistema di autenticazione non disponibile', 
        data: null 
      });
    }

    const oauthPlugin = shogun.getPlugin("oauth");
    if (!oauthPlugin) {
      console.error("❌ OAuth plugin not found");
      return res.status(400).json({ 
        success: false, 
        message: 'Plugin OAuth non trovato', 
        data: null 
      });
    }

    console.log(`🔐 Initiating OAuth login for provider: ${provider}`);

    // Avvia il login OAuth
    const result = await oauthPlugin.login(provider);
    
    if (!result.success) {
      console.error("❌ OAuth login initiation failed:", result.error);
      return res.status(400).json({ 
        success: false, 
        message: result.error || 'Avvio login OAuth fallito', 
        data: null 
      });
    }

    if (result.redirectUrl) {
      // Restituisce l'URL di redirect
      return res.status(200).json({ 
        success: true, 
        message: 'Reindirizzamento OAuth richiesto', 
        data: {
          redirectUrl: result.redirectUrl,
          provider
        }
      });
    } else {
      // Login completato direttamente
      return res.status(200).json({ 
        success: true, 
        message: 'Login OAuth completato con successo', 
        data: {
          provider,
          user: result.user,
          profile: { type: 'oauth', provider }
        }
      });
    }

  } catch (error) {
    console.error('Errore durante il login OAuth:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Errore interno del server', 
      data: null 
    });
  }
});

export default router; 