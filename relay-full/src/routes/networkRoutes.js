import express from 'express';
import { serverLogger } from '../utils/logger.js';

/**
 * Setup network management routes
 * @param {Function} authenticateRequest - Authentication middleware
 * @param {Object} gunInstance - Gun database instance
 * @returns {express.Router} Configured router
 */
function setupNetworkRoutes(authenticateRequest, getGunInstance) {
  const router = express.Router();

  // Apply authentication to all network routes
  router.use(authenticateRequest);

  /**
   * GET /api/network/peers
   * Get current peer information and connection status
   */
  router.get('/peers', async (req, res) => {
    try {
      serverLogger.info('[NetworkRoutes] Getting peer information');

      // Get Gun instance
      const gun = getGunInstance();
      if (!gun) {
        return res.status(500).json({
          success: false,
          error: 'Gun instance not available'
        });
      }

      // Get configured peers from Gun options
      const gunOptions = gun._.opt || {};
      const configuredPeers = Object.keys(gunOptions.peers || {});
      
      // Create peer info structure
      const peerInfo = {};
      const peers = [];

      // Process each configured peer
      configuredPeers.forEach(peerUrl => {
        peers.push(peerUrl);
        
        // Check if peer is in Gun's peer list (indicates connection)
        const peerData = gunOptions.peers[peerUrl];
        const isConnected = peerData && peerData.wire && peerData.wire.readyState === 1;
        
        peerInfo[peerUrl] = {
          url: peerUrl,
          connected: isConnected,
          status: isConnected ? 'connected' : 'disconnected',
          lastSeen: peerData?.last || Date.now(),
          latency: peerData?.latency || null
        };
      });

      // Add local peer info
      const localPeer = {
        url: 'local',
        connected: true,
        status: 'local',
        lastSeen: Date.now(),
        latency: 0
      };
      
      peerInfo.local = localPeer;

      const response = {
        success: true,
        peers: peers,
        peerInfo: peerInfo,
        totalPeers: peers.length,
        connectedPeers: Object.values(peerInfo).filter(p => p.connected).length,
        timestamp: Date.now()
      };

      serverLogger.info(`[NetworkRoutes] Returning ${peers.length} peers (${response.connectedPeers} connected)`);
      res.json(response);

    } catch (error) {
      serverLogger.error('[NetworkRoutes] Error getting peers:', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Error retrieving peer information: ' + error.message
      });
    }
  });

  /**
   * POST /api/network/peers
   * Add a new peer to the network
   */
  router.post('/peers', async (req, res) => {
    try {
      const { peer } = req.body;

      if (!peer || typeof peer !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Peer URL is required'
        });
      }

      // Validate peer URL format
      try {
        const url = new URL(peer);
        if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
          throw new Error('Invalid protocol');
        }
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: 'Invalid peer URL format'
        });
      }

      serverLogger.info(`[NetworkRoutes] Adding peer: ${peer}`);

      // Get Gun instance
      const gun = getGunInstance();
      if (!gun) {
        return res.status(500).json({
          success: false,
          error: 'Gun instance not available'
        });
      }

      // Add peer to Gun options
      gun.opt({ peers: [peer] });

      // Give Gun a moment to attempt connection
      await new Promise(resolve => setTimeout(resolve, 1000));

      serverLogger.info(`[NetworkRoutes] Peer added successfully: ${peer}`);

      res.json({
        success: true,
        message: 'Peer added successfully',
        peer: peer,
        timestamp: Date.now()
      });

    } catch (error) {
      serverLogger.error('[NetworkRoutes] Error adding peer:', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Error adding peer: ' + error.message
      });
    }
  });

  /**
   * DELETE /api/network/peers/:peerUrl
   * Remove a peer from the network
   */
  router.delete('/peers/:peerUrl', async (req, res) => {
    try {
      const peerUrl = decodeURIComponent(req.params.peerUrl);

      if (!peerUrl) {
        return res.status(400).json({
          success: false,
          error: 'Peer URL is required'
        });
      }

      serverLogger.info(`[NetworkRoutes] Removing peer: ${peerUrl}`);

      // Get Gun instance
      const gun = getGunInstance();
      if (!gun) {
        return res.status(500).json({
          success: false,
          error: 'Gun instance not available'
        });
      }

      // Remove peer from Gun's peer list
      const gunOptions = gun._.opt || {};
      if (gunOptions.peers && gunOptions.peers[peerUrl]) {
        // Close connection if exists
        const peerData = gunOptions.peers[peerUrl];
        if (peerData.wire && typeof peerData.wire.close === 'function') {
          peerData.wire.close();
        }
        
        // Remove from peers list
        delete gunOptions.peers[peerUrl];
      }

      serverLogger.info(`[NetworkRoutes] Peer removed successfully: ${peerUrl}`);

      res.json({
        success: true,
        message: 'Peer removed successfully',
        peer: peerUrl,
        timestamp: Date.now()
      });

    } catch (error) {
      serverLogger.error('[NetworkRoutes] Error removing peer:', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Error removing peer: ' + error.message
      });
    }
  });

  /**
   * POST /api/network/peers/:peerUrl/reconnect
   * Reconnect to a specific peer
   */
  router.post('/peers/:peerUrl/reconnect', async (req, res) => {
    try {
      const peerUrl = decodeURIComponent(req.params.peerUrl);

      if (!peerUrl) {
        return res.status(400).json({
          success: false,
          error: 'Peer URL is required'
        });
      }

      serverLogger.info(`[NetworkRoutes] Reconnecting to peer: ${peerUrl}`);

      // Get Gun instance
      const gun = getGunInstance();
      if (!gun) {
        return res.status(500).json({
          success: false,
          error: 'Gun instance not available'
        });
      }

      // Disconnect and reconnect to the peer
      const gunOptions = gun._.opt || {};
      if (gunOptions.peers && gunOptions.peers[peerUrl]) {
        const peerData = gunOptions.peers[peerUrl];
        
        // Close existing connection if any
        if (peerData.wire && typeof peerData.wire.close === 'function') {
          peerData.wire.close();
        }
        
        // Remove and re-add peer to force reconnection
        delete gunOptions.peers[peerUrl];
      }

      // Re-add the peer to trigger reconnection
      gun.opt({ peers: [peerUrl] });

      // Give Gun time to attempt reconnection
      await new Promise(resolve => setTimeout(resolve, 2000));

      serverLogger.info(`[NetworkRoutes] Reconnection initiated for peer: ${peerUrl}`);

      res.json({
        success: true,
        message: 'Reconnection initiated',
        peer: peerUrl,
        timestamp: Date.now()
      });

    } catch (error) {
      serverLogger.error('[NetworkRoutes] Error reconnecting to peer:', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Error reconnecting to peer: ' + error.message
      });
    }
  });

  /**
   * POST /api/network/peers/test
   * Test connection to a peer without adding it permanently
   */
  router.post('/peers/test', async (req, res) => {
    try {
      const { peer } = req.body;

      if (!peer || typeof peer !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Peer URL is required'
        });
      }

      // Validate peer URL format
      try {
        const url = new URL(peer);
        if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
          throw new Error('Invalid protocol');
        }
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: 'Invalid peer URL format'
        });
      }

      serverLogger.info(`[NetworkRoutes] Testing connection to peer: ${peer}`);

      // Simple HTTP-based test for now
      const startTime = Date.now();
      
      try {
        // Convert ws/wss URLs to http/https for testing
        let testUrl = peer;
        if (peer.startsWith('ws://')) {
          testUrl = peer.replace('ws://', 'http://');
        } else if (peer.startsWith('wss://')) {
          testUrl = peer.replace('wss://', 'https://');
        }

        // Make a simple fetch request to test connectivity
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        const response = await fetch(`${testUrl}/gun`, {
          method: 'HEAD',
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const latency = Date.now() - startTime;

        serverLogger.info(`[NetworkRoutes] Peer test successful: ${peer} (${latency}ms)`);

        res.json({
          success: true,
          message: 'Peer connection test successful',
          peer: peer,
          latency: latency,
          timestamp: Date.now()
        });

      } catch (fetchError) {
        const latency = Date.now() - startTime;
        
        serverLogger.warn(`[NetworkRoutes] Peer test failed: ${peer} (${latency}ms) - ${fetchError.message}`);

        // Still return success but with connection info
        res.json({
          success: false,
          message: 'Peer connection test failed',
          peer: peer,
          latency: latency,
          error: fetchError.message,
          timestamp: Date.now()
        });
      }

    } catch (error) {
      serverLogger.error('[NetworkRoutes] Error testing peer connection:', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Error testing peer connection: ' + error.message
      });
    }
  });

  return router;
}

export default setupNetworkRoutes; 