const router = require('express').Router()
const rateLimit = require('express-rate-limit')

// Rate limiting per le route di autenticazione
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 5, // massimo 5 tentativi per IP
  message: { 
    success: false, 
    message: 'Troppi tentativi di accesso. Riprova tra 15 minuti.', 
    data: null 
  }
})

// Middleware per ottenere l'istanza Gun dal relay
const getGunInstance = (req) => {
  return req.app.get('gunInstance')
}

// Utility per la crittografia (se necessario)
const util = {
  encrypt: (text) => {
    // Implementazione base - in produzione usare una libreria di crittografia
    return Buffer.from(text).toString('base64')
  },
  decrypt: (text) => {
    return Buffer.from(text, 'base64').toString('utf8')
  },
  randomPassword: () => {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  }
}

// Route per la registrazione utente
router.post('/register', authLimiter, (req, res) => {
  const { email, passphrase, hint } = req.body
  
  if (!email || !passphrase) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email e passphrase sono richiesti', 
      data: null 
    })
  }

  const gun = getGunInstance(req)
  const user = gun.user().recall({ sessionStorage: false })

  user.create(email, passphrase, ack => {
    if (ack && ack.err) {
      return res.status(400).json({ 
        success: false, 
        message: ack.err, 
        data: null 
      })
    }

    // Login automatico dopo la registrazione
    user.auth(email, passphrase, ack => {
      if (ack && ack.err) {
        return res.status(400).json({ 
          success: false, 
          message: ack.err, 
          data: null 
        })
      }

      // Crea il profilo utente
      const data = ack.sea
      data.profile = { email, hint }
      
      user.get('profile').put(data.profile, ack => {
        if (ack && ack.err) {
          return res.status(400).json({ 
            success: false, 
            message: ack.err, 
            data: null 
          })
        }

        // Salva i dati utente nel database Gun
        const userProfile = { 
          email, 
          hint: util.encrypt(hint), 
          pwd: util.encrypt(passphrase) 
        }
        
        gun.get(`users/${email}`).put(userProfile, ack => {
          if (ack && ack.err) {
            return res.status(400).json({ 
              success: false, 
              message: ack.err, 
              data: null 
            })
          }
          
          return res.status(201).json({ 
            success: true, 
            message: 'Utente creato con successo', 
            data: {
              userPub: data.pub,
              email: email,
              profile: data.profile
            }
          })
        })
      })
    })
  })
})

// Route per il login
router.post('/login', authLimiter, (req, res) => {
  const { email, passphrase } = req.body
  
  if (!email || !passphrase) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email e passphrase sono richiesti', 
      data: null 
    })
  }

  const gun = getGunInstance(req)
  const user = gun.user().recall({ sessionStorage: false })

  user.leave() // Logout da eventuali sessioni precedenti
  
  user.auth(email, passphrase, ack => {
    if (ack && ack.err) {
      return res.status(400).json({ 
        success: false, 
        message: ack.err, 
        data: null 
      })
    }

    const data = ack.sea
    
    // Recupera il profilo utente
    user.get('profile').once(profile => {
      if (profile && profile._) {
        delete profile._
      }
      
      data.profile = profile || { email }
      
      return res.status(200).json({ 
        success: true, 
        message: 'Login effettuato con successo', 
        data: {
          userPub: data.pub,
          email: email,
          profile: data.profile
        }
      })
    })
  })
})

// Route per il recupero password
router.post('/forgot', authLimiter, (req, res) => {
  const { email, hint } = req.body
  
  if (!email || !hint) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email e hint sono richiesti', 
      data: null 
    })
  }

  const gun = getGunInstance(req)

  gun.get(`users/${email}`).once(data => {
    if (!data) {
      return res.status(400).json({ 
        success: false, 
        message: 'Utente non trovato', 
        data: null 
      })
    }
    
    if (util.decrypt(data.hint) !== hint) {
      return res.status(400).json({ 
        success: false, 
        message: 'Hint di recupero non corretto', 
        data: null 
      })
    }

    delete data._
    data.temp = util.randomPassword()

    gun.get(`users/${email}`).put(data, ack => {
      if (ack && ack.err) {
        return res.status(400).json({ 
          success: false, 
          message: ack.err, 
          data: null 
        })
      }
      
      return res.status(200).json({ 
        success: true, 
        message: 'Password temporanea generata', 
        data: { tempPassword: data.temp }
      })
    })
  })
})

