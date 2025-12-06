/**
 * Deal Synchronization Service
 * 
 * Syncs active on-chain deals with IPFS pins.
 * Ensures all active deals have their files pinned on this relay.
 */

import http from 'http';

const IPFS_API_URL = process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN;

// Global flag to indicate shutdown is in progress
let isShuttingDown = false;

// Track CIDs that recently failed pinning to avoid immediate retries
// Map of CID -> { lastAttempt: timestamp, consecutiveFailures: number }
const pinFailureCache = new Map();
const PIN_RETRY_DELAY_MS = 5 * 60 * 1000; // Wait 5 minutes before retrying a failed CID
const MAX_CONSECUTIVE_FAILURES = 10; // After 10 failures, only retry once per hour

/**
 * Mark that shutdown is in progress (call this when SIGTERM/SIGINT received)
 */
export function markShutdownInProgress() {
  isShuttingDown = true;
}

/**
 * Check if shutdown is in progress
 */
export function isShutdownInProgress() {
  return isShuttingDown;
}

/**
 * Check if a CID is pinned in IPFS
 * @param {string} cid - IPFS CID to check
 * @returns {Promise<boolean>}
 */
async function isPinned(cid) {
  try {
    const gatewayUrl = new URL(IPFS_API_URL);
    const protocolModule = gatewayUrl.protocol === 'https:'
      ? await import('https')
      : await import('http');

    const requestOptions = {
      hostname: gatewayUrl.hostname,
      port: gatewayUrl.port ? Number(gatewayUrl.port) : (gatewayUrl.protocol === 'https:' ? 443 : 80),
      path: `/api/v0/pin/ls?arg=${encodeURIComponent(cid)}&type=all`,
      method: 'GET',
      headers: {},
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
    }

    return new Promise((resolve) => {
      const req = protocolModule.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            // Check if CID is in the Keys object
            if (result && result.Keys && result.Keys[cid]) {
              resolve(true);
            } else {
              // Try listing all pins and checking if CID is in the list
              resolve(false);
            }
          } catch (e) {
            // If parsing fails, try listing all pins
            resolve(false);
          }
        });
      });

      req.on('error', () => resolve(false));
      req.setTimeout(5000, () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  } catch (error) {
    console.warn(`⚠️ Error checking pin status for ${cid}:`, error.message);
    return false;
  }
}

/**
 * Pin a CID to IPFS with retry logic
 * @param {string} cid - IPFS CID to pin
 * @param {number} maxRetries - Maximum number of retry attempts (default: 2)
 * @returns {Promise<{success: boolean, error?: string, pending?: boolean}>}
 */
