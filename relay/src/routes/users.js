const router = require('express').Router()
const rateLimit = require('express-rate-limit')

// Rate limiting per le route utenti
const userLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 100, // massimo 100 richieste per IP
  message: { 
    success: false, 
    message: 'Troppe richieste. Riprova tra 15 minuti.', 
    data: null 
  }
})

// Middleware per ottenere l'istanza Gun dal relay
const getGunInstance = (req) => {
  return req.app.get('gunInstance')
}

// Middleware per verificare l'autorizzazione
const getUserByPubKey = (pubkey, callback) => {
  try {
    const gun = getGunInstance({ app: { get: () => gun } })
    gun.user(pubkey).once(data => {
      if (!data) {
        return callback(null, {
          status: 403,
          success: false,
          message: 'Non hai i permessi sufficienti per eseguire questa azione',
          data: null,
        })
      }

      delete data._
      delete data.auth
      delete data.profile
      return callback(null, { status: 200, success: true, message: null, data })
    })
  } catch (error) {
    return callback(error, null)
  }
}

// Route per ottenere il profilo utente corrente
router.get('/', userLimiter, (req, res) => {
  const { authorization } = req.headers
  
  if (!authorization) {
    return res.status(400).json({ 
      success: false, 
      message: 'Header di autorizzazione richiesto', 
      data: null 
    })
  }
  
  getUserByPubKey(authorization, (err, result) => {
    if (err) {
      return res.status(500).json({ 
        status: 500, 
        success: false, 
        message: err, 
        data: null 
      })
    }
    return res.status(result.status).json(result)
  })
})

// Route per ottenere il profilo di un utente specifico
router.get('/:pubkey', userLimiter, (req, res) => {
  const { pubkey } = req.params
  
  if (!pubkey) {
    return res.status(400).json({ 
      success: false, 
      message: 'Parametro pubkey richiesto', 
      data: null 
    })
  }
  
  getUserByPubKey(pubkey, (err, result) => {
    if (err) {
      return res.status(500).json({ 
        status: 500, 
        success: false, 
        message: err, 
        data: null 
      })
    }
    return res.status(result.status).json(result)
  })
})

// Route per aggiornare il profilo utente
router.put('/profile', userLimiter, (req, res) => {
  const { authorization } = req.headers
  const { profile } = req.body
  
  if (!authorization) {
    return res.status(400).json({ 
      success: false, 
      message: 'Header di autorizzazione richiesto', 
      data: null 
    })
  }
  
  if (!profile) {
    return res.status(400).json({ 
      success: false, 
      message: 'Dati profilo richiesti', 
      data: null 
    })
  }

  const gun = getGunInstance(req)
  const user = gun.user().recall({ sessionStorage: false })

  // Verifica che l'utente sia autenticato
  if (!user.is) {
    return res.status(401).json({ 
      success: false, 
      message: 'Utente non autenticato', 
      data: null 
    })
  }

  // Aggiorna il profilo
  user.get('profile').put(profile, ack => {
    if (ack && ack.err) {
      return res.status(400).json({ 
        success: false, 
        message: ack.err, 
        data: null 
      })
    }
    
    return res.status(200).json({ 
      success: true, 
      message: 'Profilo aggiornato con successo', 
      data: profile 
    })
  })
})

// Route per ottenere le statistiche utente
router.get('/stats/:pubkey', userLimiter, (req, res) => {
  const { pubkey } = req.params
  
  if (!pubkey) {
    return res.status(400).json({ 
      success: false, 
      message: 'Parametro pubkey richiesto', 
      data: null 
    })
  }

  const gun = getGunInstance(req)

  // Recupera le statistiche utente dal database
  gun.get(`users/${pubkey}/stats`).once(stats => {
    if (!stats) {
      return res.status(404).json({ 
        success: false, 
        message: 'Statistiche utente non trovate', 
        data: null 
      })
    }

    delete stats._
    
    return res.status(200).json({ 
      success: true, 
      message: 'Statistiche recuperate con successo', 
      data: stats 
    })
  })
})

// Route per ottenere la lista degli utenti (solo per admin)
router.get('/list/all', userLimiter, (req, res) => {
  const { authorization } = req.headers
  
  if (!authorization) {
    return res.status(400).json({ 
      success: false, 
      message: 'Header di autorizzazione richiesto', 
      data: null 
    })
  }

  // TODO: Implementare verifica admin
  // Per ora restituiamo un messaggio di sviluppo
  return res.status(500).json({ 
    success: false, 
    message: 'Funzionalità in sviluppo', 
    data: null 
  })
})

module.exports = router 