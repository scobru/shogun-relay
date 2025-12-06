/**
 * Deal Synchronization Service
 * 
 * Syncs active on-chain deals with IPFS pins.
 * Ensures all active deals have their files pinned on this relay.
 */

import http from 'http';

const IPFS_API_URL = process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN;

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
 * Pin a CID to IPFS
 * @param {string} cid - IPFS CID to pin
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function pinCid(cid) {
  try {
    const gatewayUrl = new URL(IPFS_API_URL);
    const protocolModule = gatewayUrl.protocol === 'https:'
      ? await import('https')
      : await import('http');

    const requestOptions = {
      hostname: gatewayUrl.hostname,
      port: gatewayUrl.port ? Number(gatewayUrl.port) : (gatewayUrl.protocol === 'https:' ? 443 : 80),
      path: `/api/v0/pin/add?arg=${encodeURIComponent(cid)}`,
      method: 'POST',
      headers: {
        'Content-Length': '0',
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
    }

    return new Promise((resolve) => {
      const req = protocolModule.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const result = JSON.parse(data);
              console.log(`✅ CID ${cid} pinned successfully`);
              resolve({ success: true, result });
            } catch (e) {
              console.log(`✅ CID ${cid} pinned (response: ${data})`);
              resolve({ success: true });
            }
          } else {
            const error = `IPFS pin add failed with status ${res.statusCode}: ${data}`;
            console.warn(`⚠️ ${error}`);
            resolve({ success: false, error });
          }
        });
      });

      req.on('error', (err) => {
        const error = `IPFS pin add error: ${err.message}`;
        console.warn(`⚠️ ${error}`);
        resolve({ success: false, error });
      });

      req.setTimeout(30000, () => {
        req.destroy();
        const error = 'IPFS pin add timeout';
        console.warn(`⚠️ ${error}`);
        resolve({ success: false, error });
      });

      req.end();
    });
  } catch (error) {
    const errorMsg = `Error pinning CID ${cid}: ${error.message}`;
    console.error(`❌ ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
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
          const pinResult = await pinCid(cid);
          if (pinResult.success) {
            console.log(`✅ Deal ${dealId}: CID ${cid} pinned successfully`);
            results.synced++;
          } else {
            console.warn(`⚠️ Deal ${dealId}: Failed to pin CID ${cid}: ${pinResult.error}`);
            results.failed++;
            results.errors.push({
              dealId,
              cid,
              error: pinResult.error,
            });
          }
        }
        
        // Sync to GunDB if enabled
        if (gun && relayKeyPair && relayPub && !dryRun) {
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

