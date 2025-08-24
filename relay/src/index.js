// Enhanced Gun relay server with Shogun improvements
// MUST be required after Gun to work

import express from "express";

// Helper function to sanitize data for GunDB storage
function sanitizeForGunDB(data) {
  if (data === null || data === undefined) {
    return null;
  }

  // Handle primitive types directly
  if (
    typeof data === "string" ||
    typeof data === "number" ||
    typeof data === "boolean"
  ) {
    return data;
  }

  // Handle Date objects
  if (data instanceof Date) {
    return data.toISOString();
  }

  // Handle Buffer objects
  if (Buffer.isBuffer(data)) {
    return data.toString("base64");
  }

  // Handle arrays
  if (Array.isArray(data)) {
    try {
      return data.map((item) => sanitizeForGunDB(item));
    } catch (error) {
      console.warn("⚠️ Error sanitizing array:", error);
      return [];
    }
  }

  // Handle objects
  if (typeof data === "object") {
    try {
      // First, try to serialize to test if it's valid JSON
      JSON.stringify(data);

      // If successful, recursively sanitize all properties
      const sanitized = {};
      for (const [key, value] of Object.entries(data)) {
        // Skip functions and symbols
        if (typeof value === "function" || typeof value === "symbol") {
          continue;
        }
        sanitized[key] = sanitizeForGunDB(value);
      }
      return sanitized;
    } catch (error) {
      // If JSON serialization fails, create a safe representation
      console.warn(
        "⚠️ Object could not be serialized, creating safe representation:",
        error
      );
      return {
        _error: "Object could not be serialized",
        _type: typeof data,
        _constructor: data.constructor?.name || "Unknown",
        _stringified: String(data),
        _timestamp: Date.now(),
      };
    }
  }

  // For any other type, convert to string
  try {
    return String(data);
  } catch (error) {
    console.warn("⚠️ Error converting data to string:", error);
    return "[Unserializable Data]";
  }
}
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";
import ip from "ip";
import qr from "qr";
import setSelfAdjustingInterval from "self-adjusting-interval";
import "./utils/bullet-catcher.js";
import { ethers } from "ethers";
import { ShogunCore } from "shogun-core";

dotenv.config();

import Gun from "gun";
import "gun/sea.js";

import "gun/lib/stats.js";
import "gun/lib/webrtc.js";
import "gun/lib/rfs.js";
import "gun/lib/rs3.js";
import "gun/lib/radisk.js";
import "gun/lib/axe.js";
import "gun/lib/wire.js";
import "gun/lib/yson.js";

import multer from "multer";

// Importa i contratti dal pacchetto shogun-contracts
import { DEPLOYMENTS } from "shogun-contracts/deployments.js";

const namespace = "shogun";

