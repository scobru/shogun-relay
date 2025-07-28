import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Get the public path
const publicPath = path.resolve(__dirname, '../public');

// Main visual graph interface
router.get('/', (req, res) => {
  console.log('📊 Visual Graph route accessed');
  const filePath = path.resolve(publicPath, 'visualGraph/visualGraph.html');
  console.log('📊 Serving visualGraph.html from:', filePath);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    console.error('📊 Visual Graph HTML not found:', filePath);
    res.status(404).send('Visual Graph interface not found');
  }
});

// Serve specific static files first
router.get('/visualGraph.js', (req, res) => {
  const filePath = path.resolve(publicPath, 'visualGraph/visualGraph.js');
  console.log('📊 Serving visualGraph.js from:', filePath);
  
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(filePath);
  } else {
    console.error('📊 visualGraph.js not found:', filePath);
    res.status(404).send('visualGraph.js not found');
  }
});

router.get('/abstraction.js', (req, res) => {
  const filePath = path.resolve(publicPath, 'visualGraph/abstraction.js');
  console.log('📊 Serving abstraction.js from:', filePath);
  
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(filePath);
  } else {
    console.error('📊 abstraction.js not found:', filePath);
    res.status(404).send('abstraction.js not found');
  }
});

router.get('/vGmain.css', (req, res) => {
  const filePath = path.resolve(publicPath, 'visualGraph/vGmain.css');
  console.log('📊 Serving vGmain.css from:', filePath);
  
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'text/css');
    res.sendFile(filePath);
  } else {
    console.error('📊 vGmain.css not found:', filePath);
    res.status(404).send('vGmain.css not found');
  }
});

router.get('/visualGraphIcon.svg', (req, res) => {
  const filePath = path.resolve(publicPath, 'visualGraph/visualGraphIcon.svg');
  console.log('📊 Serving visualGraphIcon.svg from:', filePath);
  
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.sendFile(filePath);
  } else {
    console.error('📊 visualGraphIcon.svg not found:', filePath);
    res.status(404).send('visualGraphIcon.svg not found');
  }
});

// Catch-all route for other static files
router.get('/*', (req, res) => {
  const requestedPath = req.path;
  const filePath = path.resolve(publicPath, 'visualGraph' + requestedPath);
  
  console.log('📊 Visual Graph static file requested:', requestedPath);
  console.log('📊 Resolved file path:', filePath);
  
  if (fs.existsSync(filePath)) {
    console.log('📊 File found, serving:', filePath);
    
    // Set appropriate MIME types
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.html': 'text/html',
      '.json': 'application/json'
    };
    
    if (mimeTypes[ext]) {
      res.setHeader('Content-Type', mimeTypes[ext]);
    }
    
    res.sendFile(filePath);
  } else {
    console.log('📊 File not found:', filePath);
    res.status(404).send('File not found: ' + requestedPath);
  }
});

export default router; 