import express from 'express';
import rateLimit from 'express-rate-limit';

// Importa i moduli delle routes
import contractsRouter from './contracts.js';
import uploadsRouter from './uploads.js';
import ipfsRouter from './ipfs.js';
import systemRouter from './system.js';
import notesRouter from './notes.js';
import debugRouter from './debug.js';
import authRouter from './auth.js';
import usersRouter from './users.js';

// Rate limiting generale
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 1000, // massimo 1000 richieste per IP
  message: { 
    success: false, 
    message: 'Troppe richieste. Riprova tra 15 minuti.', 
    data: null 
  }
});

export default (app) => {
  // Configurazione generale delle route
  const baseRoute = '/api/v1';
  
  // Applica rate limiting generale
  app.use(generalLimiter);
  
  // Route di autenticazione
  app.use(`${baseRoute}/auth`, authRouter);
  
  // Route per la gestione utenti
  app.use(`${baseRoute}/users`, usersRouter);
  
  // Route per i contratti smart contract
  app.use(`${baseRoute}/contracts`, contractsRouter);
  
  // Route per gli upload degli utenti
  app.use(`${baseRoute}/user-uploads`, uploadsRouter);
  
  // Route per IPFS
  app.use(`${baseRoute}/ipfs`, ipfsRouter);
  
  // Route di sistema e debug
  app.use(`${baseRoute}/system`, systemRouter);
  
  // Route per le note
  app.use(`${baseRoute}/notes`, notesRouter);
  
  // Route di debug
  app.use(`${baseRoute}/debug`, debugRouter);
  
  // Route legacy per compatibilità
  app.use('/api/contracts', contractsRouter);
  app.use('/api/user-uploads', uploadsRouter);
  app.use('/api/ipfs', ipfsRouter);
  app.use('/api/system', systemRouter);
  app.use('/api/notes', notesRouter);
  app.use('/api/debug', debugRouter);
  
  // Route di health check
  app.get(`${baseRoute}/health`, (req, res) => {
    res.json({
      success: true,
      message: 'Shogun Relay API is running',
      data: {
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime()
      }
    });
  });
  
  // Route di default per API non trovate
  app.use(`${baseRoute}/*`, (req, res) => {
    res.status(404).json({
      success: false,
      message: 'API endpoint non trovato',
      data: {
        path: req.path,
        method: req.method,
        availableEndpoints: [
          `${baseRoute}/auth/register`,
          `${baseRoute}/auth/login`,
          `${baseRoute}/auth/forgot`,
          `${baseRoute}/auth/reset`,
          `${baseRoute}/auth/change-password`,
          `${baseRoute}/users/profile`,
          `${baseRoute}/users/:pubkey`,
          `${baseRoute}/contracts`,
          `${baseRoute}/contracts/config`,
          `${baseRoute}/contracts/:contractName`,
          `${baseRoute}/user-uploads/:identifier`,
          `${baseRoute}/ipfs/upload`,
          `${baseRoute}/ipfs/status`,
          `${baseRoute}/ipfs/content/:cid`,
          `${baseRoute}/system/health`,
          `${baseRoute}/system/stats`,
          `${baseRoute}/notes`,
          `${baseRoute}/debug/mb-usage/:userAddress`,
          `${baseRoute}/health`
        ]
      }
    });
  });
}; 