const CLEANUP_CORRUPTED_DATA = process.env.CLEANUP_CORRUPTED_DATA || true;

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

  // System logging function (console only, no GunDB storage)
  function addSystemLog(level, message, data = null) {
    const timestamp = new Date().toISOString();

    // Log to console only (file logs are managed by the system)
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);

    // Optionally log data if provided and not null
    if (data !== null && data !== undefined) {
      try {
        console.log(
          `[${timestamp}] ${level.toUpperCase()}: Data:`,
          JSON.stringify(data, null, 2)
        );
      } catch (jsonError) {
        console.log(
          `[${timestamp}] ${level.toUpperCase()}: Data (non-serializable):`,
          String(data)
        );
      }
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
      // Validate and sanitize input data
      const sanitizedSoul =
        typeof soul === "string" ? soul.trim() : String(soul || "");
      const sanitizedKey =
        typeof key === "string" ? key.trim() : String(key || "");

      if (!sanitizedSoul || !sanitizedKey) {
        console.warn("⚠️ Invalid soul or key, skipping event propagation");
        console.log("Soul:", sanitizedSoul, "Key:", sanitizedKey);
        return;
      }

      // Crea un identificatore univoco per questo evento
      const eventId = `${event.transactionHash}-${event.logIndex || 0}`;
      console.log("📋 Event ID:", eventId);

      // Memorizza i dati dell'evento in GunDB
      console.log("💾 Storing event data in GunDB...");
      const eventNode = gun.get("shogun").get("chain_events").get(eventId);

      // Create a clean event data object with only serializable properties
      const eventData = {
        soul: sanitizedSoul,
        key: sanitizedKey,
        value: sanitizeForGunDB(value),
        blockNumber: sanitizeForGunDB(event.blockNumber),
        transactionHash: sanitizeForGunDB(event.transactionHash),
        timestamp: Date.now(),
        propagated: true,
      };

      // Validate the event data before storing
      try {
        JSON.stringify(eventData);
      } catch (jsonError) {
        console.error("❌ Event data is not JSON serializable:", jsonError);
        console.log("❌ Event data:", eventData);
        return;
      }

      await new Promise((resolve, reject) => {
        eventNode.put(eventData, (ack) => {
          if (ack.err) {
            console.error("❌ Error storing event data:", ack.err);
            reject(ack.err);
          } else {
            console.log("✅ Event data stored successfully");
            resolve();
          }
        });
      });

      // Memorizza anche i dati nella struttura principale di GunDB usando dati leggibili
      console.log("💾 Storing data in main GunDB structure...");

      // Attiva il flag per permettere scritture interne del relay
      allowInternalOperations = true;
      console.log("🔓 Enabled internal operations for relay self-write");

      try {
        // Scomponi il soul path per creare la struttura GunDB corretta
        console.log("🔧 Decomposing soul path:", sanitizedSoul);
        const soulParts = sanitizedSoul
          .split("/")
          .filter((part) => part.length > 0);
        console.log("🔧 Soul parts:", soulParts);

        if (soulParts.length === 0) {
          console.warn("⚠️ Empty soul path, skipping main structure storage");
          return;
        }

        // Crea la struttura GunDB corretta
        let dataNode = gun;
        for (let i = 0; i < soulParts.length; i++) {
          const part = soulParts[i];
          console.log(
            `🔧 Creating GunDB node for part ${i + 1}/${
              soulParts.length
            }: "${part}"`
          );
          dataNode = dataNode.get(part);
        }

        // Ora scrivi il valore con la chiave specificata
        const sanitizedValue = sanitizeForGunDB(value);

        // Validate the value before storing
        try {
          JSON.stringify(sanitizedValue);
        } catch (jsonError) {
          console.error("❌ Value is not JSON serializable:", jsonError);
          console.log("❌ Value:", sanitizedValue);
          return;
        }

        console.log(
          `🔧 Writing value "${sanitizedValue}" with key "${sanitizedKey}" to GunDB structure`
        );

        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            console.warn("⚠️ Timeout writing to main GunDB structure");
            reject(new Error("Timeout"));
          }, 5000);

          dataNode.get(sanitizedKey).put(sanitizedValue, (ack) => {
            clearTimeout(timeoutId);
            if (ack.err) {
              console.error(
                "❌ Error storing data in main structure:",
                ack.err
              );
              reject(ack.err);
            } else {
              console.log("✅ Data stored in main structure successfully");
              console.log(
                `✅ GunDB path created: ${soulParts.join(
                  "."
                )}.${sanitizedKey} = "${sanitizedValue}"`
              );
              resolve();
            }
          });
        });

        console.log(
          `✅ Chain event propagated to GunDB: ${sanitizedSoul} -> ${sanitizedKey} = ${sanitizedValue}`
        );

        // Log success (console only)
        console.log(
          `✅ Chain event propagated to GunDB: ${sanitizedSoul} -> ${sanitizedKey} = ${sanitizedValue}`
        );
      } catch (mainStructureError) {
        console.error(
          "❌ Error writing to main GunDB structure:",
          mainStructureError
        );
        // Non fallire completamente se la scrittura nella struttura principale fallisce
        // L'evento è già stato salvato nella sezione chain_events

        // Log warning (console only)
        console.log(
          `⚠️ Chain event partially propagated (main structure failed): ${mainStructureError.message}`
        );
      } finally {
        // Ripristina il flag di sicurezza
        allowInternalOperations = false;
        console.log("🔒 Disabled internal operations flag");
      }
    } catch (error) {
      console.error("❌ Failed to propagate chain event to GunDB:", error);
      console.log(`❌ Failed to propagate chain event: ${error.message}`);
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

            // Log polling start (console only)
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
                    value: event.args.value,
                    soulReadable: event.args.soulReadable,
                    keyReadable: event.args.keyReadable,
                    blockNumber: event.blockNumber,
                    transactionHash: event.transactionHash,
                    logIndex: event.logIndex,
                  }
                );

                // Log dettagliato della struttura degli oggetti
                console.log("🔍 SoulReadable structure:", {
                  type: typeof event.args.soulReadable,
                  isObject: typeof event.args.soulReadable === "object",
                  hasHash:
                    event.args.soulReadable &&
                    typeof event.args.soulReadable === "object" &&
                    "hash" in event.args.soulReadable,
                  hash:
                    event.args.soulReadable &&
                    typeof event.args.soulReadable === "object"
                      ? event.args.soulReadable.hash
                      : "N/A",
                });

                console.log("🔍 KeyReadable structure:", {
                  type: typeof event.args.keyReadable,
                  isObject: typeof event.args.keyReadable === "object",
                  hasHash:
                    event.args.keyReadable &&
                    typeof event.args.keyReadable === "object" &&
                    "hash" in event.args.keyReadable,
                  hash:
                    event.args.keyReadable &&
                    typeof event.args.keyReadable === "object"
                      ? event.args.keyReadable.hash
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

                // Decode soulReadable and keyReadable from bytes to string
                let soulString, keyString;
                try {
                  console.log("🔍 Raw event args:", {
                    value: event.args.value,
                    soulReadable: event.args.soulReadable,
                    keyReadable: event.args.keyReadable,
                    soulReadableType: typeof event.args.soulReadable,
                    keyReadableType: typeof event.args.keyReadable,
                  });

                  // Gestisci sia eventi indexed che non-indexed
                  let soulBytes, keyBytes;

                  // Controlla se sono oggetti Indexed (vecchio contratto)
                  if (
                    event.args.soulReadable &&
                    typeof event.args.soulReadable === "object" &&
                    event.args.soulReadable._isIndexed
                  ) {
                    console.log("🔍 Detected indexed soulReadable, using hash");
                    soulBytes = event.args.soulReadable.hash;
                  } else if (
                    event.args.soulReadable &&
                    typeof event.args.soulReadable === "object"
                  ) {
                    // Oggetto Result di Ethers.js (nuovo contratto)
                    soulBytes =
                      event.args.soulReadable.bytes ||
                      event.args.soulReadable.data ||
                      event.args.soulReadable;
                  } else {
                    soulBytes = event.args.soulReadable;
                  }

                  if (
                    event.args.keyReadable &&
                    typeof event.args.keyReadable === "object" &&
                    event.args.keyReadable._isIndexed
                  ) {
                    console.log("🔍 Detected indexed keyReadable, using hash");
                    keyBytes = event.args.keyReadable.hash;
                  } else if (
                    event.args.keyReadable &&
                    typeof event.args.keyReadable === "object"
                  ) {
                    // Oggetto Result di Ethers.js (nuovo contratto)
                    keyBytes =
                      event.args.keyReadable.bytes ||
                      event.args.keyReadable.data ||
                      event.args.keyReadable;
                  } else {
                    keyBytes = event.args.keyReadable;
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
                      "⚠️ SoulReadable is keccak256 hash, cannot decode to original string"
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
                      "⚠️ KeyReadable is keccak256 hash, cannot decode to original string"
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
                    "⚠️ Could not decode soulReadable/keyReadable as UTF-8, using fallback"
                  );
                  console.log("Decode error:", error.message);

                  // Se la decodifica fallisce, usa i valori originali
                  soulString = String(event.args.soulReadable || "");
                  keyString = String(event.args.keyReadable || "");

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

  // Funzione per i dati di serie temporale (console only)
  function addTimeSeriesPoint(key, value) {
    // Log to console only to prevent JSON serialization errors
    console.log(`📊 TimeSeries: ${key} = ${value}`);
  }

  // Funzione di raccolta spazzatura
  function runGarbageCollector() {
    if (!GC_ENABLED) {
      console.log("🗑️ Garbage Collector is disabled.");
      return;
    }
    console.log("🗑️ Running Garbage Collector...");
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
    } else {
      console.log(
        "🗑️ Garbage Collector finished. No unprotected nodes found to clean."
      );
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
      console.log("✅ Garbage collector initialized");
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
        firstSoul.startsWith("shogun/usernames") || // Mapping usernames per autenticazione (username -> userPub)
        !firstSoul.includes("/") || // Chiavi a livello singolo (operazioni interne di Gun)
        firstSoul.match(
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
        ) || // UUID souls
        // NUOVA REGOLA: Permetti path che contengono / ma non iniziano con shogun/ (dati del contratto Chain)
        (firstSoul.includes("/") && !firstSoul.startsWith("shogun/")));

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

  // Fix per rate limiting con proxy
  app.set("trust proxy", 1);

  // Route specifica per /admin (DEFINITA PRIMA DEL MIDDLEWARE DI AUTENTICAZIONE)
  app.get("/admin", (req, res) => {
    const adminPath = path.resolve(publicPath, "admin.html");
    if (fs.existsSync(adminPath)) {
      // Aggiungi header per prevenire il caching
      res.set({
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.sendFile(adminPath);
    } else {
      res.status(404).json({
        success: false,
        error: "Admin panel not found",
        message: "Admin panel file not available",
      });
    }
  });

  // Route specifica per /oauth-callback (DEFINITA PRIMA DEL MIDDLEWARE DI AUTENTICAZIONE)
  app.get("/oauth-callback", (req, res) => {
    const callbackPath = path.resolve(publicPath, "oauth-callback.html");
    if (fs.existsSync(callbackPath)) {
      // Aggiungi header per prevenire il caching
      res.set({
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.sendFile(callbackPath);
    } else {
      res.status(404).json({
        success: false,
        error: "OAuth callback page not found",
        message: "OAuth callback page not available",
      });
    }
  });

  // Middleware di protezione per le route statiche che richiedono autenticazione admin
  const protectedStaticRoutes = [
    "/services-dashboard",
    "/stats",
    "/charts",
    "/upload",
    "/pin-manager",
    "/create",
    "/notes",
  ];

  app.use((req, res, next) => {
    const path = req.path;

    // Controlla se la route richiede autenticazione admin
    if (protectedStaticRoutes.includes(path)) {
      // Verifica autenticazione admin
      const authHeader = req.headers["authorization"];
      const bearerToken = authHeader && authHeader.split(" ")[1];
      const customToken = req.headers["token"];
      const formToken = req.query["_auth_token"]; // Token inviato tramite form
      const token = bearerToken || customToken || formToken;

      if (token === process.env.ADMIN_PASSWORD) {
        next();
      } else {
        console.log(
          `❌ Accesso negato a ${path} - Token mancante o non valido`
        );
        return res.status(401).json({
          success: false,
          error: "Unauthorized - Admin authentication required",
          message:
            "Questa pagina richiede autenticazione admin. Inserisci la password admin nella pagina principale.",
        });
      }
    } else {
      // Route pubblica, continua
      next();
    }
  });

  app.use(Gun.serve);

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
  /**
   * Verifica una firma EOA (EIP-191 personal_sign) recuperando l'indirizzo dal messaggio firmato
   * e confrontandolo con l'indirizzo atteso.
   * Supporta messaggi stringa e payload hex (0x...) come bytes.
   */
  function verifyWalletSignature(message, signature, expectedAddress) {
    try {
      // Validazioni di base
      if (!expectedAddress || !ethers.isAddress(expectedAddress)) {
        return false;
      }
      if (!signature || typeof signature !== "string") {
        return false;
      }
      if (message === undefined || message === null) {
        return false;
      }

      const normalizedExpected = ethers.getAddress(expectedAddress);

      // Recupera l'indirizzo dalla firma
      let recoveredAddress = null;
      try {
        recoveredAddress = ethers.verifyMessage(message, signature);
      } catch (primaryError) {
        // Fallback: se il messaggio è in hex, prova come bytes
        if (typeof message === "string" && message.startsWith("0x")) {
          try {
            recoveredAddress = ethers.verifyMessage(
              ethers.getBytes(message),
              signature
            );
          } catch (bytesError) {
            return false;
          }
        } else {
          return false;
        }
      }

      if (!recoveredAddress || !ethers.isAddress(recoveredAddress)) {
        return false;
      }

      const isMatch =
        ethers.getAddress(recoveredAddress) === normalizedExpected;
      if (!isMatch) {
        console.warn("❌ Wallet signature mismatch", {
          expected: normalizedExpected,
          recovered: ethers.getAddress(recoveredAddress),
        });
      } else {
        console.log(
          `🔐 Verified signature. Recovered: ${ethers.getAddress(
            recoveredAddress
          )}`
        );
      }

      return isMatch;
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
    radisk: process.env.DISABLE_RADISK !== "true", // Allow disabling radisk via env var
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
    // Add better error handling for radisk
    chunk: 1000, // Smaller chunks to reduce memory usage
    pack: 1000, // Smaller pack size
    // Add JSON error handling
    jsonify: false, // Disable automatic JSON parsing to prevent errors
  };

  if (process.env.DISABLE_RADISK === "true") {
    console.log("📁 Radisk disabled via environment variable");
  } else {
    console.log("📁 Using local file storage with radisk");
  }

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

  // Inizializza Shogun Core per l'autenticazione
  let shogunCore = null;
  try {
    console.log("🔐 Initializing Shogun Core for authentication...");
    console.log("🔐 ShogunCore constructor available:", typeof ShogunCore);
    console.log(
      "🔐 ShogunCore import check:",
      ShogunCore ? "SUCCESS" : "FAILED"
    );

    if (typeof ShogunCore !== "function") {
      throw new Error(
        `ShogunCore is not a constructor. Type: ${typeof ShogunCore}`
      );
    }

    const peers = process.env.RELAY_PEERS
      ? process.env.RELAY_PEERS.split(",")
      : [
          "wss://ruling-mastodon-improved.ngrok-free.app/gun",
          "https://gun-manhattan.herokuapp.com/gun",
          "https://peer.wallie.io/gun",
        ];

    console.log("🔐 Peers for Shogun Core:", peers);

    // Debug: mostra la configurazione
    const shogunConfig = {
      gunInstance: gun,
      authToken: process.env.ADMIN_PASSWORD,
      peers: peers,
      scope: "shogun",
      web3: { enabled: true },
      webauthn: {
        enabled: false,
      },
      nostr: { enabled: true },
      oauth: {
        enabled: true,
        usePKCE: true, // PKCE obbligatorio per sicurezza
        allowUnsafeClientSecret: true, // Abilitato per Google OAuth
        stateTimeout: 10 * 60 * 1000, // 10 minuti timeout
        providers: {
          google: {
            enabled: true,
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            redirectUri:
              process.env.GOOGLE_REDIRECT_URI ||
              `http://${host}:${port}/api/v1/auth/oauth/callback`,
            scope: ["openid", "email", "profile"],
            authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
            tokenUrl: "https://oauth2.googleapis.com/token",
            userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
            usePKCE: true, // PKCE obbligatorio per sicurezza
          },
        },
      },
      timeouts: {
        login: 30000,
        signup: 30000,
        operation: 60000,
      },
    };

    console.log(
      "🔐 Shogun Core configuration:",
      JSON.stringify(shogunConfig, null, 2)
    );

    // Usa l'import già fatto all'inizio del file
    shogunCore = new ShogunCore(shogunConfig);

    console.log("🔐 Shogun Core instance created, initializing...");

    try {
      await shogunCore.initialize();
      console.log("🔐 Shogun Core initialization completed");
    } catch (initError) {
      console.error("❌ Error during Shogun Core initialization:", initError);
      console.error("❌ Init error stack:", initError.stack);
    }

    // Debug: controlla i plugin dopo l'inizializzazione
    console.log("🔐 Checking plugins after initialization:");
    console.log("🔐 - web3:", !!shogunCore.getPlugin("web3"));
    console.log("🔐 - webauthn:", !!shogunCore.getPlugin("webauthn"));
    console.log("🔐 - nostr:", !!shogunCore.getPlugin("nostr"));
    console.log("🔐 - oauth:", !!shogunCore.getPlugin("oauth"));

    // Debug: controlla tutti i plugin registrati
    console.log("🔐 All registered plugins after initialization:");
    if (shogunCore.plugins) {
      for (const [name, plugin] of shogunCore.plugins) {
        console.log(`🔐   - ${name}:`, typeof plugin);
      }
    } else {
      console.log("🔐 No plugins map found");
    }

    app.set("shogunCore", shogunCore);
    console.log("✅ Shogun Core initialized successfully");
  } catch (error) {
    console.error("❌ Failed to initialize Shogun Core:", error);
    console.error("❌ Error details:", error.stack);
    console.error("❌ Error name:", error.name);
    console.error("❌ Error message:", error.message);
    // Non bloccare l'avvio del server se Shogun Core fallisce
  }

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

          const hashKeys = Object.keys(parentData).filter((key) => key !== "_");
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
            console.error(
              "Error updating background recalculated MB usage:",
              ack.err
            );
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

  // Function to clean up corrupted GunDB data
  function cleanupCorruptedData() {
    console.log("🧹 Starting GunDB data cleanup...");

    try {
      // Clean up any corrupted chain events
      gun
        .get("shogun")
        .get("chain_events")
        .map()
        .once((data, key) => {
          if (data && typeof data === "object") {
            try {
              // Test if the data is valid JSON
              JSON.stringify(data);
            } catch (error) {
              console.log(`🧹 Removing corrupted chain event: ${key}`);
              gun.get("shogun").get("chain_events").get(key).put(null);
            }
          }
        });

      // Clean up any corrupted logs
      gun
        .get("shogun")
        .get("logs")
        .map()
        .once((data, key) => {
          if (data && typeof data === "object") {
            try {
              // Test if the data is valid JSON
              JSON.stringify(data);
            } catch (error) {
              console.log(`🧹 Removing corrupted log entry: ${key}`);
              gun.get("shogun").get("logs").get(key).put(null);
            }
          }
        });

      console.log("✅ GunDB data cleanup completed");
    } catch (error) {
      console.error("❌ Error during GunDB data cleanup:", error);
    }
  }

  // Run cleanup on startup if enabled
  if (CLEANUP_CORRUPTED_DATA) {
    console.log("🧹 Cleanup of corrupted data enabled");
    setTimeout(cleanupCorruptedData, 5000); // Run after 5 seconds to allow GunDB to initialize
  }

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
