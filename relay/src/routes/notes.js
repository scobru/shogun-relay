import express from 'express';
import SEA from 'gun/sea.js';

const router = express.Router();

// Middleware per ottenere l'istanza Gun dal relay
const getGunInstance = (req) => {
  return req.app.get('gunInstance');
};

// Middleware di autenticazione per le note admin
const adminAuthMiddleware = (req, res, next) => {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers["authorization"];
  const bearerToken = authHeader && authHeader.split(" ")[1];

  // Check custom token header (for Gun/Wormhole compatibility)
  const customToken = req.headers["token"];

  // Accept either format
  const token = bearerToken || customToken;

  if (token === process.env.ADMIN_PASSWORD) {
    req.adminToken = token;
    next();
  } else {
    console.log("Admin auth failed - Bearer:", bearerToken, "Custom:", customToken);
    res.status(401).json({ success: false, error: "Unauthorized" });
  }
};

// Admin Notes Endpoints (Encrypted)
// GET /api/v1/notes - Get encrypted admin notes
router.get("/", adminAuthMiddleware, (req, res) => {
  try {
    const gun = getGunInstance(req);
    
    gun.get("shogun").get("admin_notes").once((data) => {
      res.json({
        success: true,
        notes: data || null,
        timestamp: Date.now(),
      });
    });
  } catch (error) {
    console.error("❌ Admin Notes GET error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// POST /api/v1/notes - Save encrypted admin notes
router.post("/", adminAuthMiddleware, (req, res) => {
  try {
    const { notes } = req.body;
    const gun = getGunInstance(req);
    
    if (!notes) {
      return res.status(400).json({
        success: false,
        error: "Notes content is required",
      });
    }

    gun.get("shogun").get("admin_notes").put(notes, (ack) => {
      if (ack && ack.err) {
        res.status(500).json({
          success: false,
          error: ack.err,
        });
      } else {
        res.json({
          success: true,
          message: "Admin notes saved successfully",
          timestamp: Date.now(),
        });
      }
    });
  } catch (error) {
    console.error("❌ Admin Notes POST error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// DELETE /api/v1/notes - Delete encrypted admin notes
router.delete("/", adminAuthMiddleware, (req, res) => {
  try {
    const gun = getGunInstance(req);
    
    gun.get("shogun").get("admin_notes").put(null, (ack) => {
      if (ack && ack.err) {
        res.status(500).json({
          success: false,
          error: ack.err,
        });
      } else {
        res.json({
          success: true,
          message: "Admin notes deleted successfully",
          timestamp: Date.now(),
        });
      }
    });
  } catch (error) {
    console.error("❌ Admin Notes DELETE error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Regular Notes Endpoints (Non-encrypted)
// Get notes endpoint
router.get("/regular", (req, res) => {
  try {
    const gun = getGunInstance(req);
    
    gun.get("shogun").get("notes").once((data) => {
      res.json({
        success: true,
        notes: data || {},
        timestamp: Date.now(),
      });
    });
  } catch (error) {
    console.error("❌ Notes GET error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Create note endpoint
router.post("/regular", (req, res) => {
  try {
    const { title, content, tags } = req.body;
    const gun = getGunInstance(req);
    
    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: "Title and content are required",
      });
    }

    const note = {
      id: Date.now().toString(),
      title,
      content,
      tags: tags || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    gun.get("shogun").get("notes").get(note.id).put(note, (ack) => {
      if (ack && ack.err) {
        res.status(500).json({
          success: false,
          error: ack.err,
        });
      } else {
        res.json({
          success: true,
          note,
          message: "Note created successfully",
          timestamp: Date.now(),
        });
      }
    });
  } catch (error) {
    console.error("❌ Notes POST error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Delete note endpoint
router.delete("/regular", (req, res) => {
  try {
    const { id } = req.body;
    const gun = getGunInstance(req);
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Note ID is required",
      });
    }

    gun.get("shogun").get("notes").get(id).put(null, (ack) => {
      if (ack && ack.err) {
        res.status(500).json({
          success: false,
          error: ack.err,
        });
      } else {
        res.json({
          success: true,
          message: "Note deleted successfully",
          id,
          timestamp: Date.now(),
        });
      }
    });
  } catch (error) {
    console.error("❌ Notes DELETE error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Update note endpoint
router.put("/regular/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, tags } = req.body;
    const gun = getGunInstance(req);
    
    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: "Title and content are required",
      });
    }

    // First get the existing note
    gun.get("shogun").get("notes").get(id).once((existingNote) => {
      if (!existingNote) {
        return res.status(404).json({
          success: false,
          error: "Note not found",
        });
      }

      const updatedNote = {
        ...existingNote,
        title,
        content,
        tags: tags || existingNote.tags || [],
        updatedAt: Date.now(),
      };

      gun.get("shogun").get("notes").get(id).put(updatedNote, (ack) => {
        if (ack && ack.err) {
          res.status(500).json({
            success: false,
            error: ack.err,
          });
        } else {
          res.json({
            success: true,
            note: updatedNote,
            message: "Note updated successfully",
            timestamp: Date.now(),
          });
        }
      });
    });
  } catch (error) {
    console.error("❌ Notes PUT error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get note by ID endpoint
router.get("/regular/:id", (req, res) => {
  try {
    const { id } = req.params;
    const gun = getGunInstance(req);
    
    gun.get("shogun").get("notes").get(id).once((note) => {
      if (!note) {
        return res.status(404).json({
          success: false,
          error: "Note not found",
        });
      }

      res.json({
        success: true,
        note,
        timestamp: Date.now(),
      });
    });
  } catch (error) {
    console.error("❌ Note GET error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router; 