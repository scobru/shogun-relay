import express from 'express';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limiting per le route utenti
const userLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 100, // massimo 100 richieste per IP
  message: { 
    success: false, 
    message: 'Troppe richieste. Riprova tra 15 minuti.', 
    data: null 
  }
});

// Middleware per ottenere l'istanza Gun dal relay
const getGunInstance = (req) => {
  return req.app.get('gunInstance');
};

// Route per ottenere il profilo utente
router.get('/profile', userLimiter, (req, res) => {
  const gun = getGunInstance(req);
  const user = gun.user().recall({ sessionStorage: false });

  if (!user._.sea) {
    return res.status(401).json({ 
      success: false, 
      message: 'Utente non autenticato', 
      data: null 
    });
  }

  user.get('profile').once(profile => {
    if (profile && profile._) {
      delete profile._;
    }
    
    return res.status(200).json({ 
      success: true, 
      message: 'Profilo recuperato con successo', 
      data: {
        pub: user._.sea.pub,
        epub: user._.sea.epub,
        profile: profile || {}
      }
    });
  });
});

// Route per aggiornare il profilo utente
router.put('/profile', userLimiter, (req, res) => {
  const { profile } = req.body;
  
  if (!profile) {
    return res.status(400).json({ 
      success: false, 
      message: 'Dati profilo richiesti', 
      data: null 
    });
  }

  const gun = getGunInstance(req);
  const user = gun.user().recall({ sessionStorage: false });

  if (!user._.sea) {
    return res.status(401).json({ 
      success: false, 
      message: 'Utente non autenticato', 
      data: null 
    });
  }

  user.get('profile').put(profile, ack => {
    if (ack && ack.err) {
      return res.status(400).json({ 
        success: false, 
        message: ack.err, 
        data: null 
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Profilo aggiornato con successo', 
      data: {
        profile: profile
      }
    });
  });
});

// Route per ottenere un utente specifico tramite pubkey
router.get('/:pubkey', userLimiter, (req, res) => {
  const { pubkey } = req.params;
  
  if (!pubkey) {
    return res.status(400).json({ 
      success: false, 
      message: 'Pubkey richiesta', 
      data: null 
    });
  }

  const gun = getGunInstance(req);
  
  gun.user(pubkey).get('profile').once(profile => {
    if (profile && profile._) {
      delete profile._;
    }
    
    return res.status(200).json({ 
      success: true, 
      message: 'Utente recuperato con successo', 
      data: {
        pubkey: pubkey,
        profile: profile || {}
      }
    });
  });
});

// Route per cercare utenti
router.get('/search/:query', userLimiter, (req, res) => {
  const { query } = req.params;
  
  if (!query) {
    return res.status(400).json({ 
      success: false, 
      message: 'Query di ricerca richiesta', 
      data: null 
    });
  }

  const gun = getGunInstance(req);
  
  // Per ora restituiamo un array vuoto
  // In un'implementazione reale, qui implementeresti la ricerca
  return res.status(200).json({ 
    success: true, 
    message: 'Ricerca completata', 
    data: {
      query: query,
      results: [],
      count: 0
    }
  });
});

// Route per ottenere la lista degli utenti (limitata)
router.get('/', userLimiter, (req, res) => {
  const gun = getGunInstance(req);
  
  // Per ora restituiamo un array vuoto
  // In un'implementazione reale, qui implementeresti la lista utenti
  return res.status(200).json({ 
    success: true, 
    message: 'Lista utenti recuperata', 
    data: {
      users: [],
      count: 0
    }
  });
});

export default router; 