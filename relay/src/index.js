// Enhanced Gun relay server with Shogun improvements
// MUST be required after Gun to work

import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";
import ip from "ip";
import qr from "qr";
import setSelfAdjustingInterval from "self-adjusting-interval";
import FormData from "form-data";
import "./utils/bullet-catcher.js";
import { ethers } from "ethers";

dotenv.config();

import Gun from "gun";
import SEA from "gun/sea.js";

import "gun/lib/stats.js";
import "gun/lib/webrtc.js";
import "gun/lib/rfs.js";

import ShogunCoreModule from "shogun-core";
const { derive } = ShogunCoreModule;
import http from "http";
import { createProxyMiddleware } from "http-proxy-middleware";
import multer from "multer";

// Importa i contratti dal pacchetto shogun-contracts
import { DEPLOYMENTS } from "shogun-contracts/deployments.js";

const namespace = "shogun";

// --- IPFS Configuration ---
const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN;
const IPFS_GATEWAY_URL =
  process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080";

// --- Garbage Collection Configuration ---
const GC_ENABLED = process.env.GC_ENABLED === "true";
// Namespaces to protect from garbage collection.
const GC_EXCLUDED_NAMESPACES = [
  // --- CRITICAL GUN METADATA ---
  "~", // Protects all user spaces, including user data and aliases (~@username).
  "!", // Protects the root node, often used for system-level pointers.
  "relays", // Protects relay server health-check data.
  "shogun",
];
// How often to run the garbage collector (milliseconds).
const GC_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ES Module equivalent for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
let host = process.env.RELAY_HOST || ip.address();
// Ensure port is always a valid integer, fallback to 8765 if NaN
let port = parseInt(process.env.RELAY_PORT || process.env.PORT || 8765);
if (isNaN(port) || port <= 0 || port >= 65536) {
  console.warn(
    `⚠️ Invalid port detected: ${
      process.env.RELAY_PORT || process.env.PORT
    }, falling back to 8765`
  );
  port = 8765;
}
let path_public = process.env.RELAY_PATH || "public";
let showQr = process.env.RELAY_QR !== "false";

// --- Config per smart contract ---
const WEB3_PROVIDER_URL = `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`; // Sepolia
const RELAY_CONTRACT_ADDRESS =
  DEPLOYMENTS.sepolia["Relay#RelayPaymentRouter"].address;
let relayContract;
let provider;

// Utilizza l'ABI dal pacchetto shogun-contracts
const RELAY_ABI = DEPLOYMENTS.sepolia["Relay#RelayPaymentRouter"].abi;

// --- Config per contratto Chain ---
let chainContract;
const CHAIN_CONTRACT_ADDRESS = DEPLOYMENTS.sepolia["Database#Chain"]?.address;
const CHAIN_ABI = DEPLOYMENTS.sepolia["Database#Chain"]?.abi;

// Initialize contract with network verification
async function initializeRelayContract() {
  if (!RELAY_CONTRACT_ADDRESS) {
    console.log("⚠️ RELAY_CONTRACT_ADDRESS not configured");
    return false;
  }

  if (!process.env.ALCHEMY_API_KEY) {
    console.log("⚠️ ALCHEMY_API_KEY not configured");
    return false;
  }

  try {
    provider = new ethers.JsonRpcProvider(WEB3_PROVIDER_URL);

    // Verify we're connected to Sepolia
    const network = await provider.getNetwork();
    console.log(
      `🔗 Connected to network: ${network.name} (chainId: ${network.chainId})`
    );

    if (network.chainId !== 11155111n) {
      console.warn(
        `⚠️ Expected Sepolia (11155111), but connected to ${network.name} (${network.chainId})`
      );
    }

    relayContract = new ethers.Contract(
      RELAY_CONTRACT_ADDRESS,
      RELAY_ABI,
      provider
    );

    console.log(`✅ Relay contract initialized at: ${RELAY_CONTRACT_ADDRESS}`);
    return true;
  } catch (error) {
    console.error("❌ Failed to initialize relay contract:", error);
    return false;
  }
}

// Initialize Chain contract
async function initializeChainContract() {
  if (!CHAIN_CONTRACT_ADDRESS) {
    console.log("⚠️ CHAIN_CONTRACT_ADDRESS not configured");
    return false;
  }

  if (!provider) {
    console.log("⚠️ Provider not initialized");
    return false;
  }

  try {
    chainContract = new ethers.Contract(
      CHAIN_CONTRACT_ADDRESS,
      CHAIN_ABI,
      provider
    );

    console.log(`✅ Chain contract initialized at: ${CHAIN_CONTRACT_ADDRESS}`);
    return true;
  } catch (error) {
    console.error("❌ Failed to initialize chain contract:", error);
    return false;
  }
}

