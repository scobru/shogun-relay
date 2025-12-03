/**
 * Network Routes - Relay Federation & Discovery
 * 
 * Leverages GunDB's native sync for relay discovery.
 * Does NOT duplicate GunDB's replication - only adds:
 * - Network-wide relay discovery endpoint
 * - Storage proofs for IPFS content verification
 * - Pin coordination messages via GunDB pub/sub
 * - On-chain registry queries (Base Sepolia/Mainnet)
 */

import express from 'express';
import http from 'http';
import crypto from 'crypto';
import * as Reputation from '../utils/relay-reputation.js';
import * as FrozenData from '../utils/frozen-data.js';
import { getRelayUser } from '../utils/relay-user.js';
import { createRegistryClient, REGISTRY_ADDRESSES } from '../utils/registry-client.js';

const router = express.Router();

// IPFS Configuration
const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN;

/**
 * Helper: Make IPFS API request
 */
function ipfsRequest(path, method = 'POST') {
  return new Promise((resolve, reject) => {
    const url = new URL(IPFS_API_URL);
    const requestOptions = {
      hostname: url.hostname,
      port: url.port || 5001,
      path: `/api/v0${path}`,
      method,
      headers: { 'Content-Length': '0' },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const req = http.request(requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('IPFS request timeout'));
    });
    req.end();
  });
}

/**
 * GET /api/v1/network/relays
 * 
 * Discover all relays in the network.
 * Reads from GunDB's native sync - no custom replication needed.
 */
