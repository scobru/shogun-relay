import express from "express";

export default function setupAuthRoutes(gunInstance, ensureShogunCoreInstance, AuthenticationManagerInstance) {
  const router = express.Router();

  // Registrazione utente (ShogunCore + GunDB)
  router.post("/register", async (req, res) => {
    try {
      const { username, password, email } = req.body;
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: "Username and password are required"
        });
      }

      const core = ensureShogunCoreInstance();
      if (!core) {
        return res.status(500).json({
          success: false,
          error: "ShogunCore not available"
        });
      }

      // Registrazione tramite ShogunCore
      const signUpResult = await core.signUp(username, password, password);
      if (!signUpResult.success) {
        return res.status(400).json({
          success: false,
          error: signUpResult.error || "User registration failed via ShogunCore"
        });
      }

      // Autenticazione con GunDB
      const user = gunInstance.user();
      const authUserPromise = new Promise((resolve, reject) => {
        user.auth(username, password, (ack) => {
          if (ack.err) {
            reject(new Error(ack.err || "Gun authentication failed after ShogunCore signup"));
          } else {
            resolve(ack);
          }
        });
      });
      await authUserPromise;

      // Imposta email nel profilo GunDB
      if (email) {
        user.get("profile").get("email").put(email);
      }

      res.json({
        success: true,
        message: "User registered successfully",
        userId: user.is.alias,
        gunCert: user._.sea,
        shogunResult: signUpResult
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Login utente (ShogunCore + GunDB)
  router.post("/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: "Username and password are required"
        });
      }

      const core = ensureShogunCoreInstance();
      if (!core) {
        return res.status(500).json({
          success: false,
          error: "ShogunCore not available"
        });
      }

      // Login tramite ShogunCore
      const loginResult = await core.login(username, password);
      if (!loginResult.success) {
        return res.status(401).json({
          success: false,
          error: loginResult.error || "Login failed via ShogunCore"
        });
      }

      // Autenticazione con GunDB
      const user = gunInstance.user();
      const authUserPromise = new Promise((resolve, reject) => {
        user.auth(username, password, (ack) => {
          if (ack.err) {
            reject(new Error(ack.err || "Gun authentication failed after ShogunCore login"));
          } else {
            resolve(ack);
          }
        });
      });
      await authUserPromise;

      res.json({
        success: true,
        message: "Login successful",
        userId: user.is.alias,
        gunCert: user._.sea,
        shogunResult: loginResult
      });
    } catch (error) {
      // Differenzia errori di autenticazione da errori di server
      if (error.message.includes("ShogunCore") || 
          error.message.includes("Gun authentication") || 
          error.message.includes("No user found") || 
          error.message.includes("Password mismatch")) {
        res.status(401).json({
          success: false,
          error: "Invalid username or password."
        });
      } else {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }
  });

  // ENDPOINT: Verifica semplice on-chain (senza JWT, restituisce solo true/false)
  router.post("/verify-onchain", async (req, res) => {
    try {
      const { pubKey } = req.body;
      
      if (!pubKey) {
        return res.status(400).json({
          success: false,
          error: "Public key is required"
        });
      }
      
      // Ottieni la configurazione relay
      const core = ensureShogunCoreInstance();
      if (!core || !core.RELAY_CONFIG || !core.relayVerifier) {
        return res.status(503).json({
          success: false,
          error: "Relay services not available"
        });
      }
      
      const RELAY_CONFIG = core.RELAY_CONFIG;
      
      // Verifica che on-chain membership sia abilitata
      if (!RELAY_CONFIG.relay?.onchainMembership) {
        return res.status(503).json({
          success: false,
          error: "On-chain verification not configured"
        });
      }
      
      // Formatta la chiave per la verifica blockchain
      const formattedKey = AuthenticationManagerInstance.formatKeyForBlockchain(pubKey);
      if (!formattedKey) {
        return res.status(400).json({
          success: false,
          error: "Invalid key format"
        });
      }
      
      // Verifica diretta onchain
      try {
        // Usa relayVerifier direttamente
        const isAuthorized = await core.relayVerifier.isPublicKeyAuthorized(
          RELAY_CONFIG.relay.registryAddress,
          formattedKey
        );
        
        // Restituisci solo il risultato booleano
        return res.json({
          success: true,
          isAuthorized: isAuthorized
        });
      } catch (error) {
        console.error("Error during on-chain verification:", error);
        return res.status(500).json({
          success: false,
          error: "On-chain verification failed"
        });
      }
    } catch (error) {
      console.error("Error in verify-onchain endpoint:", error);
      return res.status(500).json({
        success: false,
        error: "Server error"
      });
    }
  });

  return router;
}
