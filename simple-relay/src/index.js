import Gun from 'gun'
const port = 8000

function hasValidToken(msg) {
  return msg && msg.headers && msg.headers.token && msg.headers.token === 'automa25'
}

// Helper functions to identify message types
function isAuthOperation(msg) {
  // Auth operations typically involve user credentials
  if (msg.put) {
    const keys = Object.keys(msg.put)

    // Check for user alias patterns (e.g., ~@_newman)
    for (const key of keys) {
      // User aliases start with ~@_
      if (key.startsWith('~@_')) {
        console.log('ALLOWING: Auth operation with user alias:', key)
        return true
      }

      // Public keys in Gun often start with ~ or contain a dot
      if ((key.startsWith('~') || key.includes('.')) && msg.put[key]) {
        // Check for auth data
        const data = msg.put[key]
        if (data && (data.auth || data.alias || data.epub || data.pub)) {
          console.log('ALLOWING: Auth operation with credentials')
          return true
        }
      }
    }
  }

  return false
}

function isInternalOperation(msg) {
  // Check for internal operations that don't need authentication
  if (msg.put) {
    // Messages with # properties are often system messages
    if (msg['#'] && msg['#'].startsWith('test_key_')) {
      return true // Test keys are internal
    }

    // Check if this is a radisk/storage sync operation
    const keys = Object.keys(msg.put)
    for (const key of keys) {
      // System keys or collections
      if (key.startsWith('_') || key === 'users') {
        return true
      }

      // User public keys that aren't carrying credentials
      // but just usernames or metadata
      if (key.includes('.') && msg.put[key] && msg.put[key].username) {
        console.log('ALLOWING: User metadata update')
        return true
      }
    }
  }

  return false
}

// Add listener
Gun.on('opt', function (ctx) {
  if (ctx.once) {
    return
  }

  // Check all incoming traffic
  ctx.on('in', function (msg) {
    const to = this.to

    // Allow all operations that aren't PUTs
    if (!msg.put) {
      if (msg.get) {
        console.log('GET operation:', JSON.stringify(msg.get).slice(0, 100) + '...')
      }
      to.next(msg)
      return
    }

    // For PUT operations, apply token validation logic
    if (hasValidToken(msg)) {
      console.log('WRITING - Valid token found')
      to.next(msg)
      return
    }

    // Allow auth operations without token
    if (isAuthOperation(msg)) {
      console.log('WRITING - Auth operation allowed without token')
      to.next(msg)
      return
    }

    // Allow certain internal operations without token
    if (isInternalOperation(msg)) {
      console.log('WRITING - Internal operation allowed without token')
      to.next(msg)
      return
    }

    // Block everything else
    console.log('BLOCKED - PUT without valid token:', JSON.stringify(msg.put).slice(0, 100) + '...')
    // Don't forward unauthorized puts
  })
})

import { createServer } from "http"

const server = createServer(Gun.serve("data.json"))

const gun = Gun({
  web: server,
  peers: ['http://localhost:8000/gun', 'http://localhost:8765/gun'],
  s3: { 
    bucket: 'test-bucket3',
    region: 'us-east-1',
    accessKeyId: 'S3RVER',
    secretAccessKey: 'S3RVER',
    endpoint: 'http://0.0.0.0:4569',
    s3ForcePathStyle: true,
    address: '0.0.0.0',
    port: 4569,
    key: 'S3RVER',
    secret: 'S3RVER',
  }
})

  // Sync everything
gun.on('out', { get: { '#': { '*': '' } } })

server.listen(port)

console.log('GUN server (restricted put) started on port 8000')
console.log('Use CTRL + C to stop it')