import jwt from 'jsonwebtoken';

// Configurazione globale
let config;

/**
 * Utility function to properly format a GunDB public key for blockchain verification
 * @param {string} pubKey - The GunDB public key
 * @returns {string} - Properly formatted key with 0x prefix for ethers.js
 */
function formatKeyForBlockchain(pubKey) {
  if (!pubKey) return null;
  
  try {
    // Clean the key by removing the ~ prefix if present and anything after the period
    let cleanKey = pubKey;
    
    // Remove ~ prefix if present
    if (cleanKey.startsWith("~")) {
      cleanKey = cleanKey.substring(1);
    }
    
    // Remove everything after the first period (if any)
    const dotIndex = cleanKey.indexOf(".");
    if (dotIndex > 0) {
      cleanKey = cleanKey.substring(0, dotIndex);
    }
    
    // Convert from GunDB's URL-safe base64 to standard base64 with padding
    const base64Key = cleanKey.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64Key.length % 4 === 0 
      ? base64Key 
      : base64Key.padEnd(base64Key.length + (4 - (base64Key.length % 4)), "=");
    
    // Convert to binary and then to hex
    const binaryData = Buffer.from(padded, "base64");
    const hexData = binaryData.toString("hex");
    
    // Always add 0x prefix for ethers.js v6
    const hexWithPrefix = hexData.startsWith('0x') ? hexData : `0x${hexData}`;
    
    return hexWithPrefix;
  } catch (error) {
    console.error("Error formatting key for blockchain:", error);
    return null;
  }
}

/**
 * Configura il modulo di autenticazione
 */
function configure(configData) {
  if (!configData) throw new Error('Configuration object is required');
  
  if (!config) {
    config = configData; // Prima inizializzazione completa
  } else {
    // Aggiorna solo le proprietà fornite
    Object.assign(config, configData);
  }
  
  if (config.RELAY_CONFIG) {
    // Conversione stringhe a booleani
    if (config.RELAY_CONFIG.relay && typeof config.RELAY_CONFIG.relay.onchainMembership === 'string') {
      config.RELAY_CONFIG.relay.onchainMembership = config.RELAY_CONFIG.relay.onchainMembership === 'true';
    } 
    
    if (config.RELAY_CONFIG.didVerifier && typeof config.RELAY_CONFIG.didVerifier.enabled === 'string') {
      config.RELAY_CONFIG.didVerifier.enabled = config.RELAY_CONFIG.didVerifier.enabled === 'true';
    }
  }
}

/**
 * Verifica se una chiave è pre-autorizzata
 */
function isKeyPreAuthorized(pubKey) {
  if (!pubKey || !config || !config.authorizedKeys || !(config.authorizedKeys instanceof Map)) return false;

  const authInfo = config.authorizedKeys.get(pubKey);
  if (!authInfo) return false;

  // Rimuove autorizzazioni scadute
  if (Date.now() > authInfo.expiresAt) {
    config.authorizedKeys.delete(pubKey);
    return false;
  }

  return true;
}

/**
 * Autorizza temporaneamente una chiave pubblica
 */
function authorizeKey(pubKey, expiryMs = config.AUTH_KEY_EXPIRY) {
  if (!pubKey) throw new Error("Public key required for authorization");
  
  if (!config || !config.authorizedKeys || !(config.authorizedKeys instanceof Map)) {
    if (!config) {
      config = {};
    }
    config.authorizedKeys = new Map();
  }

  const authInfo = {
    pubKey,
    authorizedAt: Date.now(),
    expiresAt: Date.now() + expiryMs,
  };

  config.authorizedKeys.set(pubKey, authInfo);
  return authInfo;
}

/**
 * Verifica un token JWT
 */
function verifyJWT(token) {
  if (!token) return false;
  
  if (!config.JWT_SECRET) return false;

  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch (err) {
    return false;
  }
}

/**
 * Estrae il token da una richiesta HTTP
 */
