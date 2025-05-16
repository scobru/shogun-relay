import jwt from 'jsonwebtoken';

// Configurazione globale
let config;

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
  if (!pubKey || !authorizedKeys || !(authorizedKeys instanceof Map)) return false;

  const authInfo = authorizedKeys.get(pubKey);
  if (!authInfo) return false;

  // Rimuove autorizzazioni scadute
  if (Date.now() > authInfo.expiresAt) {
    authorizedKeys.delete(pubKey);
    return false;
  }

  return true;
}

/**
 * Autorizza temporaneamente una chiave pubblica
 */
function authorizeKey(pubKey, expiryMs = config.AUTH_KEY_EXPIRY) {
  if (!pubKey) throw new Error("Public key required for authorization");
  
  if (!authorizedKeys || !(authorizedKeys instanceof Map)) {
    authorizedKeys = new Map();
  }

  const authInfo = {
    pubKey,
    authorizedAt: Date.now(),
    expiresAt: Date.now() + expiryMs,
  };

  authorizedKeys.set(pubKey, authInfo);
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
      if (userId && (userId.length > 40 || userId.startsWith('0x'))) {
        // Verifica se relayVerifier è un'istanza di RelayRegistry
        if (config.relayVerifier.isUserSubscribedToRelay) {
          // È un RelayRegistry, usiamo il metodo isUserSubscribedToRelay
          const registryAddress = config.RELAY_CONFIG.relay.registryAddress;
          const individualRelayAddress = config.RELAY_CONFIG.relay.individualRelayAddress;
          
          // Se abbiamo un relay registrato, verifichiamo se l'utente è iscritto
          if (individualRelayAddress) {
            try {
              // Verifica diretta sull'IndividualRelay
              isBlockchainAuthorized = await config.relayVerifier.isUserSubscribedToRelay(
                individualRelayAddress,
                userId
              );
              console.log(`Verifica su IndividualRelay (${individualRelayAddress}): ${isBlockchainAuthorized}`);
            } catch (error) {
              console.error(`Errore nella verifica su IndividualRelay: ${error.message}`);
              
              // Fallback: verifica diretta del contratto IndividualRelay usando ethers
              try {
                console.log("Tentativo di verifica diretta del contratto IndividualRelay...");
                const { ethers } = await import("ethers");
                const provider = new ethers.JsonRpcProvider(config.RELAY_CONFIG.relay.providerUrl);
                
                // ABI minimo per verificare se un utente è iscritto
                const individualRelayAbi = [
                  "function isSubscribed(bytes memory pubKey) view returns (bool)"
                ];
                
                const contract = new ethers.Contract(
                  individualRelayAddress, 
                  individualRelayAbi, 
                  provider
                );
                
                // Converti la chiave pubblica nel formato adatto
                let pubKey = userId;
                // Rimuovi il prefisso ~ se presente
                if (pubKey.startsWith("~")) {
                  pubKey = pubKey.substring(1);
                }
                // Rimuovi tutto dopo il punto se presente
                const dotIndex = pubKey.indexOf(".");
                if (dotIndex > 0) {
                  pubKey = pubKey.substring(0, dotIndex);
                }
                
                // Converti da base64 a hex
                const base64Key = pubKey.replace(/-/g, "+").replace(/_/g, "/");
                const padded = base64Key.length % 4 === 0 
                  ? base64Key 
                  : base64Key.padEnd(base64Key.length + (4 - (base64Key.length % 4)), "=");
                const binaryData = Buffer.from(padded, "base64");
                const hexData = binaryData.toString("hex");
                
                // Verifica abbonamento direttamente dal contratto
                isBlockchainAuthorized = await contract.isSubscribed(`0x${hexData}`);
                console.log(`Verifica diretta su IndividualRelay: ${isBlockchainAuthorized}`);
              } catch (directError) {
                console.error(`Errore nella verifica diretta: ${directError.message}`);
              }
            }
          } 
          // Altrimenti proviamo a verificare con getAllRelays e controlliamo se l'utente è iscritto a uno qualsiasi
          else {
            try {
              const allRelays = await config.relayVerifier.getAllRelays();
              console.log(`Trovati ${allRelays.length} relay nel registro`);
              
              for (const relayAddress of allRelays) {
                const isSubscribed = await config.relayVerifier.isUserSubscribedToRelay(
                  relayAddress,
                  userId
                );
                if (isSubscribed) {
                  isBlockchainAuthorized = true;
                  console.log(`Utente autorizzato dal relay: ${relayAddress}`);
                  break;
                }
              }
            } catch (error) {
              console.error("Error checking relays:", error);
            }
          }
        } else if (config.relayVerifier.isPublicKeyAuthorized) {
          // Metodo legacy
          isBlockchainAuthorized = await config.relayVerifier.isPublicKeyAuthorized(
            config.RELAY_CONFIG.relay.registryAddress,
            userId
          );
        }
      }
    } catch (err) {
      console.error("Error checking blockchain authorization:", err);
      // Continua senza autorizzazione blockchain
    }
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
    return jwt.sign(tokenPayload, config.JWT_SECRET);
  } catch (error) {
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
        const isAuthorized = await config.relayVerifier.isPublicKeyAuthorized(
          config.RELAY_CONFIG.relay.registryAddress,
          options.pubKey
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

    // Verifica chiave pre-autorizzata
    if (pubKey && isKeyPreAuthorized(pubKey)) {
      return true;
    }

    // Verifica JWT nei headers
    if (msg?.headers) {
      const tokenToCheck = msg.headers.token || 
                          (msg.headers.Authorization?.startsWith("Bearer ") ? 
                           msg.headers.Authorization.substring(7) : null);
      
      if (tokenToCheck && verifyJWT(tokenToCheck)) {
        return true;
      }
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
                isAuthenticated = await relayVerifier.isPublicKeyAuthorized(
                  RELAY_CONFIG.relay.registryAddress, 
                  pubKey
                );
              } catch (blockchainError) {
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
  revokeUserToken
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
  revokeUserToken
}; 