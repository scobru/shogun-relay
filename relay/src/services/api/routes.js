import express from "express";
import { searchUsers, getUsernameIndex, getProtocolStats, saveProtocolStat } from "../indexing/database.js";

const router = express.Router();

export function initRoutes(app) {
  console.log("🌐 Initializing HTTP API routes...");

  // Search users
  router.get("/api/users/search", (req, res) => {
    const query = req.query.q;
    if (!query) {
      return res.json([]);
    }
    const results = searchUsers(query);
    res.json(results);
  });

  // Get user by pub
  router.get("/api/users/:pub", (req, res) => {
    const pub = req.params.pub;
    const usernameIndex = getUsernameIndex();
    
    for (const user of usernameIndex.values()) {
      if (user.userPub === pub) {
        return res.json(user);
      }
    }
    
    res.status(404).json({ error: "User not found" });
  });

  // Check user presence (compatible with HttpApiManager)
  router.get("/api/presence/:pub", (req, res) => {
    const pub = req.params.pub;
    const usernameIndex = getUsernameIndex();
    
    // Check if user is in our index (which means they have been seen recently)
    let foundUser = null;
    for (const user of usernameIndex.values()) {
      if (user.userPub === pub) {
        foundUser = user;
        break;
      }
    }

    if (foundUser) {
      // Check if last seen is recent (e.g. last 5 minutes)
      const isOnline = (Date.now() - foundUser.lastSeen) < 5 * 60 * 1000;
      
      res.json({
        isOnline,
        lastSeen: foundUser.lastSeen
      });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  });

  // Get protocol stats
  router.get("/api/stats/protocol", (req, res) => {
    const stats = getProtocolStats();
    res.json({ stats });
  });

  // Notifications endpoint (mock for compatibility)
  router.get("/api/notifications/:pub", (req, res) => {
    // Return empty array for now
    res.json([]);
  });

  // Notify message sent (for stats)
  router.post("/api/notify/message", (req, res) => {
    const stats = getProtocolStats();
    saveProtocolStat("totalMessages", (stats.totalMessages || 0) + 1);
    res.json({ success: true });
  });

  // Notify conversation started (for stats)
  router.post("/api/notify/conversation", (req, res) => {
    const stats = getProtocolStats();
    saveProtocolStat("totalConversations", (stats.totalConversations || 0) + 1);
    res.json({ success: true });
  });

  app.use(router);
}
