import express from 'express';

const router = express.Router();

// Middleware per ottenere l'istanza Gun dal relay
const getGunInstance = (req) => {
  return req.app.get('gunInstance');
};

// Get notes endpoint
router.get("/", (req, res) => {
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
router.post("/", (req, res) => {
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
router.delete("/", (req, res) => {
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
router.put("/:id", (req, res) => {
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
router.get("/:id", (req, res) => {
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