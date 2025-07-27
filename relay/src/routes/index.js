const rateLimit = require('express-rate-limit')

// Rate limiting generale
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 1000, // massimo 1000 richieste per IP
  message: { 
    success: false, 
    message: 'Troppe richieste. Riprova tra 15 minuti.', 
    data: null 
  }
})

module.exports = (app) => {
  // Configurazione generale delle route
  const baseRoute = '/api/v1'
  
  // Route di autenticazione
  app.use(`${baseRoute}/auth`, require('./auth'))
  
  // Route per la gestione utenti
  app.use(`${baseRoute}/users`, require('./users'))
  
  // Route per la gestione file IPFS (esistenti)
  app.use(`${baseRoute}/ipfs`, (req, res, next) => {
    // Reindirizza le route IPFS esistenti
    if (req.path.startsWith('/upload')) {
      req.url = req.url.replace('/ipfs/upload', '/ipfs-upload')
    }
    next()
  })
  
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
    })
  })
  
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
          `${baseRoute}/health`
        ]
      }
    })
  })
} 