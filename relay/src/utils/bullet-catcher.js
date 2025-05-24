import Gun from "gun";
import isFn from "is-fn";

// Add listener
Gun.on('opt', function (context) {
  if (context.once) {
    return
  }
  // Pass to subsequent opt handlers
  this.to.next(context)

  const { isValid } = context.opt

  if (!isValid) {
    throw new Error('you must pass in an isValid function')
  }

  if (!isFn(isValid)) {
    throw new Error('isValid must be a function')
  }

  // Check all incoming traffic
  context.on('in', function (msg) {
    var to = this.to
    // restrict put
    if (msg.put) {
      let result
      try {
        // isValid deve ora essere una funzione sincrona
        result = isValid(msg)
        if (result) {
          to.next(msg)
        }
      } catch (e) {
        console.error("Error in message validation:", e)
        result = false
      }
      // Se non autorizzato, il messaggio viene bloccato (non chiamare to.next)
    } else {
      to.next(msg)
    }
  })
})

export default Gun;