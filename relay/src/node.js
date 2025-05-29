import Gun from 'gun'
const port = 8765

function hasValidToken (msg) {
  return msg && msg && msg.headers && msg.headers.token && msg.headers.token === 'automa25'
}

// Add listener
Gun.on('opt', function (ctx) {
  if (ctx.once) {
    return
  }
  // Check all incoming traffic
  ctx.on('in', function (msg) {
    console.log("msg",msg)
    const to = this.to
    // restrict put
    if (msg.put) {
      if (hasValidToken(msg)) {
        console.log('writing')
        to.next(msg)
      } else {
        console.log('not writing')
      }
    } else {
      to.next(msg)
    }
  })
})

import {createServer} from "http"

const server = createServer(Gun.serve('radata'))

const gun = Gun({
  file: 'data.json',
  web: server
})

// Sync everything
gun.on('out', { get: { '#': { '*': '' } } })

server.listen(port)

console.log('GUN server (restricted put) started on port 8000')
console.log('Use CTRL + C to stop it')