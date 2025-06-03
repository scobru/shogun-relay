import express from 'express';
import { serverLogger } from '../utils/logger.js';
import WebSocket from 'ws';
import fs from 'fs';

// Cache for config to avoid reading file multiple times
let configCache = null;

function getConfig() {
  if (!configCache) {
    try {
      configCache = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
    } catch (error) {
      serverLogger.error('[NetworkRoutes] Failed to load config.json:', error.message);
      configCache = { PEERS: [] };
    }
  }
  return configCache;
}

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

      // Get configured peers from config.json (always include these)
      const config = getConfig();
      const configuredPeers = config.PEERS || [];
      
      // Get Gun's current peer information
      const gunOptions = gun._.opt || {};
      const gunPeers = gunOptions.peers || {};
      
      // Create peer info structure
      const peerInfo = {};
      const peers = [];

      // Process configured peers from config.json (these should always be shown)
      configuredPeers.forEach(peerUrl => {
        if (typeof peerUrl === 'string' && peerUrl.trim()) {
          peers.push(peerUrl);
          
          // Check if peer is in Gun's peer list (indicates connection attempt/status)
          const peerData = gunPeers[peerUrl];
          const isConnected = peerData && peerData.wire && peerData.wire.readyState === 1;
          
          peerInfo[peerUrl] = {
            url: peerUrl,
            connected: isConnected,
            status: isConnected ? 'connected' : 'disconnected',
            lastSeen: peerData?.last || Date.now(),
            latency: peerData?.latency || null,
            source: 'config' // Mark as configured peer
          };
        }
      });

      // Also include any additional peers that Gun has but aren't in config
      Object.keys(gunPeers).forEach(peerUrl => {
        if (!peers.includes(peerUrl) && peerUrl !== 'local') {
          peers.push(peerUrl);
          
          const peerData = gunPeers[peerUrl];
          const isConnected = peerData && peerData.wire && peerData.wire.readyState === 1;
          
          peerInfo[peerUrl] = {
            url: peerUrl,
            connected: isConnected,
            status: isConnected ? 'connected' : 'disconnected',
            lastSeen: peerData?.last || Date.now(),
            latency: peerData?.latency || null,
            source: 'runtime' // Mark as runtime-added peer
          };
        }
      });

      // Add local peer info
      const localPeer = {
        url: 'local',
        connected: true,
        status: 'local',
        lastSeen: Date.now(),
        latency: 0,
        source: 'local'
      };
      
      peerInfo.local = localPeer;

      const response = {
        success: true,
        peers: peers,
        peerInfo: peerInfo,
        totalPeers: peers.length,
        connectedPeers: Object.values(peerInfo).filter(p => p.connected).length,
        configuredPeers: configuredPeers.length,
        timestamp: Date.now()
      };

      serverLogger.info(`[NetworkRoutes] Returning ${peers.length} peers (${response.connectedPeers} connected, ${configuredPeers.length} configured)`);
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
    const startTime = Date.now();
    let peerUrl;
    
    try {
      peerUrl = decodeURIComponent(req.params.peerUrl);

      if (!peerUrl) {
        return res.status(400).json({
          success: false,
          error: 'Peer URL is required'
        });
      }

      serverLogger.info(`[NetworkRoutes] Attempting to reconnect to peer: ${peerUrl}`);

      // Get Gun instance
      const gun = getGunInstance();
      if (!gun) {
        return res.status(500).json({
          success: false,
          error: 'Gun instance not available'
        });
      }

      // Validate URL format
      try {
        new URL(peerUrl);
      } catch (urlError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid peer URL format'
        });
      }

      // Step 1: Clean disconnect from existing peer
      const gunOptions = gun._.opt || {};
      let oldPeerData = null;
      
      if (gunOptions.peers && gunOptions.peers[peerUrl]) {
        oldPeerData = gunOptions.peers[peerUrl];
        
        // Close existing connection gracefully
        if (oldPeerData.wire) {
          try {
            if (typeof oldPeerData.wire.close === 'function') {
              oldPeerData.wire.close();
            }
            // Also try to terminate WebSocket if it exists
            if (oldPeerData.wire.readyState === 1) {
              oldPeerData.wire.terminate && oldPeerData.wire.terminate();
            }
          } catch (closeError) {
            serverLogger.warn(`[NetworkRoutes] Error closing existing connection to ${peerUrl}:`, closeError.message);
          }
        }
        
        // Remove peer from Gun's peer list
        delete gunOptions.peers[peerUrl];
        serverLogger.debug(`[NetworkRoutes] Cleaned up existing connection to: ${peerUrl}`);
      }

      // Step 2: Wait for clean disconnect
      await new Promise(resolve => setTimeout(resolve, 500));

      // Step 3: Test connectivity before attempting reconnection
      let testSuccessful = false;
      try {
        const testResult = await testPeerConnectivity(peerUrl, 3000); // 3 second timeout
        testSuccessful = testResult.success;
        if (!testSuccessful) {
          serverLogger.warn(`[NetworkRoutes] Pre-connection test failed for ${peerUrl}: ${testResult.error}`);
        }
      } catch (testError) {
        serverLogger.warn(`[NetworkRoutes] Pre-connection test threw error for ${peerUrl}:`, testError.message);
      }

      // Step 4: Attempt reconnection with Gun
      try {
        // Use Gun's built-in peer management
        gun.opt({ peers: [peerUrl] });
        serverLogger.info(`[NetworkRoutes] Initiated Gun reconnection to: ${peerUrl}`);
      } catch (gunError) {
        throw new Error(`Gun reconnection failed: ${gunError.message}`);
      }

      // Step 5: Monitor connection establishment with timeout
      const connectionTimeout = 5000; // 5 seconds
      const checkInterval = 250; // Check every 250ms
      const maxChecks = connectionTimeout / checkInterval;
      let currentCheck = 0;
      let connectionEstablished = false;

      while (currentCheck < maxChecks && !connectionEstablished) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        
        const currentPeerData = (gun._.opt.peers || {})[peerUrl];
        if (currentPeerData && currentPeerData.wire) {
          // Check WebSocket readyState (1 = OPEN)
          if (currentPeerData.wire.readyState === 1) {
            connectionEstablished = true;
            break;
          }
        }
        
        currentCheck++;
      }

      const totalTime = Date.now() - startTime;

      if (connectionEstablished) {
        serverLogger.info(`[NetworkRoutes] Successfully reconnected to peer: ${peerUrl} in ${totalTime}ms`);
        
        // Verify connection with a simple Gun operation
        try {
          const testKey = `_connection_test_${Date.now()}`;
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Verification timeout')), 2000);
            gun.get(testKey).put({ test: true }, (ack) => {
              clearTimeout(timeout);
              if (ack.err) {
                reject(new Error(`Gun verification failed: ${ack.err}`));
              } else {
                resolve();
              }
            });
          });
          
          res.json({
            success: true,
            message: 'Peer reconnected and verified successfully',
            peer: peerUrl,
            status: 'connected',
            latency: totalTime,
            preTestPassed: testSuccessful
          });
        } catch (verifyError) {
          serverLogger.warn(`[NetworkRoutes] Connection established but verification failed for ${peerUrl}: ${verifyError.message}`);
          res.json({
            success: true,
            message: 'Peer reconnected but verification inconclusive',
            peer: peerUrl,
            status: 'connected-unverified',
            latency: totalTime,
            preTestPassed: testSuccessful,
            warning: verifyError.message
          });
        }
      } else {
        serverLogger.warn(`[NetworkRoutes] Connection timeout for peer: ${peerUrl} after ${totalTime}ms`);
        
        // Provide more specific error message based on pre-test results
        let errorMessage = 'Connection timeout';
        if (!testSuccessful) {
          errorMessage = 'Peer is unreachable - failed basic connectivity test';
        } else {
          errorMessage = 'Gun connection establishment timeout - peer may not support Gun protocol';
        }
        
        res.json({
          success: false,
          message: errorMessage,
          peer: peerUrl,
          status: 'timeout',
          latency: totalTime,
          preTestPassed: testSuccessful,
          error: errorMessage
        });
      }

    } catch (error) {
      const totalTime = Date.now() - startTime;
      
      // Provide more specific error messages
      let errorMessage = 'Unknown error';
      let errorType = 'unknown';
      
      if (error.message.includes('Gun reconnection failed')) {
        errorMessage = error.message;
        errorType = 'gun';
      } else if (error.message.includes('Invalid peer URL')) {
        errorMessage = 'Invalid peer URL format';
        errorType = 'url';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Connection timeout';
        errorType = 'timeout';
      } else if (error.message.includes('ENOTFOUND')) {
        errorMessage = 'DNS resolution failed - hostname not found';
        errorType = 'dns';
      } else if (error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Connection refused - peer is not accepting connections';
        errorType = 'refused';
      } else if (error.message.includes('EHOSTUNREACH')) {
        errorMessage = 'Host unreachable - network or firewall issue';
        errorType = 'unreachable';
      } else {
        errorMessage = error.message || 'Unknown reconnection error';
        errorType = 'network';
      }
      
      serverLogger.error(`[NetworkRoutes] Error during peer reconnection to ${peerUrl}:`, { 
        error: error.message, 
        stack: error.stack,
        duration: totalTime,
        type: errorType
      });
      
      res.status(500).json({
        success: false,
        error: errorMessage,
        errorType: errorType,
        peer: peerUrl || 'unknown',
        latency: totalTime,
        details: error.message
      });
    }
  });

  /**
   * Helper function to test peer connectivity before attempting Gun connection
   */
  async function testPeerConnectivity(peerUrl, timeout = 3000) {
    try {
      let testUrl = peerUrl;
      
      // Convert WebSocket URLs to HTTP for testing
      if (peerUrl.startsWith('ws://')) {
        testUrl = peerUrl.replace('ws://', 'http://');
      } else if (peerUrl.startsWith('wss://')) {
        testUrl = peerUrl.replace('wss://', 'https://');
      }
      
      // Ensure /gun endpoint
      if (!testUrl.includes('/gun')) {
        testUrl = testUrl.endsWith('/') ? testUrl + 'gun' : testUrl + '/gun';
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(testUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'Accept': '*/*',
            'User-Agent': 'Gun-Relay-Test/1.0'
          }
        });

        clearTimeout(timeoutId);
        
        // Gun relays typically return 200 or other non-5xx status
        if (response.status < 500) {
          return { success: true, status: response.status };
        } else {
          return { success: false, error: `Server error: ${response.status}` };
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        return { success: false, error: fetchError.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * POST /api/network/peers/:peerUrl/test
   * Simple test for Gun relay peers - just check if they're online
   */
  router.post('/peers/:peerUrl/test', async (req, res) => {
    const rawPeerUrl = req.params.peerUrl;
    let peerUrl;
    try {
      peerUrl = decodeURIComponent(rawPeerUrl);
    } catch (e) {
      serverLogger.error('[NetworkRoutes] Failed to decode peer URL for test:', { rawPeerUrl, error: e.message });
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid peer URL format: URL encoding error' 
      });
    }

    if (!peerUrl) {
      return res.status(400).json({ 
        success: false, 
        error: 'Peer URL is required for testing' 
      });
    }

    serverLogger.info(`[NetworkRoutes] Testing Gun relay: ${peerUrl}`);

    try {
      const startTime = Date.now();
      
      // Simple HTTP test for Gun relays
      let testUrl = peerUrl;
      
      // Convert WebSocket URLs to HTTP for testing
      if (peerUrl.includes('/gun')) {
        // Already has /gun endpoint
        testUrl = peerUrl.replace('ws://', 'http://').replace('wss://', 'https://');
      } else {
        // Add /gun endpoint for testing
        const baseUrl = peerUrl.replace('ws://', 'http://').replace('wss://', 'https://');
        testUrl = baseUrl.endsWith('/') ? baseUrl + 'gun' : baseUrl + '/gun';
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // Increased timeout

      try {
        const response = await fetch(testUrl, {
          method: 'GET', // Use GET instead of HEAD to get Gun response
          signal: controller.signal,
          headers: {
            'Accept': '*/*',
            'User-Agent': 'Gun-Relay-Test/1.0'
          }
        });

        clearTimeout(timeoutId);
        const latency = Date.now() - startTime;

        // Gun relays typically return various status codes but if they respond, they're online
        if (response.status < 500) { // Accept anything except server errors
          serverLogger.info(`[NetworkRoutes] Gun relay test successful: ${peerUrl} (${latency}ms, status: ${response.status})`);
          res.json({ 
            success: true, 
            message: `Gun relay is online (HTTP ${response.status})`,
            method: 'HTTP',
            latency: latency,
            status: response.status,
            testUrl: testUrl
          });
        } else {
          const errorMsg = `Server error: HTTP ${response.status}`;
          serverLogger.warn(`[NetworkRoutes] Gun relay test failed: ${peerUrl} - ${errorMsg}`);
          res.json({ 
            success: false, 
            error: errorMsg,
            method: 'HTTP',
            latency: latency,
            status: response.status,
            testUrl: testUrl
          });
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        const latency = Date.now() - startTime;
        
        // Provide more specific error messages
        let errorMessage = 'Unknown connection error';
        let errorType = 'network';
        
        if (fetchError.name === 'AbortError') {
          errorMessage = 'Connection timeout - peer may be offline or unreachable';
          errorType = 'timeout';
        } else if (fetchError.message.includes('ENOTFOUND')) {
          errorMessage = 'DNS resolution failed - hostname not found';
          errorType = 'dns';
        } else if (fetchError.message.includes('ECONNREFUSED')) {
          errorMessage = 'Connection refused - peer is not accepting connections';
          errorType = 'refused';
        } else if (fetchError.message.includes('EHOSTUNREACH')) {
          errorMessage = 'Host unreachable - network or firewall issue';
          errorType = 'unreachable';
        } else if (fetchError.message.includes('certificate')) {
          errorMessage = 'SSL certificate error - invalid or expired certificate';
          errorType = 'ssl';
        } else {
          errorMessage = `Network error: ${fetchError.message}`;
          errorType = 'network';
        }
        
        serverLogger.warn(`[NetworkRoutes] Gun relay test failed: ${peerUrl} (${latency}ms) - ${errorMessage}`, {
          error: fetchError.message,
          type: errorType,
          testUrl: testUrl
        });
        
        res.json({ 
          success: false, 
          error: errorMessage,
          errorType: errorType,
          method: 'HTTP',
          latency: latency,
          testUrl: testUrl,
          details: fetchError.message
        });
      }

    } catch (err) {
      serverLogger.error(`[NetworkRoutes] Error testing Gun relay ${peerUrl}:`, { error: err.message });
      res.status(500).json({ 
        success: false, 
        error: `Test failed: ${err.message}`,
        method: 'HTTP',
        details: err.stack
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