async function pinCid(cid, maxRetries = 2) {
  // Check if shutdown is in progress - abort immediately if so
  if (isShuttingDown) {
    return { success: false, error: 'Pin aborted due to shutdown', pending: true };
  }

  const PIN_TIMEOUT = parseInt(process.env.IPFS_PIN_TIMEOUT_MS) || 120000; // Default: 120 seconds (2 minutes)
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check shutdown status before each attempt
    if (isShuttingDown) {
      return { success: false, error: 'Pin aborted due to shutdown', pending: true };
    }
    try {
      const gatewayUrl = new URL(IPFS_API_URL);
      const protocolModule = gatewayUrl.protocol === 'https:'
        ? await import('https')
        : await import('http');

      const requestOptions = {
        hostname: gatewayUrl.hostname,
        port: gatewayUrl.port ? Number(gatewayUrl.port) : (gatewayUrl.protocol === 'https:' ? 443 : 80),
        path: `/api/v0/pin/add?arg=${encodeURIComponent(cid)}&progress=false`,
        method: 'POST',
        headers: {
          'Content-Length': '0',
        },
      };

      if (IPFS_API_TOKEN) {
        requestOptions.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const result = await new Promise((resolve) => {
        const req = protocolModule.request(requestOptions, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const parsed = JSON.parse(data);
                console.log(`✅ CID ${cid} pinned successfully${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`);
                resolve({ success: true, result: parsed });
              } catch (e) {
                console.log(`✅ CID ${cid} pinned (response: ${data})${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`);
                resolve({ success: true });
              }
            } else {
              // Check if already pinned
              if (data.includes('already pinned') || data.includes('is already pinned')) {
                console.log(`ℹ️ CID ${cid} was already pinned${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`);
                resolve({ success: true, alreadyPinned: true });
              } else {
                // Check if error is due to shutdown (promise channel closed during shutdown)
                // Also check if shutdown is in progress when we receive the response
                const isShutdownError = isShuttingDown || (
                  data.includes('promise channel was closed') || 
                  data.includes('channel was closed')
                );
                
                const error = `IPFS pin add failed with status ${res.statusCode}: ${data.substring(0, 200)}`;
                resolve({ 
                  success: false, 
                  error, 
                  retryable: res.statusCode >= 500 && !isShutdownError,
                  shutdownError: isShutdownError
                });
              }
            }
          });
        });

        req.on('error', (err) => {
          // Check if error is due to shutdown
          const isShutdownError = isShuttingDown && (
            err.message.includes('ECONNRESET') ||
            err.message.includes('ECONNREFUSED') ||
            err.message.includes('socket hang up')
          );
          
          const error = `IPFS pin add error: ${err.message}`;
          resolve({ 
            success: false, 
            error, 
            retryable: !isShutdownError,
            shutdownError: isShutdownError
          });
        });

        req.setTimeout(PIN_TIMEOUT, () => {
          req.destroy();
          // Timeout doesn't necessarily mean failure - pin might continue in background
          const error = `IPFS pin add timeout after ${PIN_TIMEOUT / 1000}s (CID may still be pinning in background)`;
          console.warn(`⚠️ ${error}${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`);
          resolve({ success: false, error, pending: true, retryable: attempt < maxRetries });
        });

        req.end();
      });

      // If successful, return immediately
      if (result.success) {
        return result;
      }

      // If pending (timeout but might still be processing), check if we should retry
      if (result.pending && attempt < maxRetries && !isShuttingDown) {
        const retryDelay = Math.min(5000 * Math.pow(2, attempt), 30000); // Exponential backoff: 5s, 10s, 20s, max 30s
        console.log(`⏳ CID ${cid} pin may still be processing. Retrying in ${retryDelay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        // Check again after delay in case shutdown started during wait
        if (isShuttingDown) {
          return { success: false, error: 'Pin aborted due to shutdown', pending: true, shutdownError: true };
        }
        continue;
      }

      // If retryable error and we have retries left
      if (result.retryable && attempt < maxRetries && !isShuttingDown) {
        const retryDelay = Math.min(2000 * Math.pow(2, attempt), 10000); // Exponential backoff: 2s, 4s, 8s, max 10s
        console.log(`🔄 Retrying pin for CID ${cid} in ${retryDelay / 1000}s (attempt ${attempt + 2}/${maxRetries + 1})...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        // Check again after delay in case shutdown started during wait
        if (isShuttingDown) {
          return { success: false, error: 'Pin aborted due to shutdown', pending: true, shutdownError: true };
        }
        continue;
      }

      // Final failure
      if (!result.success) {
        // Only log as warning if not a shutdown error and shutdown is not in progress
        if (!result.shutdownError && !isShuttingDown) {
          console.warn(`⚠️ CID ${cid}: ${result.error}`);
        }
        // If shutdown is in progress, mark it as shutdown error even if not already marked
        if (isShuttingDown && !result.shutdownError) {
          result.shutdownError = true;
        }
        return result;
      }

    } catch (error) {
      // Check if shutdown happened during error handling
      if (isShuttingDown) {
        return { success: false, error: 'Pin aborted due to shutdown', pending: true, shutdownError: true };
      }
      
      if (attempt < maxRetries && !isShuttingDown) {
        const retryDelay = Math.min(2000 * Math.pow(2, attempt), 10000);
        console.warn(`⚠️ Error pinning CID ${cid} (attempt ${attempt + 1}): ${error.message}. Retrying in ${retryDelay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        // Check again after delay
        if (isShuttingDown) {
          return { success: false, error: 'Pin aborted due to shutdown', pending: true, shutdownError: true };
        }
        continue;
      }
      const errorMsg = `Error pinning CID ${cid}: ${error.message}`;
      if (!isShuttingDown) {
        console.error(`❌ ${errorMsg}`);
      }
      return { success: false, error: errorMsg, shutdownError: isShuttingDown };
    }
  }

  // Should never reach here, but just in case
  return { success: false, error: 'Pin failed after all retries' };
}

/**
 * Convert on-chain deal to GunDB deal format
 * @param {object} onChainDeal - Deal from on-chain registry
 * @param {string} relayPub - GunDB pub key of this relay
 * @returns {object} - Deal in GunDB format
 */
async function convertOnChainDealToGunDB(onChainDeal, relayPub) {
  const { ethers } = await import('ethers');
  
  // Use on-chain dealId as the GunDB deal ID (convert bytes32 to hex string)
  const dealId = onChainDeal.dealId.startsWith('0x') 
    ? onChainDeal.dealId 
    : `0x${onChainDeal.dealId}`;
  
  // Calculate duration from createdAt and expiresAt
  const createdAt = new Date(onChainDeal.createdAt).getTime();
  const expiresAt = new Date(onChainDeal.expiresAt).getTime();
  const durationMs = expiresAt - createdAt;
  const durationDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24));
  
  // Determine tier based on size (simple heuristic)
  let tier = 'standard';
  if (onChainDeal.sizeMB >= 1000) {
    tier = 'enterprise';
  } else if (onChainDeal.sizeMB >= 100) {
    tier = 'premium';
  }
  
  // Create pricing object (simplified)
  const pricing = {
    tier,
    sizeMB: onChainDeal.sizeMB,
    durationDays,
    months: durationDays / 30,
    pricePerMBMonth: parseFloat(onChainDeal.priceUSDC) / (onChainDeal.sizeMB * (durationDays / 30)),
    basePrice: parseFloat(onChainDeal.priceUSDC),
    storageOverheadPercent: 0,
    replicationFactor: 1,
    totalPriceUSDC: parseFloat(onChainDeal.priceUSDC),
    features: {
      erasureCoding: false,
      slaGuarantee: false,
    },
  };
  
  return {
    id: dealId,
    version: 1,
    // Parties
    cid: onChainDeal.cid,
    clientAddress: onChainDeal.client.toLowerCase(),
    providerPub: relayPub,
    // Terms
    tier,
    sizeMB: onChainDeal.sizeMB,
    durationDays,
    pricing,
    // Dates
    createdAt,
    activatedAt: createdAt, // Assume activated when created on-chain
    expiresAt,
    // Payment
    paymentRequired: parseFloat(onChainDeal.priceUSDC),
    paymentTx: null, // On-chain deals don't have a single payment TX
    paymentVerified: true, // On-chain deals are verified by contract
    // Storage
    erasureCoding: false,
    erasureMetadata: null,
    replicationFactor: 1,
    replicas: {},
    replicaCount: 0,
    // Status
    status: onChainDeal.active ? 'active' : 'expired',
    // On-chain metadata
    onChainDealId: dealId,
    onChainRelay: onChainDeal.relay.toLowerCase(),
    clientStake: onChainDeal.clientStake || '0',
    syncedFromOnChain: true,
    syncedAt: Date.now(),
  };
}

/**
 * Sync active deals from on-chain registry with IPFS pins and GunDB
 * @param {string} relayAddress - Address of this relay
 * @param {number} chainId - Chain ID for the registry
 * @param {object} options - Sync options
 * @param {boolean} options.onlyActive - Only sync active deals (default: true)
 * @param {boolean} options.dryRun - Don't actually pin/save, just report (default: false)
 * @param {Gun} gun - GunDB instance (optional, for GunDB sync)
 * @param {object} relayKeyPair - Relay SEA keypair (optional, for GunDB sync)
 * @returns {Promise<{synced: number, alreadyPinned: number, failed: number, gunDBSynced: number, errors: Array}>}
 */
export async function syncDealsWithIPFS(relayAddress, chainId, options = {}) {
  const { onlyActive = true, dryRun = false, gun = null, relayKeyPair = null } = options;
  
  console.log(`🔄 Starting deal sync for relay ${relayAddress} on chain ${chainId}...`);
  console.log(`   Options: onlyActive=${onlyActive}, dryRun=${dryRun}, gunDB=${gun ? 'enabled' : 'disabled'}`);

  try {
    // Import registry client
    const { createStorageDealRegistryClient } = await import('./registry-client.js');
    const storageDealRegistryClient = createStorageDealRegistryClient(chainId);

    // Fetch all deals for this relay
    const deals = await storageDealRegistryClient.getRelayDeals(relayAddress);
    console.log(`📋 Found ${deals.length} deals on-chain for relay ${relayAddress}`);

    // Filter active deals if requested
    const dealsToSync = onlyActive
      ? deals.filter(deal => deal.active && new Date(deal.expiresAt) > new Date())
      : deals;

    console.log(`📌 Syncing ${dealsToSync.length} ${onlyActive ? 'active' : ''} deals...`);

    const results = {
      synced: 0,
      alreadyPinned: 0,
      failed: 0,
      gunDBSynced: 0,
      gunDBFailed: 0,
      errors: [],
    };
    
    // Get relay pub key if GunDB sync is enabled
    let relayPub = null;
    if (gun && relayKeyPair) {
      relayPub = relayKeyPair.pub;
    }

    // Process each deal
    for (const deal of dealsToSync) {
      // Check if shutdown started during processing
      if (isShuttingDown) {
        console.log(`⏭️ Deal sync interrupted (shutdown in progress)`);
        break;
      }

      const { cid, dealId } = deal;
      
      if (!cid) {
        console.warn(`⚠️ Deal ${dealId} has no CID, skipping`);
        continue;
      }

      try {
        // Check if already pinned
        const pinned = await isPinned(cid);
        
        if (pinned) {
          console.log(`✅ Deal ${dealId}: CID ${cid} already pinned`);
          results.alreadyPinned++;
          continue;
        }

        // Pin the CID if not in dry run mode
        if (dryRun) {
          console.log(`🔍 [DRY RUN] Would pin CID ${cid} for deal ${dealId}`);
          results.synced++;
        } else {
          // Try to pin the CID (IPFS will attempt to fetch it from the network)
          // Note: Even if the CID is not immediately available, IPFS will continue trying in background
          // The pin request itself will succeed once IPFS retrieves the content
          console.log(`📌 Attempting to pin CID ${cid} for deal ${dealId}...`);
          const pinResult = await pinCid(cid);
          if (pinResult.success) {
            console.log(`✅ Deal ${dealId}: CID ${cid} pinned successfully`);
            // Clear from failure cache on success
            pinFailureCache.delete(cid);
            results.synced++;
          } else {
              // Check if error is due to shutdown
              if (pinResult.shutdownError || isShuttingDown) {
                // Don't log as error during shutdown - just skip silently or with minimal info
                if (!isShuttingDown) {
                  // Only log if shutdown wasn't in progress (might be a different shutdown-related error)
                  console.log(`ℹ️ Deal ${dealId}: Pin aborted due to shutdown`);
                }
                continue;
              }
              
              // If pending, the pin might still be processing in background
              if (pinResult.pending) {
                console.warn(`⚠️ Deal ${dealId}: CID ${cid} pin timed out but may still be processing in background. Will retry later.`);
                // Track failure for rate limiting, but don't count as hard failure
                const existingFailure = pinFailureCache.get(cid) || { consecutiveFailures: 0 };
                pinFailureCache.set(cid, {
                  lastAttempt: Date.now(),
                  consecutiveFailures: existingFailure.consecutiveFailures + 1,
                });
                // Don't count as failed - it might succeed later, but track it
                results.errors.push({
                  dealId,
                  cid,
                  error: pinResult.error,
                  pending: true,
                });
              } else {
                // Only log and track as failed if not a shutdown error
                if (!pinResult.shutdownError && !isShuttingDown) {
                  console.warn(`⚠️ Deal ${dealId}: Failed to pin CID ${cid}: ${pinResult.error}`);
                  results.failed++;
                  results.errors.push({
                    dealId,
                    cid,
                    error: pinResult.error,
                  });
                }
                // If shutdown error, silently skip (already handled above)
              }
            }
        }
        
        // Sync to GunDB if enabled (skip if shutdown in progress)
        if (gun && relayKeyPair && relayPub && !dryRun && !isShuttingDown) {
          try {
            const { getDeal } = await import('./storage-deals.js');
            const { saveDeal } = await import('./storage-deals.js');
            
            // Check if deal already exists in GunDB
            const existingDeal = await getDeal(gun, dealId);
            
            // Convert on-chain deal to GunDB format
            const gunDBDeal = await convertOnChainDealToGunDB(deal, relayPub);
            
            // Only save if it doesn't exist or if it's different
            if (!existingDeal || existingDeal.syncedFromOnChain !== true) {
              await saveDeal(gun, gunDBDeal, relayKeyPair);
              console.log(`✅ Deal ${dealId}: Synced to GunDB`);
              results.gunDBSynced++;
            } else {
              console.log(`ℹ️ Deal ${dealId}: Already exists in GunDB`);
            }
          } catch (gunDBError) {
            // Ignore errors if shutdown is in progress (database may be closed)
            if (isShuttingDown) {
              console.log(`⏭️ GunDB sync skipped for deal ${dealId} (shutdown in progress)`);
              break;
            }
            console.warn(`⚠️ Deal ${dealId}: Failed to sync to GunDB: ${gunDBError.message}`);
            results.gunDBFailed++;
            results.errors.push({
              dealId,
              cid: deal.cid,
              error: `GunDB sync failed: ${gunDBError.message}`,
            });
          }
        }

        // Small delay to avoid overwhelming IPFS/GunDB
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Error processing deal ${dealId}:`, error.message);
        results.failed++;
        results.errors.push({
          dealId,
          cid: deal.cid,
          error: error.message,
        });
      }
    }

    console.log(`✅ Deal sync completed:`);
    console.log(`   - IPFS pinned: ${results.synced}`);
    console.log(`   - Already pinned: ${results.alreadyPinned}`);
    console.log(`   - IPFS failed: ${results.failed}`);
    if (gun && relayKeyPair) {
      console.log(`   - GunDB synced: ${results.gunDBSynced}`);
      console.log(`   - GunDB failed: ${results.gunDBFailed}`);
    }

    return results;
  } catch (error) {
    console.error(`❌ Deal sync error:`, error);
    throw error;
  }
}

/**
 * Get sync status for all active deals
 * @param {string} relayAddress - Address of this relay
 * @param {number} chainId - Chain ID for the registry
 * @returns {Promise<Array>} Array of deals with pin status
 */
export async function getDealSyncStatus(relayAddress, chainId) {
  try {
    const { createStorageDealRegistryClient } = await import('./registry-client.js');
    const storageDealRegistryClient = createStorageDealRegistryClient(chainId);

    const deals = await storageDealRegistryClient.getRelayDeals(relayAddress);
    const activeDeals = deals.filter(deal => deal.active && new Date(deal.expiresAt) > new Date());

    const status = [];
    for (const deal of activeDeals) {
      const pinned = deal.cid ? await isPinned(deal.cid) : false;
      status.push({
        dealId: deal.dealId,
        cid: deal.cid,
        active: deal.active,
        expiresAt: deal.expiresAt,
        pinned,
        needsSync: !pinned && deal.cid,
      });
    }

    return status;
  } catch (error) {
    console.error(`❌ Error getting deal sync status:`, error);
    throw error;
  }
}