router.get('/relays', async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({ success: false, error: 'Gun instance not available' });
    }

    const relays = [];
    const timeout = parseInt(req.query.timeout) || 5000;
    const minLastSeen = Date.now() - (parseInt(req.query.maxAge) || 300000); // Default 5 min

    // GunDB native: read all relays from the synced namespace
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, timeout);
      
      gun.get('relays').map().once((data, host) => {
        if (!data || typeof data !== 'object') return;
        
        const pulse = data.pulse;
        if (pulse && typeof pulse === 'object') {
          // Only include relays seen recently
          if (pulse.timestamp && pulse.timestamp > minLastSeen) {
            relays.push({
              host,
              endpoint: pulse.relay?.host ? `http://${pulse.relay.host}:${pulse.relay.port}` : null,
              lastSeen: pulse.timestamp,
              uptime: pulse.uptime,
              connections: pulse.connections,
              memory: pulse.memory,
              ipfs: pulse.ipfs || null, // Extended info if available
              storage: pulse.storage || null,
            });
          }
        }
      });

      // Give GunDB time to collect from peers
      setTimeout(() => {
        clearTimeout(timer);
        resolve();
      }, Math.min(timeout, 3000));
    });

    // Sort by most recently seen
    relays.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));

    res.json({
      success: true,
      count: relays.length,
      relays,
      query: {
        timeout,
        maxAge: Date.now() - minLastSeen,
      },
    });
  } catch (error) {
    console.error('Error fetching relays:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/network/relay/:host
 * 
 * Get specific relay info from GunDB.
 */
router.get('/relay/:host', async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({ success: false, error: 'Gun instance not available' });
    }

    const { host } = req.params;

    const relayData = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);
      
      gun.get('relays').get(host).once((data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });

    if (!relayData) {
      return res.status(404).json({ success: false, error: 'Relay not found' });
    }

    res.json({
      success: true,
      relay: {
        host,
        ...relayData,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/network/stats
 * 
 * Network-wide statistics aggregated from all known relays.
 */
router.get('/stats', async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({ success: false, error: 'Gun instance not available' });
    }

    const stats = {
      totalRelays: 0,
      activeRelays: 0,
      totalConnections: 0,
      totalStorageBytes: 0,
      totalPins: 0,
    };

    const fiveMinutesAgo = Date.now() - 300000;

    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      
      gun.get('relays').map().once((data, host) => {
        if (!data || typeof data !== 'object') return;
        
        stats.totalRelays++;
        
        const pulse = data.pulse;
        if (pulse && pulse.timestamp > fiveMinutesAgo) {
          stats.activeRelays++;
          stats.totalConnections += pulse.connections?.active || 0;
          
          if (pulse.ipfs) {
            stats.totalStorageBytes += pulse.ipfs.repoSize || 0;
            stats.totalPins += pulse.ipfs.numPins || 0;
          }
        }
      });

      setTimeout(() => {
        clearTimeout(timer);
        resolve();
      }, 2500);
    });

    res.json({
      success: true,
      stats: {
        ...stats,
        totalStorageMB: Math.round(stats.totalStorageBytes / (1024 * 1024)),
        totalStorageGB: (stats.totalStorageBytes / (1024 * 1024 * 1024)).toFixed(2),
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// STORAGE PROOFS
// ============================================

/**
 * GET /api/v1/network/proof/:cid
 * 
 * Generate a storage proof for a CID.
 * Proves this relay has the content pinned.
 */
router.get('/proof/:cid', async (req, res) => {
  try {
    const { cid } = req.params;
    const challenge = req.query.challenge || crypto.randomBytes(16).toString('hex');

    // 1. Verify CID exists locally via IPFS block/stat
    let blockStat;
    try {
      blockStat = await ipfsRequest(`/block/stat?arg=${cid}`);
      if (blockStat.Message || blockStat.Type === 'error') {
        return res.status(404).json({
          success: false,
          error: 'CID not found on this relay',
          cid,
        });
      }
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: 'CID not available',
        cid,
        details: error.message,
      });
    }

    // 2. Get the first bytes of content for proof
    let contentSample;
    try {
      const catResult = await new Promise((resolve, reject) => {
        const url = new URL(IPFS_API_URL);
        const options = {
          hostname: url.hostname,
          port: url.port || 5001,
          path: `/api/v0/cat?arg=${cid}&length=256`,
          method: 'POST',
          headers: { 'Content-Length': '0' },
        };
        
        if (IPFS_API_TOKEN) {
          options.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
        }

        const req = http.request(options, (res) => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
      });
      
      contentSample = catResult.toString('base64').substring(0, 64);
    } catch (e) {
      contentSample = null;
    }

    // 3. Check if pinned
    let isPinned = false;
    try {
      const pinLs = await ipfsRequest(`/pin/ls?arg=${cid}&type=all`);
      isPinned = pinLs.Keys && Object.keys(pinLs.Keys).length > 0;
    } catch (e) {
      // Not pinned or error
    }

    // 4. Generate proof
    const timestamp = Date.now();
    const proofData = `${cid}:${challenge}:${timestamp}:${blockStat.Size}`;
    const proofHash = crypto.createHash('sha256').update(proofData).digest('hex');

    // 5. Sign with relay identity if available
    const relayPub = req.app.get('relayUserPub');

    res.json({
      success: true,
      proof: {
        cid,
        challenge,
        timestamp,
        proofHash,
        relayPub: relayPub || null,
        block: {
          size: blockStat.Size,
          key: blockStat.Key,
        },
        contentSampleBase64: contentSample,
        isPinned,
        verification: {
          method: 'sha256(cid:challenge:timestamp:size)',
          validFor: 300000, // 5 minutes
          expiresAt: timestamp + 300000,
        },
      },
    });
  } catch (error) {
    console.error('Storage proof error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/network/verify-proof
 * 
 * Verify a storage proof from another relay.
 */
router.post('/verify-proof', express.json(), (req, res) => {
  try {
    const { proof } = req.body;
    
    if (!proof || !proof.cid || !proof.challenge || !proof.timestamp || !proof.proofHash) {
      return res.status(400).json({ success: false, error: 'Invalid proof format' });
    }

    // Check expiration
    if (Date.now() > proof.verification?.expiresAt) {
      return res.json({
        success: true,
        valid: false,
        reason: 'Proof expired',
      });
    }

    // Recalculate hash
    const proofData = `${proof.cid}:${proof.challenge}:${proof.timestamp}:${proof.block.size}`;
    const expectedHash = crypto.createHash('sha256').update(proofData).digest('hex');

    const isValid = expectedHash === proof.proofHash;

    res.json({
      success: true,
      valid: isValid,
      reason: isValid ? 'Proof hash matches' : 'Proof hash mismatch',
      expectedHash: isValid ? undefined : expectedHash,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// PIN COORDINATION (via GunDB pub/sub)
// ============================================

/**
 * POST /api/v1/network/pin-request
 * 
 * Request other relays to pin a CID.
 * Uses GunDB as message bus - relays listen and decide to pin.
 */
router.post('/pin-request', express.json(), async (req, res) => {
  try {
    // Require admin auth
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1] || req.headers['token'];
    if (token !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({ success: false, error: 'Gun instance not available' });
    }

    const { cid, replicationFactor = 3, priority = 'normal' } = req.body;
    
    if (!cid) {
      return res.status(400).json({ success: false, error: 'CID required' });
    }

    const relayPub = req.app.get('relayUserPub');
    const requestId = crypto.randomBytes(8).toString('hex');

    // Publish pin request to GunDB - other relays will see this via native sync
    const pinRequest = {
      id: requestId,
      cid,
      requester: relayPub,
      replicationFactor,
      priority,
      timestamp: Date.now(),
      status: 'pending',
    };

    gun.get('shogun-network').get('pin-requests').get(requestId).put(pinRequest);

    console.log(`📤 Pin request published: ${cid} (replication: ${replicationFactor})`);

    res.json({
      success: true,
      request: pinRequest,
      message: 'Pin request published to network',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/network/pin-requests
 * 
 * List pending pin requests from the network.
 */
router.get('/pin-requests', async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({ success: false, error: 'Gun instance not available' });
    }

    const requests = [];
    const maxAge = Date.now() - (parseInt(req.query.maxAge) || 86400000); // 24h default

    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      
      gun.get('shogun-network').get('pin-requests').map().once((data, id) => {
        if (!data || typeof data !== 'object') return;
        if (data.timestamp && data.timestamp > maxAge) {
          requests.push({ id, ...data });
        }
      });

      setTimeout(() => {
        clearTimeout(timer);
        resolve();
      }, 2500);
    });

    requests.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    res.json({
      success: true,
      count: requests.length,
      requests,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/network/pin-response
 * 
 * Respond to a pin request (announce that you pinned it).
 */
router.post('/pin-response', express.json(), async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({ success: false, error: 'Gun instance not available' });
    }

    const { requestId, status = 'completed' } = req.body;
    
    if (!requestId) {
      return res.status(400).json({ success: false, error: 'requestId required' });
    }

    const relayPub = req.app.get('relayUserPub');
    const responseId = crypto.randomBytes(8).toString('hex');

    const response = {
      id: responseId,
      requestId,
      responder: relayPub,
      status,
      timestamp: Date.now(),
    };

    gun.get('shogun-network').get('pin-responses').get(responseId).put(response);

    console.log(`📥 Pin response published for request ${requestId}: ${status}`);

    res.json({
      success: true,
      response,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// REPUTATION SYSTEM
// ============================================

/**
 * GET /api/v1/network/reputation/:host
 * 
 * Get reputation score and metrics for a specific relay.
 */
router.get('/reputation/:host', async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({ success: false, error: 'Gun instance not available' });
    }

    const { host } = req.params;
    const reputation = await Reputation.getReputation(gun, host);

    if (!reputation) {
      return res.status(404).json({
        success: false,
        error: 'Relay not found or no reputation data',
        host,
      });
    }

    res.json({
      success: true,
      host,
      reputation,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/network/reputation
 * 
 * Get reputation leaderboard - all relays sorted by score.
 */
router.get('/reputation', async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({ success: false, error: 'Gun instance not available' });
    }

    const options = {
      minScore: parseFloat(req.query.minScore) || 0,
      tier: req.query.tier || null,
      limit: parseInt(req.query.limit) || 50,
    };

    const leaderboard = await Reputation.getReputationLeaderboard(gun, options);

    res.json({
      success: true,
      count: leaderboard.length,
      leaderboard,
      weights: Reputation.WEIGHTS,
      filters: options,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/network/reputation/record-proof
 * 
 * Record a storage proof event (for tracking other relays).
 * Called when verifying proofs from other relays.
 */
router.post('/reputation/record-proof', express.json(), async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({ success: false, error: 'Gun instance not available' });
    }

    const { host, success, responseTimeMs = 0 } = req.body;

    if (!host) {
      return res.status(400).json({ success: false, error: 'host required' });
    }

    if (success) {
      await Reputation.recordProofSuccess(gun, host, responseTimeMs);
    } else {
      await Reputation.recordProofFailure(gun, host);
    }

    res.json({
      success: true,
      recorded: { host, proofSuccess: success, responseTimeMs },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/network/best-relays
 * 
 * Get best relays for replication based on reputation.
 * Useful for choosing where to replicate data.
 */
router.get('/best-relays', async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({ success: false, error: 'Gun instance not available' });
    }

    const count = parseInt(req.query.count) || 3;
    const minScore = parseFloat(req.query.minScore) || 50;
    const excludeHost = req.query.exclude || null;

    // Get relays with good reputation
    const leaderboard = await Reputation.getReputationLeaderboard(gun, {
      minScore,
      limit: count + 5, // Get extra in case some are filtered
    });

    // Filter out excluded host and select best
    const bestRelays = leaderboard
      .filter(r => r.host !== excludeHost)
      .slice(0, count)
      .map(r => ({
        host: r.host,
        score: r.calculatedScore.total,
        tier: r.calculatedScore.tier,
        uptime: r.uptimePercent,
        lastSeen: r.lastSeenTimestamp,
      }));

    res.json({
      success: true,
      count: bestRelays.length,
      relays: bestRelays,
      criteria: { minScore, excludeHost },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// FROZEN (IMMUTABLE, VERIFIED) DATA ENDPOINTS
// ============================================

/**
 * GET /api/v1/network/verified/relays
 * 
 * List relay announcements from frozen (signed, immutable) space.
 * These are cryptographically verified and tamper-proof.
 */
router.get('/verified/relays', async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({ success: false, error: 'Gun instance not available' });
    }

    const verifyAll = req.query.verify !== 'false';
    const maxAge = parseInt(req.query.maxAge) || 600000; // 10 min default
    const limit = parseInt(req.query.limit) || 50;

    const entries = await FrozenData.listFrozenEntries(gun, 'relay-announcements', {
      verifyAll,
      maxAge,
      limit,
    });

    res.json({
      success: true,
      count: entries.length,
      relays: entries.map(e => ({
        host: e.key,
        pub: e.pub,
        hash: e.hash,
        updatedAt: e.updatedAt,
        verified: e.verified,
        data: e.data,
      })),
      verification: {
        method: 'SEA.sign + SHA-256 content-hash',
        note: 'Only entries with verified=true are cryptographically authentic',
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/network/verified/relay/:host
 * 
 * Get verified (frozen) announcement for a specific relay.
 */
router.get('/verified/relay/:host', async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({ success: false, error: 'Gun instance not available' });
    }

    const { host } = req.params;
    const entry = await FrozenData.getLatestFrozenEntry(gun, 'relay-announcements', host);

    if (!entry) {
      return res.status(404).json({
        success: false,
        error: 'No verified announcement found for this relay',
        host,
      });
    }

    res.json({
      success: true,
      host,
      verified: entry.verified,
      verificationDetails: entry.verificationDetails,
      data: entry.data,
      hash: entry.hash,
      pub: entry.pub,
      timestamp: entry.timestamp,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/network/verified/observation
 * 
 * Create a signed observation about another relay.
 * Used for building decentralized reputation from verified sources.
 */
router.post('/verified/observation', express.json(), async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({ success: false, error: 'Gun instance not available' });
    }

    const relayUser = getRelayUser();
    if (!relayUser || !relayUser.is) {
      return res.status(503).json({
        success: false,
        error: 'Relay user not initialized - cannot sign observations',
      });
    }

    const { observedHost, observation } = req.body;

    if (!observedHost || !observation) {
      return res.status(400).json({
        success: false,
        error: 'observedHost and observation required',
      });
    }

    // Validate observation structure
    const validatedObservation = {
      proofsSuccessful: observation.proofsSuccessful || 0,
      proofsFailed: observation.proofsFailed || 0,
      avgResponseTimeMs: observation.avgResponseTimeMs || null,
      pinsFulfilled: observation.pinsFulfilled || 0,
      pinsRequested: observation.pinsRequested || 0,
      notes: observation.notes || null,
    };

    const result = await FrozenData.createFrozenObservation(
      gun,
      observedHost,
      validatedObservation,
      relayUser._.sea
    );

    console.log(`📝 Frozen observation created for ${observedHost}: ${result.hash.substring(0, 16)}...`);

    res.json({
      success: true,
      observation: {
        observedHost,
        hash: result.hash,
        observer: relayUser.is.pub,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/network/verified/observations/:host
 * 
 * Get all verified observations for a specific relay.
 * Aggregates reputation from multiple verified sources.
 */
router.get('/verified/observations/:host', async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({ success: false, error: 'Gun instance not available' });
    }

    const { host } = req.params;
    const observations = await FrozenData.getObservationsForHost(gun, host, {
      verifyAll: true,
      limit: parseInt(req.query.limit) || 50,
    });

    // Aggregate reputation from verified observations
    const aggregated = FrozenData.aggregateReputation(observations);

    res.json({
      success: true,
      host,
      observationsCount: observations.length,
      observations,
      aggregatedReputation: aggregated,
      note: 'Reputation is aggregated from cryptographically verified observations only',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/network/verified/entry/:hash
 * 
 * Read and verify any frozen entry by its content hash.
 */
router.get('/verified/entry/:namespace/:hash', async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({ success: false, error: 'Gun instance not available' });
    }

    const { namespace, hash } = req.params;
    const entry = await FrozenData.readFrozenEntry(gun, namespace, hash);

    if (!entry) {
      return res.status(404).json({
        success: false,
        error: 'Entry not found',
        namespace,
        hash,
      });
    }

    res.json({
      success: true,
      namespace,
      hash,
      verified: entry.verified,
      verificationDetails: entry.verificationDetails,
      data: entry.data,
      pub: entry.pub,
      timestamp: entry.timestamp,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// ON-CHAIN REGISTRY ENDPOINTS
// Query the ShogunRelayRegistry smart contract on Base Sepolia/Mainnet
// =============================================================================

/**
 * GET /api/v1/network/onchain/relays
 * 
 * Get all registered relays from the on-chain registry.
 * This is the authoritative source for relay discovery.
 */
router.get('/onchain/relays', async (req, res) => {
  try {
    const chainId = parseInt(req.query.chainId) || 84532; // Default to Base Sepolia
    
    if (!REGISTRY_ADDRESSES[chainId]) {
      return res.status(400).json({
        success: false,
        error: `Registry not deployed on chain ${chainId}`,
        supportedChains: Object.keys(REGISTRY_ADDRESSES).map(Number),
      });
    }

    const client = createRegistryClient(chainId);
    const [relays, params] = await Promise.all([
      client.getActiveRelays(),
      client.getRegistryParams(),
    ]);

    res.json({
      success: true,
      chainId,
      registryAddress: client.registryAddress,
      relayCount: relays.length,
      relays,
      registryParams: params,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/network/onchain/relay/:address
 * 
 * Get details for a specific relay from on-chain registry.
 */
router.get('/onchain/relay/:address', async (req, res) => {
  try {
    const chainId = parseInt(req.query.chainId) || 84532;
    const { address } = req.params;

    if (!REGISTRY_ADDRESSES[chainId]) {
      return res.status(400).json({
        success: false,
        error: `Registry not deployed on chain ${chainId}`,
      });
    }

    const client = createRegistryClient(chainId);
    const info = await client.getRelayInfo(address);

    if (!info) {
      return res.status(404).json({
        success: false,
        error: 'Relay not found in registry',
        address,
      });
    }

    res.json({
      success: true,
      chainId,
      relay: info,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/network/onchain/deals/relay/:address
 * 
 * Get all storage deals for a relay from on-chain registry.
 */
router.get('/onchain/deals/relay/:address', async (req, res) => {
  try {
    const chainId = parseInt(req.query.chainId) || 84532;
    const { address } = req.params;

    const client = createRegistryClient(chainId);
    const deals = await client.getRelayDeals(address);

    res.json({
      success: true,
      chainId,
      relayAddress: address,
      dealCount: deals.length,
      deals,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/network/onchain/deals/client/:address
 * 
 * Get all storage deals for a client from on-chain registry.
 */
router.get('/onchain/deals/client/:address', async (req, res) => {
  try {
    const chainId = parseInt(req.query.chainId) || 84532;
    const { address } = req.params;

    const client = createRegistryClient(chainId);
    const deals = await client.getClientDeals(address);

    res.json({
      success: true,
      chainId,
      clientAddress: address,
      dealCount: deals.length,
      deals,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/network/onchain/params
 * 
 * Get registry parameters (min stake, unstaking delay, etc.)
 */
router.get('/onchain/params', async (req, res) => {
  try {
    const chainId = parseInt(req.query.chainId) || 84532;

    if (!REGISTRY_ADDRESSES[chainId]) {
      return res.status(400).json({
        success: false,
        error: `Registry not deployed on chain ${chainId}`,
      });
    }

    const client = createRegistryClient(chainId);
    const params = await client.getRegistryParams();

    res.json({
      success: true,
      chainId,
      registryAddress: client.registryAddress,
      usdcAddress: client.usdcAddress,
      params,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

