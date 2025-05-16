import express from "express";

// Dependencies to be passed in: gun, authenticateRequestMiddleware
export default function setupGunDbRoutes(gun, authenticateRequestMiddleware) {
  const router = express.Router();

  /**
   * Helper function for Gun operations with timeout
   * @param {Function} gunOperation - Gun operation to execute
   * @param {number} timeoutMs - Timeout in milliseconds
   */
  const gunPromiseWithTimeout = (gunOperation, timeoutMs = 3000) => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(null);
      }, timeoutMs);

      gunOperation((result) => {
        clearTimeout(timeout);
        resolve(result);
      });
    });
  };

  // API - GUNDB EXPLORE
  router.get("/explore", authenticateRequestMiddleware, async (req, res) => {
    try {
      const path = req.query.path || "";

      let gunNode = gun;

      // Navigate to the requested node
      if (path) {
        const pathParts = path.split(".");
        for (const part of pathParts) {
          gunNode = gunNode.get(part);
        }
      }

      // Get data from current node
      const nodeData = await gunPromiseWithTimeout((resolve) => {
        gunNode.once((data) => {
          resolve(data);
        });
      });

      // If no data is found
      if (!nodeData) {
        return res.json({
          success: true,
          path,
          nodes: [],
        });
      }

      // Extract and process nodes
      const nodes = [];
      Object.keys(nodeData).forEach((key) => {
        // Skip special GunDB fields starting with "_"
        if (key.startsWith("_")) {
          return;
        }

        const value = nodeData[key];
        let type = typeof value;

        // Determine correct type
        if (value === null) {
          type = "null";
        } else if (Array.isArray(value)) {
          type = "array";
        } else if (typeof value === "object") {
          type = "object";
        }

        // Determine path for navigation
        const nodePath = path ? `${path}.${key}` : key;

        nodes.push({
          key,
          value,
          type,
          path: nodePath,
        });
      });

      res.json({
        success: true,
        path,
        nodes,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        message: "Error exploring GunDB",
      });
    }
  });

  // API - GUNDB CREATE NODE
  router.post("/create-node", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { path, key, value } = req.body;

      if (!path) {
        return res.status(400).json({ 
          success: false,
          error: "Path is required",
          message: "Missing required parameter" 
        });
      }

      // Split path into parts
      const pathParts = path.split("/").filter(Boolean);

      // Navigate the path and create the node
      let currentNode = gun;

      // Navigate the path
      for (const part of pathParts) {
        currentNode = currentNode.get(part);
      }

      // If a key is provided, set the value for that key
      if (key) {
        currentNode.get(key).put(value);
        res.json({
          success: true,
          message: `Node ${path}/${key} created successfully`,
          path,
          key,
        });
      } else {
        // Otherwise, set the value for the current node
        currentNode.put(value);
        res.json({
          success: true,
          message: `Node ${path} created successfully`,
          path,
        });
      }
    } catch (error) {
      res.status(500).json({ 
        success: false,
        error: error.message,
        message: "Error creating GunDB node"
      });
    }
  });

  return router;
} 