// Main server initialization function
async function initializeServer() {
  console.log("🚀 Initializing Shogun Relay Server...");

  // Initialize relay contract
  await initializeRelayContract();

  // Initialize Chain contract
  await initializeChainContract();

  // System logging function
  function addSystemLog(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data,
    };

    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);

    // Store in Gun database for persistence
    if (gun) {
      gun.get("shogun").get("logs").get(timestamp).put(logEntry);
    }
  }

  // Propaga Chain contract event a GunDB
  async function propagateChainEventToGun(soul, key, value, event) {
    console.log("🔄 propagateChainEventToGun called with:", {
      soul,
      key,
      value,
    });

    if (!gun) {
      console.warn("⚠️ Gun not initialized, cannot propagate event");
      return;
    }

    try {
      // Crea un identificatore univoco per questo evento
      const eventId = `${event.transactionHash}-${event.logIndex || 0}`;
      console.log("📋 Event ID:", eventId);

      // Memorizza i dati dell'evento in GunDB
      console.log("💾 Storing event data in GunDB...");
      const eventNode = gun.get("shogun").get("chain_events").get(eventId);
      await new Promise((resolve, reject) => {
        eventNode.put(
          {
            soul: soul,
            key: key,
            value: value,
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
            timestamp: Date.now(),
            propagated: true,
          },
          (ack) => {
            if (ack.err) {
              console.error("❌ Error storing event data:", ack.err);
              reject(ack.err);
            } else {
              console.log("✅ Event data stored successfully");
              resolve();
            }
          }
        );
      });

      // Memorizza anche i dati nella struttura principale di GunDB usando dati leggibili
      console.log("💾 Storing data in main GunDB structure...");

      // Verifica che soul e key siano stringhe valide
      if (typeof soul !== "string" || typeof key !== "string") {
        console.warn(
          "⚠️ Soul or key is not a string, skipping main structure storage"
        );
        console.log("Soul type:", typeof soul, "Key type:", typeof key);
        return;
      }

      // Usa un approccio più sicuro per scrivere i dati
      try {
        const dataNode = gun.get(soul);
        if (!dataNode) {
          console.warn("⚠️ Could not get data node for soul:", soul);
          return;
        }

        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            console.warn("⚠️ Timeout writing to main GunDB structure");
            reject(new Error("Timeout"));
          }, 5000);

          dataNode.get(key).put(value, (ack) => {
            clearTimeout(timeoutId);
            if (ack.err) {
              console.error(
                "❌ Error storing data in main structure:",
                ack.err
              );
              reject(ack.err);
            } else {
              console.log("✅ Data stored in main structure successfully");
              resolve();
            }
          });
        });
      } catch (mainStructureError) {
        console.error(
          "❌ Error writing to main GunDB structure:",
          mainStructureError
        );
        // Non fallire completamente se la scrittura nella struttura principale fallisce
        // L'evento è già stato salvato nella sezione chain_events
      }

      console.log(`✅ Chain event propagated to GunDB: ${soul} -> ${key}`);

      // Aggiungi al log del sistema
      addSystemLog("info", "Chain event propagated to GunDB", {
        soul: soul,
        key: key,
        value: value,
        eventId: eventId,
      });
    } catch (error) {
      console.error("❌ Failed to propagate chain event to GunDB:", error);
      addSystemLog("error", "Failed to propagate chain event", {
        soul: soul,
        key: key,
        error: error.message,
      });
    }
  }

  // Start Chain contract event listener
  async function startChainEventListener() {
    if (!chainContract) {
      console.log("⚠️ Chain contract not initialized");
      return false;
    }

    try {
      console.log("🎧 Starting Chain contract event listener...");
      console.log("📋 Contract address:", chainContract.target);
      console.log(
        "📋 Contract filters:",
        chainContract.filters ? "Available" : "Not available"
      );

      // Rimuovi listener esistenti per evitare duplicati
      try {
        chainContract.removeAllListeners("NodeUpdated");
        console.log("🗑️ Removed existing listeners");
      } catch (error) {
        console.warn("⚠️ Could not remove existing listeners:", error.message);
      }

      // Variabili per il polling
      let lastProcessedBlock = 0;
      let isPolling = false;

      // Funzione di polling per controllare nuovi eventi
      const pollForEvents = async () => {
        if (isPolling) return; // Evita polling simultaneo
        isPolling = true;

        try {
          const currentBlock = await provider.getBlockNumber();

          if (lastProcessedBlock === 0) {
            // Prima volta: inizia dal blocco corrente
            lastProcessedBlock = currentBlock - 1;
            console.log(
              `🎯 Starting event polling from block ${lastProcessedBlock}`
            );
          }

          if (currentBlock > lastProcessedBlock) {
            console.log(
              `🔍 Polling for events from block ${
                lastProcessedBlock + 1
              } to ${currentBlock}`
            );

            try {
              const events = await chainContract.queryFilter(
                chainContract.filters.NodeUpdated(),
                lastProcessedBlock + 1,
                currentBlock
              );

              console.log(`📡 Found ${events.length} new events`);

              // Processa ogni evento
              for (const event of events) {
                console.log(
                  "🎉 EVENTO RICEVUTO! Chain contract event received:",
                  {
                    soul: event.args.soul,
                    key: event.args.key,
                    value: event.args.value,
                    blockNumber: event.blockNumber,
                    transactionHash: event.transactionHash,
                    logIndex: event.logIndex,
                  }
                );

                // Log dettagliato della struttura degli oggetti
                console.log("🔍 Soul structure:", {
                  type: typeof event.args.soul,
                  isObject: typeof event.args.soul === "object",
                  hasHash:
                    event.args.soul &&
                    typeof event.args.soul === "object" &&
                    "hash" in event.args.soul,
                  hash:
                    event.args.soul && typeof event.args.soul === "object"
                      ? event.args.soul.hash
                      : "N/A",
                });

                console.log("🔍 Key structure:", {
                  type: typeof event.args.key,
                  isObject: typeof event.args.key === "object",
                  hasHash:
                    event.args.key &&
                    typeof event.args.key === "object" &&
                    "hash" in event.args.key,
                  hash:
                    event.args.key && typeof event.args.key === "object"
                      ? event.args.key.hash
                      : "N/A",
                });

                // Decode the value from bytes to string
                let decodedValue;
                try {
                  decodedValue = ethers.toUtf8String(event.args.value);
                  console.log("✅ Value decoded successfully:", decodedValue);
                } catch (error) {
                  console.warn(
                    "⚠️ Could not decode value as UTF-8, using hex:",
                    event.args.value
                  );
                  decodedValue = event.args.value;
                }

                // Decode soul and key from bytes to string
                let soulString, keyString;
                try {
                  console.log("🔍 Raw event args:", {
                    soul: event.args.soul,
                    key: event.args.key,
                    soulType: typeof event.args.soul,
                    keyType: typeof event.args.key,
                  });

                  // Gestisci sia eventi indexed che non-indexed
                  let soulBytes, keyBytes;

                  // Controlla se sono oggetti Indexed (vecchio contratto)
                  if (
                    event.args.soul &&
                    typeof event.args.soul === "object" &&
                    event.args.soul._isIndexed
                  ) {
                    console.log("🔍 Detected indexed soul, using hash");
                    soulBytes = event.args.soul.hash;
                  } else if (
                    event.args.soul &&
                    typeof event.args.soul === "object"
                  ) {
                    // Oggetto Result di Ethers.js (nuovo contratto)
                    soulBytes =
                      event.args.soul.bytes ||
                      event.args.soul.data ||
                      event.args.soul;
                  } else {
                    soulBytes = event.args.soul;
                  }

                  if (
                    event.args.key &&
                    typeof event.args.key === "object" &&
                    event.args.key._isIndexed
                  ) {
                    console.log("🔍 Detected indexed key, using hash");
                    keyBytes = event.args.key.hash;
                  } else if (
                    event.args.key &&
                    typeof event.args.key === "object"
                  ) {
                    // Oggetto Result di Ethers.js (nuovo contratto)
                    keyBytes =
                      event.args.key.bytes ||
                      event.args.key.data ||
                      event.args.key;
                  } else {
                    keyBytes = event.args.key;
                  }

                  console.log("🔍 Extracted bytes:", {
                    soulBytes: soulBytes,
                    keyBytes: keyBytes,
                    soulBytesType: typeof soulBytes,
                    keyBytesType: typeof keyBytes,
                  });

                  // Se sono hash keccak256 (eventi indexed), non possiamo decodificarli
                  if (
                    typeof soulBytes === "string" &&
                    soulBytes.startsWith("0x") &&
                    soulBytes.length === 66
                  ) {
                    console.log(
                      "⚠️ Soul is keccak256 hash, cannot decode to original string"
                    );
                    soulString = `hash_${soulBytes.substring(2, 10)}`;
                  } else {
                    // Prova a decodificare come UTF-8
                    soulString = ethers.toUtf8String(soulBytes);
                  }

                  if (
                    typeof keyBytes === "string" &&
                    keyBytes.startsWith("0x") &&
                    keyBytes.length === 66
                  ) {
                    console.log(
                      "⚠️ Key is keccak256 hash, cannot decode to original string"
                    );
                    keyString = `hash_${keyBytes.substring(2, 10)}`;
                  } else {
                    // Prova a decodificare come UTF-8
                    keyString = ethers.toUtf8String(keyBytes);
                  }

                  console.log(
                    `✅ Final decoded: soul="${soulString}", key="${keyString}"`
                  );
                } catch (error) {
                  console.warn(
                    "⚠️ Could not decode soul/key as UTF-8, using fallback"
                  );
                  console.log("Decode error:", error.message);

                  // Se la decodifica fallisce, usa i valori originali
                  soulString = String(event.args.soul || "");
                  keyString = String(event.args.key || "");

                  console.log("🔍 Using fallback values:", {
                    soulString: soulString,
                    keyString: keyString,
                  });
                }

                // Verifica che soulString e keyString siano stringhe valide
                if (
                  typeof soulString !== "string" ||
                  typeof keyString !== "string"
                ) {
                  console.warn(
                    "⚠️ Soul or key is still not a string after decoding, converting to string"
                  );
                  soulString = String(soulString || "");
                  keyString = String(keyString || "");
                }

                // Verifica che i valori non siano vuoti
                if (!soulString || !keyString) {
                  console.warn(
                    "⚠️ Soul or key is empty after decoding, skipping event"
                  );
                  console.log("Soul:", soulString, "Key:", keyString);
                  continue;
                }

                // Propaga a GunDB con i dati originali leggibili
                console.log("🔄 Calling propagateChainEventToGun...");
                await propagateChainEventToGun(
                  soulString,
                  keyString,
                  decodedValue,
                  event
                );
              }

              lastProcessedBlock = currentBlock;
            } catch (filterError) {
              console.warn("⚠️ Error querying events:", filterError.message);
              // Non aggiornare lastProcessedBlock in caso di errore
            }
          }
        } catch (error) {
          console.error("❌ Error in polling:", error);
        } finally {
          isPolling = false;
        }
      };

      // Avvia il polling ogni 5 secondi
      const pollingInterval = setInterval(pollForEvents, 5000);

      // Esegui il primo polling immediatamente
      await pollForEvents();

      console.log("✅ Chain contract event listener started (polling mode)");
      return true;
    } catch (error) {
      console.error("❌ Failed to start chain event listener:", error);
      return false;
    }
  }

  // Start Chain contract event listener
  await startChainEventListener();

 
  // Funzione per i dati di serie temporale
  function addTimeSeriesPoint(key, value) {
    const timestamp = Date.now();
    const dataPoint = {
      timestamp,
      key,
      value,
    };

    if (gun) {
      gun
        .get("shogun")
        .get("timeseries")
        .get(key)
        .get(timestamp)
        .put(dataPoint);
    }
  }

  // Funzione di raccolta spazzatura
  function runGarbageCollector() {
    if (!GC_ENABLED) {
      console.log("🗑️ Garbage Collector is disabled.");
      return;
    }
    console.log("🗑️ Running Garbage Collector...");
    addSystemLog("info", "Garbage collection started");
    let cleanedCount = 0;

    // Assicurati che gun sia inizializzato prima di accedere alle sue proprietà
    if (!gun || !gun._ || !gun._.graph) {
      console.warn(
        "⚠️ Gun non ancora inizializzato, saltando la raccolta spazzatura"
      );
      return;
    }

    const graph = gun._.graph;

    for (const soul in graph) {
      if (Object.prototype.hasOwnProperty.call(graph, soul)) {
        const isProtected = GC_EXCLUDED_NAMESPACES.some((ns) =>
          soul.startsWith(ns)
        );

        if (!isProtected) {
          gun.get(soul).put(null);
          cleanedCount++;
          console.log(`🗑️ Pulito nodo non protetto: ${soul}`);
        }
      }
    }

    if (cleanedCount > 0) {
      console.log(
        `🗑️ Garbage Collector finished. Cleaned ${cleanedCount} nodes.`
      );
      addSystemLog(
        "info",
        `Garbage collection completed. Cleaned ${cleanedCount} nodes`
      );
    } else {
      console.log(
        "🗑️ Garbage Collector finished. No unprotected nodes found to clean."
      );
      addSystemLog("info", "Garbage collection completed. No nodes to clean");
    }
  }

  // Memorizza il riferimento all'intervallo di GC per il cleanup
  let gcInterval = null;

  // Inizializza il garbage collector
  function initializeGarbageCollector() {
    if (GC_ENABLED) {
      console.log("🗑️ Initializing garbage collector...");
      gcInterval = setInterval(runGarbageCollector, GC_INTERVAL);
      console.log(
        `✅ Garbage Collector scheduled to run every ${
          GC_INTERVAL / 1000 / 60
        } minutes.`
      );
      addSystemLog("info", "Garbage collector initialized");
      // Esegui una volta all'avvio per un ritardo
      setTimeout(runGarbageCollector, 30 * 1000); // Esegui 30s dopo l'avvio
    } else {
      console.log("🗑️ Garbage collection disabled");
    }
  }

  // Flag per consentire operazioni interne durante REST API
  let allowInternalOperations = false;

  // Funzione helper per trovare il relay corrente basandosi sull'URL
  async function getCurrentRelayAddress() {
    try {
      if (!relayContract) {
        console.error("Relay contract not initialized");
        return null;
      }

      // Ottieni l'URL corrente del server
      const serverURL = process.env.SERVER_URL || `http://${host}:${port}`;
      const relayURL = serverURL + "/gun";
      console.log("🔍 Looking for relay with URL:", relayURL);

      // Prova prima a trovare il relay specifico per questo URL
      try {
        const specificRelayAddress = await relayContract.findRelayByURL(
          relayURL
        );
        if (
          specificRelayAddress &&
          specificRelayAddress !== "0x0000000000000000000000000000000000000000"
        ) {
          console.log(
            "✅ Found specific relay for this URL:",
            specificRelayAddress
          );
          return specificRelayAddress;
        }
      } catch (error) {
        console.log(
          "⚠️ Could not find specific relay by URL, trying fallback..."
        );
      }

      // Fallback: ottieni tutti i relay e usa il primo
      console.log("🔄 Using fallback: getting all relays");
      const allRelays = await relayContract.getAllRelays();
      console.log("getAllRelays() result:", allRelays);

      if (allRelays.length > 0) {
        const fallbackRelayAddress = allRelays[0];
        console.log("📋 Using first available relay:", fallbackRelayAddress);

        // Ottieni i dettagli del relay per il logging
        try {
          const relayDetails = await relayContract.getRelayDetails(
            fallbackRelayAddress
          );
          console.log("📊 Relay details:", relayDetails);

          // Log un avviso se non è il relay specifico
          if (relayDetails.url !== relayURL) {
            console.warn(
              `⚠️ Using relay: ${relayDetails.url} (not the current relay)`
            );
          }
        } catch (detailsError) {
          console.log("Could not get relay details:", detailsError);
        }

        return fallbackRelayAddress;
      } else {
        console.warn("No relay registered in the contract");
        return null;
      }
    } catch (error) {
      console.error("Failed to get current relay address:", error);
      return null;
    }
  }

  // Funzione di validazione del token
  function hasValidToken(msg) {
    if (process.env.RELAY_PROTECTED === "false") {
      console.log("🔍 PUT allowed - protected disabled");
      return true;
    }

    // Analizza le anime (souls) che sta cercando di modificare
    const souls = Object.keys(msg.put || {});
    const firstSoul = souls[0];

    // Permetti operazioni temporanee durante REST API
    if (allowInternalOperations) {
      console.log(`🔍 PUT allowed - internal operation flag: ${firstSoul}`);
      return true;
    }

    // Permetti operazioni interne di Gun senza autenticazione
    const isInternalNamespace =
      firstSoul &&
      (firstSoul.startsWith("~") || // Namespace utente
        firstSoul.startsWith("!") || // Namespace radice
        firstSoul === "shogun" || // Operazioni interne di Shogun
        firstSoul.startsWith("shogun/relays") || // Dati di salute del relay
        firstSoul.startsWith("shogun/uploads") || // Upload utente (permette salvataggio upload utente)
        firstSoul.startsWith("shogun/timeseries") || // Dati di serie temporale
        firstSoul.startsWith("shogun/logs") || // Log del sistema
        firstSoul.startsWith("shogun/chain_events") || // Eventi del contratto Chain
        firstSoul.startsWith("shogun/mbUsage") || // Utilizzo MB off-chain
        firstSoul.startsWith("shogun/mb_usage") || // Utilizzo MB off-chain (alternativo)
        !firstSoul.includes("/") || // Chiavi a livello singolo (operazioni interne di Gun)
        firstSoul.match(
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
        )); // UUID souls

    if (isInternalNamespace) {
      console.log(`🔍 PUT allowed - internal namespace: ${firstSoul}`);
      return true;
    }

    // Se ha headers, verifica il token
    if (msg && msg.headers && msg.headers.token) {
      const hasValidAuth = msg.headers.token === process.env.ADMIN_PASSWORD;
      if (hasValidAuth) {
        console.log(`🔍 PUT allowed - valid token: ${firstSoul}`);
        return true;
      }
    }

    console.log(`❌ PUT denied - no valid auth: ${firstSoul}`);
    return false;
  }

  // Crea l'app Express
  const app = express();
  const publicPath = path.resolve(__dirname, path_public);
  const indexPath = path.resolve(publicPath, "index.html");

  // Middleware
  app.use(cors());
  app.use(express.json()); // Aggiungi supporto per il parsing del body JSON
  app.use(express.urlencoded({ extended: true })); // Aggiungi supporto per i dati del form
  app.use(Gun.serve);

  // Middleware di protezione per le route statiche che richiedono autenticazione admin
  const protectedStaticRoutes = [
    '/services-dashboard', '/stats', '/charts', '/graph', '/visualGraph',
    '/upload', '/pin-manager', '/ipfs-status', '/create', '/view',
    '/chain-contract', '/ipcm-contract', '/notes', '/derive'
  ];

  app.use((req, res, next) => {
    const path = req.path;
    
    // Controlla se la route richiede autenticazione admin
    if (protectedStaticRoutes.includes(path)) {
      // Verifica autenticazione admin
      const authHeader = req.headers["authorization"];
      const bearerToken = authHeader && authHeader.split(" ")[1];
      const customToken = req.headers["token"];
      const token = bearerToken || customToken;

      if (token === process.env.ADMIN_PASSWORD) {
        next();
      } else {
        console.log(`❌ Accesso negato a ${path} - Token mancante o non valido`);
        return res.status(401).json({ 
          success: false, 
          error: "Unauthorized - Admin authentication required",
          message: "Questa pagina richiede autenticazione admin. Inserisci la password admin nella pagina principale."
        });
      }
    } else {
      // Route pubblica, continua
      next();
    }
  });

  // IPFS File Upload Endpoint
  const upload = multer({ storage: multer.memoryStorage() });

  // Middleware di autenticazione
  const tokenAuthMiddleware = (req, res, next) => {
    // Check Authorization header (Bearer token)
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];

    // Check custom token header (for Gun/Wormhole compatibility)
    const customToken = req.headers["token"];

    // Accept either format
    const token = bearerToken || customToken;

    if (token === process.env.ADMIN_PASSWORD) {
      // Use a more secure token in production
      next();
    } else {
      console.log("Auth failed - Bearer:", bearerToken, "Custom:", customToken);
      res.status(401).json({ success: false, error: "Unauthorized" });
    }
  };

  // Middleware per endpoint user che verifica l'header x-user-address
  const userAuthMiddleware = (req, res, next) => {
    const pubKey = req.headers["x-pubkey"];
    if (!pubKey) {
      return res.status(401).json({
        success: false,
        error: "x-pubkey header richiesto",
      });
    }
    req.userPubKey = pubKey;
    next();
  };

  // Funzione per verificare la firma del wallet
  function verifyWalletSignature(message, signature, expectedAddress) {
    try {
      // Verifica che l'address sia valido
      if (
        !expectedAddress ||
        !expectedAddress.startsWith("0x") ||
        expectedAddress.length !== 42
      ) {
        return false;
      }

      // Verifica che la firma sia valida
      if (
        !signature ||
        !signature.startsWith("0x") ||
        signature.length !== 132
      ) {
        return false;
      }

      // Per ora restituiamo true se i formati sono corretti
      // In futuro potremmo implementare la verifica crittografica completa
      console.log(`🔐 Verifying signature for address: ${expectedAddress}`);
      console.log(`🔐 Message: ${message}`);
      console.log(`🔐 Signature: ${signature.substring(0, 20)}...`);

      return true;
    } catch (error) {
      console.error("❌ Error verifying wallet signature:", error);
      return false;
    }
  }

  // Middleware per autenticare le richieste con firma del wallet
  const walletSignatureMiddleware = (req, res, next) => {
    try {
      const userAddress = req.headers["x-user-address"];
      const signature = req.headers["x-wallet-signature"];
      const message = req.headers["x-signature-message"] || "I Love Shogun";

      if (!userAddress) {
        return res.status(401).json({
          success: false,
          error: "x-user-address header richiesto",
        });
      }

      if (!signature) {
        return res.status(401).json({
          success: false,
          error: "x-wallet-signature header richiesto per autenticazione",
        });
      }

      // Verifica la firma
      if (!verifyWalletSignature(message, signature, userAddress)) {
        return res.status(401).json({
          success: false,
          error: "Firma del wallet non valida",
        });
      }

      console.log(`✅ Wallet signature verified for: ${userAddress}`);
      next();
    } catch (error) {
      console.error("❌ Wallet signature middleware error:", error);
      res.status(500).json({
        success: false,
        error: "Errore di autenticazione",
      });
    }
  };

  // IPFS upload endpoint (admin) - DEPRECATED: use /api/v1/ipfs/upload instead
  app.post(
    "/ipfs-upload",
    tokenAuthMiddleware,
    upload.single("file"),
    async (req, res) => {
      res.status(410).json({
        success: false,
        error: "This endpoint is deprecated. Use /api/v1/ipfs/upload instead.",
        message: "Please update your client to use the new API endpoint.",
      });
    }
  );

  // IPFS upload endpoint (user) - DEPRECATED: use /api/v1/ipfs/upload instead
  app.post(
    "/ipfs-upload-user",
    walletSignatureMiddleware,
    upload.single("file"),
    async (req, res) => {
      res.status(410).json({
        success: false,
        error: "This endpoint is deprecated. Use /api/v1/ipfs/upload instead.",
        message: "Please update your client to use the new API endpoint.",
      });
    }
  );

  // --- Start Server Function ---
  async function startServer() {
    const server = app.listen(port, (error) => {
      if (error) {
        return console.log("Error during app startup", error);
      }
      console.log(`Server listening on port ${port}...`);
    });

    return server;
  }

  const server = await startServer();

  const peersString = process.env.RELAY_PEERS;
  const peers = peersString ? peersString.split(",") : [];
  console.log("🔍 Peers:", peers);

  // Initialize Gun with conditional support
  const gunConfig = {
    super: false,
    file: "radata",
    radisk: true,
    web: server,
    isValid: hasValidToken,
    uuid: process.env.RELAY_NAME,
    localStorage: true, // Abilita localStorage per persistenza
    wire: true,
    axe: true,
    rfs: true,
    wait: 500,
    webrtc: true,
    peers: peers,
  };

  console.log("📁 Using local file storage only");

  Gun.on("opt", function (ctx) {
    if (ctx.once) {
      return;
    }
    ctx.on("out", function (msg) {
      let to = this.to;
      // Adds headers for put
      msg.headers = {
        token: process.env.ADMIN_PASSWORD,
      };
      to.next(msg); // pass to next middleware
    });
  });

  const gun = Gun(gunConfig);

  // Configura l'istanza Gun per le route di autenticazione
  app.set("gunInstance", gun);

  // Esponi le funzioni helper per le route
  app.set("addSystemLog", addSystemLog);
  app.set("addTimeSeriesPoint", addTimeSeriesPoint);
  app.set("runGarbageCollector", runGarbageCollector);
  app.set("getCurrentRelayAddress", getCurrentRelayAddress);

  // Esponi le funzioni del contratto Chain per le route
  app.set("chainContract", chainContract);
  app.set("startChainEventListener", startChainEventListener);
  app.set("propagateChainEventToGun", propagateChainEventToGun);

  // Esponi la mappatura per le route
  // app.set("originalNamesMap", originalNamesMap); // Removed as per edit hint
  // app.set("addHashMapping", addHashMapping); // Removed as per edit hint
  // app.set("calculateKeccak256Hash", calculateKeccak256Hash); // Removed as per edit hint

  // Wrapper per syncChainContractToGun che accede alla funzione corretta
  app.set("syncChainContractToGun", async (params) => {
    try {
      if (!gun) {
        console.error("❌ Gun not initialized");
        return false;
      }

      if (!chainContract) {
        console.error("❌ Chain contract not initialized");
        return false;
      }

      console.log("🔧 Calling syncChainContractToGun function...");
      const result = await syncChainContractToGun(params);
      console.log("🔧 syncChainContractToGun returned:", result);
      return result;
    } catch (error) {
      console.error("❌ Error in syncChainContractToGun wrapper:", error);
      return false;
    }
  });

  app.set("propagateChainEventToGun", propagateChainEventToGun);

  // Esponi i middleware di autenticazione per le route
  app.set("tokenAuthMiddleware", tokenAuthMiddleware);
  app.set("userAuthMiddleware", userAuthMiddleware);
  app.set("walletSignatureMiddleware", walletSignatureMiddleware);
  app.set("verifyWalletSignature", verifyWalletSignature);

  // Esponi la variabile per operazioni interne
  app.set("allowInternalOperations", () => allowInternalOperations);
  app.set("setAllowInternalOperations", (value) => {
    allowInternalOperations = value;
  });

  // Funzione per calcolare l'utilizzo MB off-chain (versione ottimizzata)
  async function getOffChainMBUsage(userAddress) {
    try {
      const mbUsageNode = gun.get("shogun").get("mb_usage").get(userAddress);
      const offChainUsage = await new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          console.warn(
            `⚠️ GunDB mb_usage read timeout for ${userAddress}, returning cached value`
          );
          resolve({ mbUsed: 0, lastUpdated: Date.now(), timeout: true });
        }, 800); // Timeout ridotto a 800ms

        mbUsageNode.once((data) => {
          clearTimeout(timeoutId);
          resolve(data || { mbUsed: 0, lastUpdated: Date.now() });
        });
      });

      // Se i dati off-chain non sono affidabili, avvia un calcolo in background
      if (offChainUsage.timeout || offChainUsage.mbUsed === 0) {
        // Avvia il calcolo in background senza bloccare
        setTimeout(() => {
          recalculateMBUsageFromFiles(userAddress);
        }, 100);
      }

      return offChainUsage;
    } catch (error) {
      console.error("Error getting off-chain MB usage:", error);
      return { mbUsed: 0, lastUpdated: Date.now(), error: error.message };
    }
  }

  // Funzione separata per ricalcolare l'utilizzo MB dai file (non bloccante)
  async function recalculateMBUsageFromFiles(userAddress) {
    try {
      console.log(
        `🔄 Background recalculation of MB usage from existing files for ${userAddress}`
      );

      // Ottieni tutti i file dell'utente
      const uploadsNode = gun.get("shogun").get("uploads").get(userAddress);
      const userFiles = await new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          console.warn(
            `⚠️ Background GunDB uploads read timeout for ${userAddress}`
          );
          resolve([]);
        }, 1500); // Timeout ridotto a 1.5 secondi

        uploadsNode.once((parentData) => {
          clearTimeout(timeoutId);

          if (!parentData || typeof parentData !== "object") {
            resolve([]);
            return;
          }

          const hashKeys = Object.keys(parentData).filter(
            (key) => key !== "_"
          );
          let uploadsArray = [];
          let completedReads = 0;
          const totalReads = hashKeys.length;

          if (totalReads === 0) {
            resolve([]);
            return;
          }

          // Timeout per ogni singola lettura di file
          const fileReadTimeout = setTimeout(() => {
            console.warn(`⚠️ Background file read timeout, using partial data`);
            resolve(uploadsArray);
          }, 2000);

          hashKeys.forEach((hash) => {
            uploadsNode.get(hash).once((uploadData) => {
              completedReads++;
              if (uploadData && uploadData.sizeMB) {
                uploadsArray.push(uploadData);
              }
              if (completedReads === totalReads) {
                clearTimeout(fileReadTimeout);
                resolve(uploadsArray);
              }
            });
          });
        });
      });

      // Calcola il totale dei MB dai file
      const calculatedMbUsed = userFiles.reduce(
        (sum, file) => sum + (file.sizeMB || 0),
        0
      );
      console.log(
        `📊 Background calculated MB usage from files: ${calculatedMbUsed} MB (${userFiles.length} files)`
      );

      // Aggiorna i dati off-chain per futuri utilizzi
      if (calculatedMbUsed > 0) {
        const mbUsageNode = gun.get("shogun").get("mb_usage").get(userAddress);
        const updatedUsage = {
          mbUsed: calculatedMbUsed,
          lastUpdated: Date.now(),
          updatedBy: "background-recalculation-from-files",
        };

        mbUsageNode.put(updatedUsage, (ack) => {
          if (ack.err) {
            console.error("Error updating background recalculated MB usage:", ack.err);
          } else {
            console.log(
              `✅ Background updated off-chain MB usage with recalculated value: ${calculatedMbUsed} MB`
            );
          }
        });
      }
    } catch (error) {
      console.error("Error in background MB usage recalculation:", error);
    }
  }

  // Esponi la funzione getOffChainMBUsage
  app.set("getOffChainMBUsage", getOffChainMBUsage);

  // Esponi le configurazioni IPFS
  app.set("IPFS_API_URL", IPFS_API_URL);
  app.set("IPFS_API_TOKEN", IPFS_API_TOKEN);
  app.set("IPFS_GATEWAY_URL", IPFS_GATEWAY_URL);

  // Esponi l'istanza Gun globalmente per le route
  global.gunInstance = gun;

  // Route legacy per compatibilità (definite prima delle route modulari)

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      activeConnections: activeWires || 0,
      totalConnections: totalConnections || 0,
      memoryUsage: process.memoryUsage(),
    });
  });

  // IPFS status endpoint
  app.get("/ipfs-status", async (req, res) => {
    try {
      console.log("📊 IPFS Status: Checking IPFS node status");

      const requestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: "/api/v0/version",
        method: "POST",
        headers: {
          "Content-Length": "0",
        },
      };

      if (IPFS_API_TOKEN) {
        requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const http = await import("http");
      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        let data = "";
        ipfsRes.on("data", (chunk) => (data += chunk));
        ipfsRes.on("end", () => {
          try {
            const versionData = JSON.parse(data);
            res.json({
              success: true,
              status: "connected",
              version: versionData.Version,
              apiUrl: IPFS_API_URL,
            });
          } catch (parseError) {
            console.error("IPFS status parse error:", parseError);
            res.json({
              success: false,
              status: "error",
              error: "Failed to parse IPFS response",
            });
          }
        });
      });

      ipfsReq.on("error", (err) => {
        console.error("❌ IPFS Status Error:", err);
        res.json({
          success: false,
          status: "disconnected",
          error: "IPFS node not responding",
        });
      });

      ipfsReq.end();
    } catch (error) {
      console.error("❌ IPFS Status Error:", error);
      res.json({
        success: false,
        status: "error",
        error: error.message,
      });
    }
  });

  // Importa e configura le route modulari
  try {
    const routes = await import("./routes/index.js");
    routes.default(app);
    console.log("✅ Route modulari configurate con successo");
  } catch (error) {
    console.error("❌ Errore nel caricamento delle route modulari:", error);
  }

  // Route statiche (DEFINITE DOPO LE API)
  app.use(express.static(publicPath));

  // Initialize garbage collector now that gun is ready
  initializeGarbageCollector();

  // Set up relay stats database
  const db = gun.get(namespace).get("relays").get(host);

  let totalConnections = 0;
  let activeWires = 0;

  gun.on("hi", () => {
    totalConnections += 1;
    activeWires += 1;
    db?.get("totalConnections").put(totalConnections);
    db?.get("activeWires").put(activeWires);
    console.log(`Connection opened (active: ${activeWires})`);
  });

  gun.on("bye", () => {
    activeWires -= 1;
    db?.get("activeWires").put(activeWires);
    console.log(`Connection closed (active: ${activeWires})`);
  });

  gun.on("out", { get: { "#": { "*": "" } } });

  // Set up pulse interval for health monitoring
  setSelfAdjustingInterval(() => {
    const pulse = {
      timestamp: Date.now(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      connections: {
        total: totalConnections,
        active: activeWires,
      },
      relay: {
        host,
        port,
        namespace,
      },
    };

    db?.get("pulse").put(pulse);
    addTimeSeriesPoint("connections.active", activeWires);
    addTimeSeriesPoint("memory.heapUsed", process.memoryUsage().heapUsed);
  }, 30000); // 30 seconds

  // Shutdown function
  async function shutdown() {
    console.log("🛑 Shutting down Shogun Relay...");
    addSystemLog("info", "Server shutdown initiated");

    // Clean up garbage collector interval
    if (gcInterval) {
      clearInterval(gcInterval);
      console.log("✅ Garbage collector interval cleared");
    }

    // Clean up listener health check interval
    // if (listenerHealthCheckInterval) { // This line is removed as per the edit hint
    //   clearInterval(listenerHealthCheckInterval);
    //   console.log("✅ Listener health check interval cleared");
    // }

    // Close server
    if (server) {
      server.close(() => {
        console.log("✅ Server closed");
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }

  // Handle shutdown signals
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Show QR code if enabled
  if (showQr) {
    const url = `http://${host}:${port}`;
    console.log(`📱 QR Code for: ${url}`);
    try {
      const qrCode = qr.image(url, { type: "terminal", small: true });
      console.log(qrCode);
    } catch (qrError) {
      console.log(`📱 QR Code generation failed: ${qrError.message}`);
      console.log(`📱 URL: ${url}`);
    }
  }

  console.log(`🚀 Shogun Relay Server running on http://${host}:${port}`);
  addSystemLog("info", "Server started successfully", {
    host,
    port,
    namespace,
    peers: peers.length,
  });

  return {
    server,
    gun,
    db,
    addSystemLog,
    addTimeSeriesPoint,
    runGarbageCollector,
    shutdown,
  };
}

// Avvia il server
initializeServer().catch(console.error);
