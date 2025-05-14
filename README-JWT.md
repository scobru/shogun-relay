# JWT Authentication Guide

This guide explains how to set up and use JWT authentication with your Shogun relay server.

## Environment Configuration

Create or update your `.env` file with the following settings:

```env
# API Configuration
PORT=8765
API_SECRET_TOKEN=thisIsTheTokenForReals
JWT_SECRET=use_a_secure_random_secret_here  # Generate a secure random string

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080

# Relay Configuration
RELAY_ENABLED=true
ONCHAIN_MEMBERSHIP_ENABLED=false  # Set to false to enable JWT token authentication
RELAY_REGISTRY_CONTRACT=0x0000000000000000000000000000000000000000
ETHEREUM_PROVIDER_URL=http://localhost:8545

# DID Verifier Configuration
DID_VERIFIER_ENABLED=true
DID_REGISTRY_CONTRACT=0x0000000000000000000000000000000000000000

# App Authentication
# Generate a key pair using SEA.pair() from Gun/SEA and paste the result here
APP_KEY_PAIR={"pub":"YOUR_PUBLIC_KEY","priv":"YOUR_PRIVATE_KEY","epub":"YOUR_EPUB","epriv":"YOUR_EPRIV"}

# Debug Settings
DEBUG_AUTH=false  # Set to true to see detailed auth debugging info
```

## Generating an APP_KEY_PAIR

You can generate an APP_KEY_PAIR using GunDB's SEA.pair() function. Here's a quick script to generate one:

```javascript
// generate-key-pair.js
import SEA from 'gun/sea';

async function generateKeyPair() {
  const pair = await SEA.pair();
  console.log('APP_KEY_PAIR=' + JSON.stringify(pair));
}

generateKeyPair();
```

Run it with:
```
node generate-key-pair.js
```

Then copy the output to your `.env` file.

## Usage Examples

### 1. JavaScript Client (Browser)

```javascript
import Gun from 'gun';

// Get JWT token from your login API
const token = 'your-jwt-token';

// Initialize Gun with JWT token
const gun = Gun({
  peers: ['http://localhost:8765/gun'],
  localStorage: false,
});

// Add outgoing middleware to include the token in all requests
gun.on("out", function(msg) {
  msg.headers = msg.headers || {};
  msg.headers.Authorization = `Bearer ${token}`;
  msg.headers.token = token;
  this.to.next(msg);
});

// Now you can use gun as usual
gun.get('my-data').put({ value: 'Hello JWT!' });
```

### 2. Node.js Client

```javascript
import Gun from 'gun';

// Get JWT token from your login API
const token = 'your-jwt-token';

// Initialize Gun with JWT token
const gun = Gun({
  peers: ['http://localhost:8765/gun'],
  localStorage: false,
});

// Add outgoing middleware to include the token in all requests
gun.on("out", function(msg) {
  msg.headers = msg.headers || {};
  msg.headers.Authorization = `Bearer ${token}`;
  msg.headers.token = token;
  this.to.next(msg);
});

// Now you can use gun as usual
gun.get('my-data').put({ value: 'Hello JWT!' }, (ack) => {
  if (ack.err) {
    console.error('Error:', ack.err);
  } else {
    console.log('Data saved successfully!');
  }
});
```

## Testing JWT Authentication

Run the included test script:

```
npm run test-jwt
```

This script will:
1. Register a new user or log in with existing credentials
2. Create and verify a JWT token
3. Test writing to Gun with JWT authentication
4. Verify the written data

## Troubleshooting

If authentication fails:

1. Check that `ONCHAIN_MEMBERSHIP_ENABLED` is set to `false` in your `.env` file
2. Verify the JWT token is valid and not expired
3. Check if the token is being passed correctly in both `token` and `Authorization` headers
4. Enable debugging with `DEBUG_AUTH=true` in your `.env` file

For help with APP_KEY_PAIR:

1. Make sure the APP_KEY_PAIR is properly formatted as valid JSON
2. Verify that the server is authenticating as the app user on startup
3. Check that the pub key in the message matches the APP_KEY_PAIR pub key 