
import { Router } from "express";
import { loggers } from "../utils/logger";
import { chatService } from "../utils/chat-service";
import { authConfig } from "../config/env-config";
import { validateAdminToken } from "../utils/auth-utils";
import { torrentManager } from "../utils/torrent";
import { GUN_PATHS, getGunNode } from "../utils/gun-paths";

const router = Router();
const log = loggers.server;

/**
 * Middleware to require admin token
 */
const requireAuth = (req: any, res: any, next: any) => {
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;
  
    if (!validateAdminToken(token)) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    next();
};

/**
 * GET /chat/peers
 * List potential chat peers from network discovery
 */
router.get("/peers", requireAuth, async (req, res) => {
    try {
        const gun = req.app.get("gunInstance");
        if (!gun) {
            return res.json({ success: true, data: [] });
        }

        const peersMap = new Map<string, { pub: string; alias: string; lastSeen: number }>();
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

        await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => resolve(), 3000);

            // Helper to process peer data
            const processPeerData = (data: any, pubKey: string, type: 'relay' | 'peer') => {
                if (!data || !data.alias && !data.endpoint) return;
                
                // Only include recently seen peers
                if (data.lastSeen && data.lastSeen > fiveMinutesAgo) {
                    if (!peersMap.has(pubKey)) {
                        peersMap.set(pubKey, {
                            pub: pubKey,
                            alias: data.alias || data.endpoint || 'Unknown',
                            lastSeen: data.lastSeen
                        });
                    }
                }
            };

            // Read from unified relays path
            getGunNode(gun, GUN_PATHS.RELAYS).map().once((data: any, pubKey: string) => {
                processPeerData(data, pubKey, 'relay');
            });

            // Read from unified peers path
            getGunNode(gun, GUN_PATHS.PEERS).map().once((data: any, pubKey: string) => {
                processPeerData(data, pubKey, 'peer');
            });

            setTimeout(() => {
                clearTimeout(timeout);
                resolve();
            }, 2500);
        });
        
        const peers = Array.from(peersMap.values());
        
        res.json({
            success: true,
            data: peers
        });
    } catch (e: any) {
        log.error({ err: e }, "Failed to get peers");
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /chat/conversations
 * List active threads
 */
router.get("/conversations", requireAuth, async (req, res) => {
    try {
        const threads = chatService.getConversations();
        res.json({
            success: true,
            data: threads
        });
    } catch (e: any) {
        log.error({ err: e }, "Failed to get conversations");
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /chat/messages/:pub
 * Get message history for a peer
 */
router.get("/messages/:pub", requireAuth, async (req, res) => {
    try {
        const { pub } = req.params;
        
        // Validation: Pub key should not contain colons (implies message ID)
        if (pub.includes(':') || pub.length > 100) {
             return res.status(400).json({ 
                 success: false, 
                 error: "Invalid public key format. Did you pass a message ID instead?" 
             });
        }

        const messages = await chatService.getHistory(pub);
        res.json({
            success: true,
            data: messages
        });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /chat/messages/:pub
 * Send a message
 */
router.post("/messages/:pub", requireAuth, async (req, res) => {
    try {
        const { pub } = req.params;
        const { text } = req.body;
        
        if (!text) {
            return res.status(400).json({ success: false, error: "Missing text" });
        }

        await chatService.sendMessage(pub, text);
        
        res.json({
            success: true,
            message: "Message sent"
        });
    } catch (e: any) {
        log.error({ err: e }, "Failed to send message");
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /chat/sync/:pub
 * Unix sync
 */
router.post("/sync/:pub", requireAuth, async (req, res) => {
    try {
        const { pub } = req.params;
        await chatService.syncMessagesFrom(pub);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// BOT CONSOLE ROUTE (Direct command execution)
// ============================================================================

import { chatCommands } from "../utils/chat-commands";
import { getRelayKeyPair } from "../utils/relay-user";

/**
 * POST /chat/console
 * Execute a command directly and return the response
 * This is for the "Console" tab - no P2P messaging involved
 */
router.post("/console", requireAuth, async (req, res) => {
    try {
        const { command } = req.body;
        
        if (!command) {
            return res.status(400).json({ success: false, error: "Missing command" });
        }

        const relayKeyPair = getRelayKeyPair();
        if (!relayKeyPair) {
            return res.status(500).json({ success: false, error: "Relay not initialized" });
        }

        // Execute command as self (fromPub = own pubkey)
        // Provide a dummy sendMessage that just logs (used for /browse)
        const dummySend = async (to: string, text: string) => {
            log.info({ to, text }, "Console: Would send P2P message");
            return false; // Not actually sent
        };

        const response = await chatCommands.handleCommand(command, relayKeyPair.pub, dummySend);
        
        res.json({
            success: true,
            response: response || "Command executed (no output)"
        });
    } catch (e: any) {
        log.error({ err: e }, "Failed to execute console command");
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// PUBLIC LOBBY ROUTES
// ============================================================================

/**
 * GET /chat/lobby
 * Get recent public lobby messages
 */
router.get("/lobby", requireAuth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;
        const messages = chatService.getLobbyMessages(limit);
        res.json({
            success: true,
            data: messages
        });
    } catch (e: any) {
        log.error({ err: e }, "Failed to get lobby messages");
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /chat/lobby
 * Send a message to the public lobby
 */
router.post("/lobby", requireAuth, async (req, res) => {
    try {
        const { text } = req.body;
        
        if (!text) {
            return res.status(400).json({ success: false, error: "Missing text" });
        }

        await chatService.sendLobbyMessage(text);
        
        res.json({
            success: true,
            message: "Message sent to lobby"
        });
    } catch (e: any) {
        log.error({ err: e }, "Failed to send lobby message");
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================================
// MESSAGE DELETION ROUTES
// ============================================================================

/**
 * DELETE /chat/conversations/:pub
 * Clear an entire conversation
 */
router.delete("/conversations/:pub", requireAuth, async (req, res) => {
    try {
        const { pub } = req.params;
        await chatService.clearConversation(pub);
        res.json({
            success: true,
            message: "Conversation cleared"
        });
    } catch (e: any) {
        log.error({ err: e }, "Failed to clear conversation");
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * DELETE /chat/messages/:pub/:messageId
 * Delete a single message
 */
router.delete("/messages/:pub/:messageId", requireAuth, async (req, res) => {
    try {
        const { pub, messageId } = req.params;
        await chatService.deleteMessage(pub, messageId);
        res.json({
            success: true,
            message: "Message deleted"
        });
    } catch (e: any) {
        log.error({ err: e }, "Failed to delete message");
        res.status(500).json({ success: false, error: e.message });
    }
});

export default router;