function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token;
  const bodyToken = req.body && req.body.token;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  } else if (authHeader) {
    return authHeader;
  }

  return queryToken || bodyToken;
}

/**
 * Genera un nuovo token JWT per un utente
 */
async function generateUserToken(userId, tokenName, expiresInMs, checkBlockchain = false) {
  if (!userId) {
    throw new Error("User ID is required to generate a token.");
  }
  if (!config.JWT_SECRET) {
    throw new Error("Token generation failed due to missing secret.");
  }

  // Verifica blockchain
  let isBlockchainAuthorized = false;
  if (checkBlockchain && config.RELAY_CONFIG?.relay?.onchainMembership && config.relayVerifier) {
    try {
      // First, clean the userId in case it's a full key with epub part
      const dotIndex = userId.indexOf('.');
      const cleanedUserId = dotIndex > 0 ? userId.substring(0, dotIndex) : userId;
      
      console.log(`Checking blockchain authorization for: ${cleanedUserId}`);
      
      // If userId is a GunDB key or looks like a hex, proceed with verification
      if (cleanedUserId && (cleanedUserId.length > 32 || cleanedUserId.startsWith('0x'))) {
        // Verifica se relayVerifier è un'istanza di RelayRegistry
        if (config.relayVerifier.isUserSubscribedToRelay) {
          // È un RelayRegistry, usiamo il metodo isUserSubscribedToRelay
          const individualRelayAddress = config.RELAY_CONFIG.relay.individualRelayAddress;
          
          // Se abbiamo un relay registrato, verifichiamo se l'utente è iscritto
          if (individualRelayAddress) {
            try {
              // Format the key for blockchain verification
              const formattedKey = formatKeyForBlockchain(cleanedUserId);
              
              // Use the formatted key if available, otherwise fall back to original
              const keyToUse = formattedKey || cleanedUserId;
              
              console.log(`Token generation - checking relay subscription with key: ${keyToUse}`);
              
              // Verifica diretta sull'IndividualRelay con timeout di 10 secondi
              const subscriptionPromise = config.relayVerifier.isUserSubscribedToRelay(
                individualRelayAddress,
                keyToUse
              );
              
              // Add timeout protection
              const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Subscription verification timed out")), 10000);
              });
              
              isBlockchainAuthorized = await Promise.race([subscriptionPromise, timeoutPromise]);
              
              console.log(`Token generation - Relay verification result: ${isBlockchainAuthorized}`);
            } catch (error) {
              console.error(`Token generation - Error in IndividualRelay verification: ${error.message}`);
              // If there's an error with the verification, allow the token to be generated
              // but don't mark it as blockchain-verified
              isBlockchainAuthorized = false;
            }
          } else {
            console.log("Token generation - No IndividualRelay specified, skipping verification");
            isBlockchainAuthorized = false;
          }
        } else if (config.relayVerifier.isPublicKeyAuthorized) {
          console.log("Token generation - Using legacy verification method");
          
          // Metodo legacy - format the key first
          const formattedKey = formatKeyForBlockchain(cleanedUserId);
          const keyToUse = formattedKey || cleanedUserId;
          
          try {
            // Add timeout protection
            const verificationPromise = config.relayVerifier.isPublicKeyAuthorized(
              config.RELAY_CONFIG.relay.registryAddress,
              keyToUse
            );
            
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error("Legacy verification timed out")), 10000);
            });
            
            isBlockchainAuthorized = await Promise.race([verificationPromise, timeoutPromise]);
            console.log(`Token generation - Legacy verification result: ${isBlockchainAuthorized}`);
          } catch (error) {
            console.error(`Token generation - Error in legacy verification: ${error.message}`);
            isBlockchainAuthorized = false;
          }
        } else {
          console.log("Token generation - No compatible verifier method found");
          isBlockchainAuthorized = false;
        }
      } else {
        console.log("Token generation - UserId is not a blockchain key format");
        isBlockchainAuthorized = false;
      }
    } catch (err) {
      console.error("Token generation - Error in blockchain verification:", err);
      // Continue without blockchain authorization
      isBlockchainAuthorized = false;
    }
  } else {
    console.log("Token generation - Blockchain verification skipped, not enabled");
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = expiresInMs ? issuedAt + Math.floor(expiresInMs / 1000) : issuedAt + (30 * 24 * 60 * 60); // Default 30 giorni

  // Permessi
  const permissions = ["user"];
  if (isBlockchainAuthorized) {
    permissions.push("blockchain-verified");
  }

  const tokenPayload = {
    userId: userId,
    name: tokenName || "User API Token",
    iat: issuedAt,
    exp: expiresAt,
    permissions: permissions,
    isBlockchainAuthorized: isBlockchainAuthorized
  };

  try {
    console.log("Token generation - Signing JWT token");
    return jwt.sign(tokenPayload, config.JWT_SECRET);
  } catch (error) {
    console.error("Token generation - Error signing token:", error);
    throw new Error("Token signing failed.");
  }
}