// Route per il reset password
router.post('/reset', authLimiter, (req, res) => {
  const { email, oldPassphrase, newPassphrase } = req.body
  
  if (!email || !oldPassphrase || !newPassphrase) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email, vecchia e nuova passphrase sono richiesti', 
      data: null 
    })
  }

  const gun = getGunInstance(req)
  const user = gun.user().recall({ sessionStorage: false })

  gun.get(`users/${email}`).once(data => {
    if (!data) {
      return res.status(400).json({ 
        success: false, 
        message: 'Utente non trovato', 
        data: null 
      })
    }
    
    if (data.temp.toString().trim() !== oldPassphrase.toString().trim()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Password temporanea non corretta', 
        data: null 
      })
    }

    delete data._
    const pwd = util.decrypt(data.pwd)

    user.auth(email, pwd.toString().trim(), ack => {
      if (ack && ack.err) {
        return res.status(400).json({ 
          success: false, 
          message: ack.err, 
          data: null 
        })
      }

      delete data.temp
      data.pwd = util.encrypt(newPassphrase)
      
      gun.get(`users/${email}`).put(data, ack => {
        if (ack && ack.err) {
          return res.status(400).json({ 
            success: false, 
            message: ack.err, 
            data: null 
          })
        }
        
        return res.status(200).json({ 
          success: true, 
          message: 'Password reimpostata con successo', 
          data: null 
        })
      })
    }, { change: newPassphrase })
  })
})

// Route per il cambio password
router.post('/change-password', authLimiter, (req, res) => {
  const { email, oldPassphrase, newPassphrase } = req.body
  
  if (!email || !oldPassphrase || !newPassphrase) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email, vecchia e nuova passphrase sono richiesti', 
      data: null 
    })
  }

  const gun = getGunInstance(req)
  const user = gun.user().recall({ sessionStorage: false })

  user.auth(email, oldPassphrase, ack => {
    if (ack && ack.err) {
      return res.status(400).json({ 
        success: false, 
        message: ack.err, 
        data: null 
      })
    }

    const data = { 
      email, 
      pwd: util.encrypt(newPassphrase) 
    }
    
    gun.get(`users/${email}`).put(data, ack => {
      if (ack && ack.err) {
        return res.status(400).json({ 
          success: false, 
          message: ack.err, 
          data: null 
        })
      }
      
      return res.status(200).json({ 
        success: true, 
        message: 'Password cambiata con successo', 
        data: null 
      })
    })
  }, { change: newPassphrase })
})

// Route per la cancellazione account
router.delete('/unregister', authLimiter, (req, res) => {
  const { email, passphrase } = req.body
  
  if (!email || !passphrase) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email e passphrase sono richiesti', 
      data: null 
    })
  }

  const gun = getGunInstance(req)
  const user = gun.user().recall({ sessionStorage: false })

  user.auth(email, passphrase, ack => {
    if (ack && ack.err) {
      return res.status(400).json({ 
        success: false, 
        message: ack.err, 
        data: null 
      })
    }

    // Per ora restituiamo un messaggio di sviluppo
    return res.status(500).json({ 
      success: false, 
      message: 'Funzionalità in sviluppo', 
      data: null 
    })
    
    // TODO: Implementare la cancellazione account
    // user.delete(email, passphrase, ack => {
    //   if (ack && ack.err) {
    //     return res.status(400).json({ 
    //       success: false, 
    //       message: ack.err, 
    //       data: null 
    //     })
    //   }
    //   return res.status(200).json({ 
    //     success: true, 
    //     message: 'Account cancellato con successo', 
    //     data: null 
    //   })
    // })
  })
})

module.exports = router 