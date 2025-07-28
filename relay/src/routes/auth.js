import express from 'express';
import rateLimit from 'express-rate-limit';

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

// Middleware per ottenere l'istanza Gun dal relay
const getGunInstance = (req) => {
  return req.app.get('gunInstance');
};

// Utility per la crittografia (se necessario)
const util = {
  encrypt: (text) => {
    // Implementazione base - in produzione usare una libreria di crittografia
    return Buffer.from(text).toString('base64');
  },
  decrypt: (text) => {
    return Buffer.from(text, 'base64').toString('utf8');
  },
  randomPassword: () => {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
};

// Route per la registrazione utente
router.post('/register', authLimiter, (req, res) => {
  const { email, passphrase, hint } = req.body;
  
  if (!email || !passphrase) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email e passphrase sono richiesti', 
      data: null 
    });
  }

  const gun = getGunInstance(req);
  const user = gun.user().recall({ sessionStorage: false });

  user.create(email, passphrase, ack => {
    if (ack && ack.err) {
      return res.status(400).json({ 
        success: false, 
        message: ack.err, 
        data: null 
      });
    }

    // Login automatico dopo la registrazione
    user.auth(email, passphrase, ack => {
      if (ack && ack.err) {
        return res.status(400).json({ 
          success: false, 
          message: ack.err, 
          data: null 
        });
      }

      // Crea il profilo utente
      const data = ack.sea;
      data.profile = { email, hint };
      
      user.get('profile').put(data.profile, ack => {
        if (ack && ack.err) {
          return res.status(400).json({ 
            success: false, 
            message: ack.err, 
            data: null 
          });
        }

        // Salva i dati utente nel database Gun
        const userProfile = { 
          email, 
          hint: util.encrypt(hint), 
          pwd: util.encrypt(passphrase) 
        };
        
        gun.get(`users/${email}`).put(userProfile, ack => {
          if (ack && ack.err) {
            return res.status(400).json({ 
              success: false, 
              message: ack.err, 
              data: null 
            });
          }
          
          return res.status(201).json({ 
            success: true, 
            message: 'Utente creato con successo', 
            data: {
              email,
              pub: data.pub,
              epub: data.epub,
              profile: data.profile
            }
          });
        });
      });
    });
  });
});

// Route per il login utente
router.post('/login', authLimiter, (req, res) => {
  const { email, passphrase } = req.body;
  
  if (!email || !passphrase) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email e passphrase sono richiesti', 
      data: null 
    });
  }

  const gun = getGunInstance(req);
  const user = gun.user().recall({ sessionStorage: false });

  user.auth(email, passphrase, ack => {
    if (ack && ack.err) {
      return res.status(400).json({ 
        success: false, 
        message: ack.err, 
        data: null 
      });
    }

    // Recupera il profilo utente
    user.get('profile').once(profile => {
      return res.status(200).json({ 
        success: true, 
        message: 'Login effettuato con successo', 
        data: {
          email,
          pub: ack.sea.pub,
          epub: ack.sea.epub,
          profile: profile || {}
        }
      });
    });
  });
});

// Route per il logout utente
router.post('/logout', (req, res) => {
  const gun = getGunInstance(req);
  const user = gun.user().recall({ sessionStorage: false });

  user.leave();
  
  return res.status(200).json({ 
    success: true, 
    message: 'Logout effettuato con successo', 
    data: null 
  });
});

// Route per recuperare la password
router.post('/forgot', authLimiter, (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email è richiesta', 
      data: null 
    });
  }

  const gun = getGunInstance(req);
  
  // Cerca l'utente nel database
  gun.get(`users/${email}`).once(userData => {
    if (!userData) {
      return res.status(404).json({ 
        success: false, 
        message: 'Utente non trovato', 
        data: null 
      });
    }

    // In un'implementazione reale, qui invieresti una email
    // Per ora, restituiamo solo un messaggio di successo
    return res.status(200).json({ 
      success: true, 
      message: 'Se l\'email esiste, riceverai un link per reimpostare la password', 
      data: {
        email,
        hint: userData.hint ? util.decrypt(userData.hint) : null
      }
    });
  });
});

// Route per reimpostare la password
router.post('/reset', authLimiter, (req, res) => {
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
  
  const gun = getGunInstance(req);
  const user = gun.user().recall({ sessionStorage: false });

  // Cambia la password
  user.auth(email, newPassphrase, ack => {
    if (ack && ack.err) {
      return res.status(400).json({ 
        success: false, 
        message: ack.err, 
        data: null 
      });
    }

    // Aggiorna i dati nel database
    gun.get(`users/${email}`).once(userData => {
      if (userData) {
        const updatedUserData = {
          ...userData,
          pwd: util.encrypt(newPassphrase)
        };
        
        gun.get(`users/${email}`).put(updatedUserData, ack => {
          if (ack && ack.err) {
            return res.status(400).json({ 
              success: false, 
              message: ack.err, 
              data: null 
            });
          }
          
          return res.status(200).json({ 
            success: true, 
            message: 'Password reimpostata con successo', 
            data: null 
          });
        });
      } else {
        return res.status(404).json({ 
          success: false, 
          message: 'Utente non trovato', 
          data: null 
        });
      }
    });
  });
});

// Route per cambiare la password
router.post('/change-password', authLimiter, (req, res) => {
  const { currentPassphrase, newPassphrase } = req.body;
  
  if (!currentPassphrase || !newPassphrase) {
    return res.status(400).json({ 
      success: false, 
      message: 'Passphrase corrente e nuova sono richieste', 
      data: null 
    });
  }

  const gun = getGunInstance(req);
  const user = gun.user().recall({ sessionStorage: false });

  // Verifica la passphrase corrente
  user.auth(user._.sea.pub, currentPassphrase, ack => {
    if (ack && ack.err) {
      return res.status(400).json({ 
        success: false, 
        message: 'Passphrase corrente non valida', 
        data: null 
      });
    }

    // Cambia la password
    user.auth(user._.sea.pub, newPassphrase, ack => {
      if (ack && ack.err) {
        return res.status(400).json({ 
          success: false, 
          message: ack.err, 
          data: null 
        });
      }

      return res.status(200).json({ 
        success: true, 
        message: 'Password cambiata con successo', 
        data: null 
      });
    });
  });
});

// Endpoint per registrare una chiave Gun autorizzata
router.post("/authorize-gun-key", async (req, res) => {
  try {
    const { pubKey, userAddress, expiresAt } = req.body;
    const gun = getGunInstance(req);
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
        const { ethers } = await import("ethers");
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
    const gun = getGunInstance(req);

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
    const gun = getGunInstance(req);

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