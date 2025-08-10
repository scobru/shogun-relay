import Gun from 'gun/gun.js'
import isFn from 'is-fn'

// Add listener
Gun.on('opt', function (context) {
    if (context.once) {
      return
    }
    // Pass to subsequent opt handlers
    this.to.next(context)
  
    const { isValid } = context.opt
  
    if (typeof isValid !== 'function') {
      throw new Error('you must pass in an isValid function')
    }
  
    // Check all incoming traffic
    context.on('in', function (msg) {
      var to = this.to
      // restrict put
      if (msg.put) {
        const isValidMsg = isValid(msg)
  
        if (isValidMsg instanceof Error) {
          context.on('in', { '@': msg['#'], err: isValidMsg.message })
        } else {
          if (isValidMsg) {
            to.next(msg)
          }
        }
      } else {
        to.next(msg)
      }
    })
  })

export default Gun