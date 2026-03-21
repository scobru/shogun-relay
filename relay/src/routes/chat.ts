import express from "express";
import { chatService } from "../utils/chat-service";
import { loggers } from "../utils/logger";
import { adminAuthMiddleware } from "../middleware/admin-auth";

const router: express.Router = express.Router();

/**
 * GET /api/v1/chat/peers
 * Get all peers the relay has conversations with
 */
router.get("/peers", adminAuthMiddleware, (req, res) => {
  try {
    const conversations = chatService.getConversations();
    const peers = conversations.map(c => c.pub);
    res.json({
      success: true,
      peers,
      timestamp: Date.now()
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Chat peers error");
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/chat/conversations
 * Get all conversation threads
 */
router.get("/conversations", adminAuthMiddleware, (req, res) => {
  try {
    const conversations = chatService.getConversations();
    res.json({
      success: true,
      conversations,
      timestamp: Date.now()
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Chat conversations error");
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/chat/messages/:pub
 * Get message history with a specific peer
 */
router.get("/messages/:pub", adminAuthMiddleware, async (req, res) => {
  try {
    const pub = req.params.pub as string;
    const messages = await chatService.getHistory(pub);
    res.json({
      success: true,
      messages,
      timestamp: Date.now()
    });
  } catch (error: any) {
    loggers.server.error({ err: error, pub: (req.params.pub as string) }, "❌ Chat history error");
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/chat/messages/:pub
 * Send a message to a specific peer
 */
router.post("/messages/:pub", adminAuthMiddleware, async (req, res) => {
  try {
    const pub = req.params.pub as string;
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ success: false, error: "Message text is required" });
    }

    const success = await chatService.sendMessage(pub, text);
    res.json({
      success,
      timestamp: Date.now()
    });
  } catch (error: any) {
    loggers.server.error({ err: error, pub: (req.params.pub as string) }, "❌ Send message error");
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/chat/sync/:pub
 * Force sync messages from a peer
 */
router.post("/sync/:pub", adminAuthMiddleware, async (req, res) => {
  try {
    const pub = req.params.pub as string;
    await chatService.syncMessagesFrom(pub);
    res.json({
      success: true,
      message: `Sync started for ${pub}`,
      timestamp: Date.now()
    });
  } catch (error: any) {
    loggers.server.error({ err: error, pub: (req.params.pub as string) }, "❌ Sync chat error");
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/chat/lobby
 * Get recent lobby messages
 */
router.get("/lobby", adminAuthMiddleware, (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string || "") || 50;
    const messages = chatService.getLobbyMessages(limit);
    res.json({
      success: true,
      messages,
      timestamp: Date.now()
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Lobby messages error");
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/chat/lobby
 * Send a message to the public lobby
 */
router.post("/lobby", adminAuthMiddleware, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ success: false, error: "Message text is required" });
    }

    const success = await chatService.sendLobbyMessage(text);
    res.json({
      success,
      timestamp: Date.now()
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Send lobby message error");
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/v1/chat/conversations/:pub
 * Clear conversation with a peer
 */
router.delete("/conversations/:pub", adminAuthMiddleware, async (req, res) => {
  try {
    const pub = req.params.pub as string;
    const success = await chatService.clearConversation(pub);
    res.json({
      success,
      timestamp: Date.now()
    });
  } catch (error: any) {
    loggers.server.error({ err: error, pub: (req.params.pub as string) }, "❌ Delete conversation error");
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/v1/chat/messages/:pub/:messageId
 * Delete a specific message
 */
router.delete("/messages/:pub/:messageId", adminAuthMiddleware, async (req, res) => {
  try {
    const pub = req.params.pub as string; const messageId = req.params.messageId as string;
    const success = await chatService.deleteMessage(pub, messageId);
    res.json({
      success,
      timestamp: Date.now()
    });
  } catch (error: any) {
    loggers.server.error({ err: error, pub: (req.params.pub as string), messageId: (req.params.messageId as string) }, "❌ Delete message error");
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/chat/console
 * Execute a console command (Not implemented)
 */
router.post("/console", adminAuthMiddleware, (req, res) => {
  res.status(501).json({
    success: false,
    error: "Console commands are not implemented in this version"
  });
});

export default router;
