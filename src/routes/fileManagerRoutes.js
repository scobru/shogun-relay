import express from "express";

export default function setupFileManagerRoutes(fileManager, authenticateRequestMiddleware) {
  const router = express.Router();

  // Get all files (route unificata)
  router.get("/", authenticateRequestMiddleware, async (req, res) => {
    try {
      const files = await fileManager.getAllFiles();
      res.json({
        success: true,
        files: files,
        message: "Files retrieved successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        message: "Error retrieving files",
      });
    }
  });

  // Get file by ID
  router.get("/:id", authenticateRequestMiddleware, async (req, res) => {
    try {
      const fileId = req.params.id;
      const fileData = await fileManager.getFileById(fileId);

      if (fileData) {
        res.json({
          success: true,
          file: fileData
        });
      } else {
        res.status(404).json({ 
          success: false,
          error: "File not found" 
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        message: "Error retrieving file details"
      });
    }
  });

  // Delete file
  router.delete("/:id", authenticateRequestMiddleware, async (req, res) => {
    try {
      const fileId = req.params.id;
      const result = await fileManager.deleteFile(fileId);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        message: "Error deleting file"
      });
    }
  });
  
  // Upload file
  router.post("/upload", authenticateRequestMiddleware, (req, res) => {
    const uploadMiddleware = fileManager.getUploadMiddleware().single("file");
    
    uploadMiddleware(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          error: err.message,
          message: "File upload failed"
        });
      }
      
      try {
        // Handle situation where no file or content was provided
        if (!req.file && (!req.body.content || !req.body.contentType)) {
          return res.status(400).json({
            success: false,
            error: "No file or content provided",
            message: "File upload failed"
          });
        }
        
        const fileData = await fileManager.handleFileUpload(req);
        
        res.json({
          success: true,
          file: fileData,
          message: "File uploaded successfully"
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
          message: "Error processing file upload"
        });
      }
    });
  });
  
  // Upload file content (direct content, not multipart)
  router.post("/upload/content", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { content, contentType, fileName } = req.body;
      
      if (!content) {
        return res.status(400).json({
          success: false,
          error: "Content is required",
          message: "Content upload failed"
        });
      }
      
      // Create a request-like object with the content
      const requestObj = {
        body: {
          content: content,
          contentType: contentType || "text/plain",
          customName: fileName
        }
      };
      
      const fileData = await fileManager.handleFileUpload(requestObj);
      
      res.json({
        success: true,
        file: fileData,
        message: "Content uploaded successfully"
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        message: "Error processing content upload"
      });
    }
  });

  return router;
} 