/**
 * Salva le informazioni di un token utente
 * @param {Object} gun - Istanza GunDB
 * @param {string} userId - ID utente
 * @param {string} token - Token generato
 * @param {string} tokenName - Nome del token
 * @param {number} expiresAt - Data di scadenza
 */
async function saveUserToken(gun, userId, token, tokenName, expiresAt) {
  if (!gun || !userId || !token) {
    throw new Error("Gun instance, userId and token are required");
  }
  
  return new Promise((resolve) => {
    const tokenId = Date.now().toString();
    const tokenData = {
      id: tokenId,
      name: tokenName || "API Token",
      token: token,
      createdAt: Date.now(),
      expiresAt: expiresAt || null,
      revoked: false
    };
    
    gun.get("users").get(userId).get("tokens").get(tokenId).put(tokenData, (ack) => {
      resolve({success: !ack.err, tokenId, tokenData});
    });
    
    // Timeout di sicurezza
    setTimeout(() => resolve({success: false}), 3000);
  });
}

/**
 * Elenca i token di un utente
 */
async function listUserTokens(gun, userId) {
  if (!gun || !userId) {
    return [];
  }
  
  return new Promise((resolve) => {
    const tokens = [];
    gun
      .get("users")
      .get(userId)
      .get("tokens")
      .map()
      .once((token, tokenId) => {
        if (tokenId !== "_" && token) {
          const safeToken = { ...token };
          if (safeToken.token) {
            safeToken.token = safeToken.token.substring(0, 4) + "..." + 
                             safeToken.token.substring(safeToken.token.length - 4);
          }
          tokens.push(safeToken);
        }
      });
    
    setTimeout(() => resolve(tokens), 2000);
  });
}

/**
 * Revoca un token utente
 */
async function revokeUserToken(gun, userId, tokenId) {
  if (!gun || !userId || !tokenId) {
    return false;
  }
  
  return new Promise((resolve) => {
    gun
      .get("users")
      .get(userId)
      .get("tokens")
      .get(tokenId)
      .get("revoked")
      .put(true, (ack) => {
        resolve(!ack.err);
      });
    
    setTimeout(() => resolve(false), 3000);
  });
}

/**
 * Modulo centrale di autenticazione
 */
