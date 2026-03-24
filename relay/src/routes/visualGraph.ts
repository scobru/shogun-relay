import express, { Request, Response, Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { loggers } from "../utils/logger";
const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);

const router: Router = express.Router();

// Get the public path
const publicPath: string = path.resolve(__dirname, "../public");

// Main visual graph interface
router.get("/", async (req: Request, res: Response): Promise<void> => {
  loggers.visualGraph.info("Visual Graph route accessed");
  const filePath: string = path.resolve(publicPath, "visualGraph/visualGraph.html");
  loggers.visualGraph.info({ filePath }, "Serving visualGraph.html");

  const exists = await fs.promises
    .access(filePath)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    res.sendFile(filePath);
  } else {
    loggers.visualGraph.error({ filePath }, "Visual Graph HTML not found");
    res.status(404).send("Visual Graph interface not found");
  }
});

// Serve specific static files first
router.get("/visualGraph.js", async (req: Request, res: Response): Promise<void> => {
  const filePath: string = path.resolve(publicPath, "visualGraph/visualGraph.js");
  loggers.visualGraph.info({ filePath }, "Serving visualGraph.js");

  const exists = await fs.promises
    .access(filePath)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    res.setHeader("Content-Type", "application/javascript");
    res.sendFile(filePath);
  } else {
    loggers.visualGraph.error({ filePath }, "visualGraph.js not found");
    res.status(404).send("visualGraph.js not found");
  }
});

router.get("/abstraction.js", async (req: Request, res: Response): Promise<void> => {
  const filePath: string = path.resolve(publicPath, "visualGraph/abstraction.js");
  loggers.visualGraph.info({ filePath }, "Serving abstraction.js");

  const exists = await fs.promises
    .access(filePath)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    res.setHeader("Content-Type", "application/javascript");
    res.sendFile(filePath);
  } else {
    loggers.visualGraph.error({ filePath }, "abstraction.js not found");
    res.status(404).send("abstraction.js not found");
  }
});

router.get("/vGmain.css", async (req: Request, res: Response): Promise<void> => {
  const filePath: string = path.resolve(publicPath, "visualGraph/vGmain.css");
  loggers.visualGraph.info({ filePath }, "Serving vGmain.css");

  const exists = await fs.promises
    .access(filePath)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    res.setHeader("Content-Type", "text/css");
    res.sendFile(filePath);
  } else {
    loggers.visualGraph.error({ filePath }, "vGmain.css not found");
    res.status(404).send("vGmain.css not found");
  }
});

router.get("/visualGraphIcon.svg", async (req: Request, res: Response): Promise<void> => {
  const filePath: string = path.resolve(publicPath, "visualGraph/visualGraphIcon.svg");
  loggers.visualGraph.info({ filePath }, "Serving visualGraphIcon.svg");

  const exists = await fs.promises
    .access(filePath)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    res.setHeader("Content-Type", "image/svg+xml");
    res.sendFile(filePath);
  } else {
    loggers.visualGraph.error({ filePath }, "visualGraphIcon.svg not found");
    res.status(404).send("visualGraphIcon.svg not found");
  }
});

// Catch-all route for other static files
router.get("/*", async (req: Request, res: Response): Promise<void> => {
  const requestedPath: string = req.path;
  const filePath: string = path.resolve(publicPath, "visualGraph" + requestedPath);

  loggers.visualGraph.info({ requestedPath }, "Visual Graph static file requested");
  loggers.visualGraph.info({ filePath }, "Resolved file path");

  // Prevent path traversal attacks
  const targetDir = path.resolve(publicPath, "visualGraph");
  if (!filePath.startsWith(targetDir + path.sep) && filePath !== targetDir) {
    loggers.visualGraph.warn({ requestedPath, filePath }, "Path traversal attempt blocked");
    res.status(403).send("Forbidden");
    return;
  }

  const exists = await fs.promises
    .access(filePath)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    loggers.visualGraph.info({ filePath }, "File found, serving");

    // Set appropriate MIME types
    const ext: string = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".js": "application/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".html": "text/html",
      ".json": "application/json",
    };

    if (mimeTypes[ext]) {
      res.setHeader("Content-Type", mimeTypes[ext]);
    }

    res.sendFile(filePath);
  } else {
    loggers.visualGraph.info({ filePath }, "File not found");
    res.status(404).send("File not found: " + requestedPath);
  }
});

export default router;