const AuthenticationManager = {
  /**
   * Valida un token da qualsiasi fonte di autenticazione
   */
  validateToken: async function (token, options = {}) {
    if (!token) return null;
    
    // Modalità sviluppo - consente tutti i token se specificato
    if (process.env.NODE_ENV === "development" && process.env.AUTH_ALLOW_ALL === "true") {
      return {
        valid: true,
        isSystemToken: false,
        userId: "dev-user",
        permissions: ["user", "admin"],
        source: "development",
      };
    }

    // Token admin di sistema (priorità massima)
    if (token === config.SECRET_TOKEN) {
      return {
        valid: true,
        isSystemToken: true,
        userId: "system",
        permissions: ["admin"],
        source: "system-token",
      };
    }

    // Verifica membership blockchain (seconda priorità)
    if (
      config.RELAY_CONFIG?.relay?.onchainMembership &&
      options.pubKey &&
      config.relayVerifier
    ) {
      try {
        // Format the key for blockchain verification
        const formattedKey = formatKeyForBlockchain(options.pubKey);
        const keyToUse = formattedKey || options.pubKey;
        
        const isAuthorized = await config.relayVerifier.isPublicKeyAuthorized(
          config.RELAY_CONFIG.relay.registryAddress,
          keyToUse
        );

        if (isAuthorized) {
          return {
            valid: true,
            isSystemToken: false,
            userId: null,
            permissions: ["user"],
            source: "blockchain",
          };
        }
      } catch (error) {
        console.error("Error in blockchain verification:", error);
        // Continua con altri metodi
      }
    }

    // Verifica token JWT (terza priorità)
      const jwtData = verifyJWT(token);
    if (jwtData) {
      return {
        valid: true,
        isSystemToken: false,
        userId: jwtData.userId,
        permissions: jwtData.permissions || ["user"],
        source: "jwt",
      };
    }

    // Verifica chiavi pre-autorizzate (priorità minima)
    if (isKeyPreAuthorized(token)) {
      return {
        valid: true,
        isSystemToken: false,
        userId: null,
        permissions: ["user"],
        source: "pre-authorized",
      };
    }

    return null;
  },

  /**
   * Middleware HTTP per protezione route
   */
  authenticateRequest: async function (req, res, next) {
    if (req.method === "OPTIONS") return next();

    const token = getTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Authentication required. Token missing.",
      });
    }

    const auth = await this.validateToken(token);
    if (!auth) {
      return res.status(403).json({
        success: false,
        error: "Invalid token.",
      });
    }

    req.auth = auth;
    next();
  },

  /**
   * Validazione messaggi GunDB
   */
  isValidGunMessage: function (msg) {
    // Log for debugging
    if (process.env.DEBUG_GUN_VALIDATION === "true") {
      console.log("=== GUN MESSAGE VALIDATION ===");
      const isPut = msg.put && Object.keys(msg.put).length > 0;
      console.log("Is PUT message:", isPut);
      
      if (isPut) {
        const keys = Object.keys(msg.put);
        console.log("PUT keys:", keys);
        
        // Check soul structure 
        for (const soul of keys) {
          console.log("Soul:", soul);
          
          // Check if it's a user message
          if (soul.startsWith("~")) {
            const dotIndex = soul.indexOf(".");
            const extractedPubKey = dotIndex > 0 ? soul.substring(1, dotIndex) : soul.substring(1);
            console.log("Message from user with pub:", extractedPubKey);
          }
        }
      }
      
      // Log headers
      if (msg.headers) {
        console.log("Headers present:", Object.keys(msg.headers));
        if (msg.headers.token) {
          console.log("Token present in headers");
        }
        if (msg.headers.Authorization) {
          console.log("Authorization header present");
        }
      }
      
      // Log user
      if (msg.user) {
        console.log("User object present:", msg.user.pub ? `pub: ${msg.user.pub}` : "no pub");
      }
      
      // Log from
      if (msg.from) {
        console.log("From object present:", msg.from.pub ? `pub: ${msg.from.pub}` : "no pub");
      }
    }

    // Non-PUT
    if (!msg.put || Object.keys(msg.put).length === 0) {
      return true;
    }


    // Admin token
    if (
      (msg?.headers?.token === config.SECRET_TOKEN)
    ) {
      console.log("Admin token")
      return true;
    }

    if(msg?.headers?.Authorization === "Bearer " + config.SECRET_TOKEN) {
      console.log("Admin token")
      return true;
    }

    // Estrazione chiave pubblica
    let pubKey = null;
    const putKeys = Object.keys(msg.put);
    for (const key of putKeys) {
      if (key.startsWith("~")) {
        const dotIndex = key.indexOf(".");
        pubKey = dotIndex > 0 ? key.substring(1, dotIndex) : key.substring(1);
        break;
      }
    }

    if (!pubKey) {
      if (msg.user?.pub) {
        pubKey = msg.user.pub;
      } else if (msg.from?.pub) {
        pubKey = msg.from.pub;
      } else if (msg.pub) {
        pubKey = msg.pub;
      }
    }

    // Log extracted pub key for debugging
    if (process.env.DEBUG_GUN_VALIDATION === "true") {
      console.log("Extracted pub key:", pubKey);
    }

    // Verifica chiave pre-autorizzata
    if (pubKey && isKeyPreAuthorized(pubKey)) {
      if (process.env.DEBUG_GUN_VALIDATION === "true") {
        console.log("Key is pre-authorized:", pubKey);
      }
      return true;
    }

    // Verifica JWT nei headers
    if (msg?.headers) {
      const tokenToCheck = msg.headers.token || 
                          (msg.headers.Authorization?.startsWith("Bearer ") ? 
                           msg.headers.Authorization.substring(7) : null);
      
      if (tokenToCheck && verifyJWT(tokenToCheck)) {
        if (process.env.DEBUG_GUN_VALIDATION === "true") {
          console.log("JWT token is valid");
        }
        return true;
      }
    }

    if (process.env.DEBUG_GUN_VALIDATION === "true") {
      console.log("Message validation FAILED");
    }
    return false;
  },

  /**
   * Autenticazione WebSocket
   */
  authenticateWebsocket: async function (req, socket, head) {
    try {
      const url = req.url;
      const origin = req.headers.origin;
      
      // Modalità sviluppo - consente tutte le connessioni
      if (process.env.NODE_ENV === "development") {
        return;
      }

      // Valida origine se presente
      if (origin && !allowedOrigins.includes(origin)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      // Controlli in modalità produzione
      let isAuthenticated = false;

      // Cerca token nell'URL
      if (url && (url.includes("?token=") || url.includes("&token="))) {
        try {
          const tokenParam = url.split(/[\?&]token=/)[1];
          if (tokenParam) {
            const token = tokenParam.split('&')[0];
            
            // Verifica autenticazione blockchain se pubKey disponibile
            let pubKey = null;
            if (token.includes('.') || token.startsWith('@')) {
              pubKey = token.startsWith('@') ? token.substring(1) : token;
              const dotIndex = pubKey.indexOf('.');
              if (dotIndex > 0) {
                pubKey = pubKey.substring(0, dotIndex);
              }
            }

            // Blockchain auth
            if (pubKey && RELAY_CONFIG?.relay?.onchainMembership && relayVerifier) {
              try {
                // Format the key for blockchain verification
                const formattedKey = formatKeyForBlockchain(pubKey);
                const keyToUse = formattedKey || pubKey;
                
                isAuthenticated = await relayVerifier.isPublicKeyAuthorized(
                  RELAY_CONFIG.relay.registryAddress, 
                  keyToUse
                );
              } catch (blockchainError) {
                console.error("Error in WebSocket blockchain auth:", blockchainError);
                // Continua con altri metodi
              }
            }

            // Altri metodi di autenticazione
            if (!isAuthenticated) {
              const tokenData = await this.validateToken(token);
              isAuthenticated = !!tokenData;
            }
          }
        } catch (e) {
          // Errore nell'analisi o validazione del token
        }
      }

      // Rifiuta connessione se non autenticata in produzione
      if (!isAuthenticated) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      return; // Lascia che Gun gestisca l'upgrade
    } catch (error) {
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    }
  },
  
  // Esponi direttamente le funzioni di gestione token
  generateUserToken,
  saveUserToken,
  listUserTokens,
  revokeUserToken,
  
  // Expose the formatKeyForBlockchain utility function
  formatKeyForBlockchain
};

// Esporta AuthenticationManager e funzioni di utilità
export { 
  AuthenticationManager, 
  isKeyPreAuthorized, 
  authorizeKey,
  verifyJWT,
  configure,
  generateUserToken,
  saveUserToken,
  listUserTokens,
  revokeUserToken,
  formatKeyForBlockchain
}; 