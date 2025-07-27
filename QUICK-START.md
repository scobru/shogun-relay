# Shogun Relay - Quick Start Guide 🚀

Get your Shogun Relay running with HTTPS in under 10 minutes!

## 📋 Prerequisites

- Docker Desktop or Docker Engine installed
- ngrok account (for HTTPS access)
- Terminal/Command prompt access

## 🌐 Option 1: HTTPS Setup with ngrok (Recommended for Development)

### Step 1: Get ngrok Endpoint

1. **Sign up/Login to ngrok**: Go to [ngrok.com](https://ngrok.com) and create an account
2. **Purchase a static endpoint** (or use free dynamic endpoint):
   - Navigate to `Endpoints` in your ngrok dashboard
   - Click `Create Endpoint` 
   - Choose your preferred region and subdomain
   - Note your endpoint URL (e.g., `https://your-subdomain.ngrok.io`)

### Step 2: Build and Start the Container

```bash
# Clone the repository (if not already done)
git clone https://github.com/your-org/shogun-relay.git
cd shogun-relay

# Run the quick-start script
./docker-start.sh

# The script will build the image, start the services, and show their status.
```

### Step 3: Setup ngrok Tunnel

```bash
# Install ngrok authtoken (get from your ngrok dashboard)
ngrok config add-authtoken YOUR_AUTHTOKEN_HERE

# Start ngrok tunnel pointing to your relay container
ngrok http 8765 --domain=your-subdomain.ngrok.io

# For free accounts (dynamic URL):
ngrok http 8765
```

### Step 4: Access Your Relay

🎉 **You're ready!** Your Shogun Relay is now accessible via HTTPS:

- **Relay Interface**: `https://your-subdomain.ngrok.io`
- **Gun.js Endpoint**: `https://your-subdomain.ngrok.io/gun`
- **API Endpoints**: `https://your-subdomain.ngrok.io/api/*`
- **Health Check**: `https://your-subdomain.ngrok.io/health`

## 🔐 New User Authentication APIs

The relay now includes a complete user authentication system with GunDB:

### Authentication Endpoints

```bash
# Register a new user
POST https://your-subdomain.ngrok.io/api/v1/auth/register
{
  "email": "user@example.com",
  "passphrase": "secure-password",
  "hint": "password-hint"
}

# Login user
POST https://your-subdomain.ngrok.io/api/v1/auth/login
{
  "email": "user@example.com", 
  "passphrase": "secure-password"
}

# Password recovery
POST https://your-subdomain.ngrok.io/api/v1/auth/forgot
{
  "email": "user@example.com",
  "hint": "password-hint"
}

# Reset password
POST https://your-subdomain.ngrok.io/api/v1/auth/reset
{
  "email": "user@example.com",
  "oldPassphrase": "temp-password",
  "newPassphrase": "new-secure-password"
}

# Change password
POST https://your-subdomain.ngrok.io/api/v1/auth/change-password
{
  "email": "user@example.com",
  "oldPassphrase": "current-password",
  "newPassphrase": "new-password"
}
```

### User Management Endpoints

```bash
# Get current user profile
GET https://your-subdomain.ngrok.io/api/v1/users
Headers: { "authorization": "user-pubkey" }

# Get specific user profile
GET https://your-subdomain.ngrok.io/api/v1/users/:pubkey

# Update user profile
PUT https://your-subdomain.ngrok.io/api/v1/users/profile
Headers: { "authorization": "user-pubkey" }
{
  "profile": {
    "name": "John Doe",
    "bio": "Developer"
  }
}

# Get user statistics
GET https://your-subdomain.ngrok.io/api/v1/users/stats/:pubkey
```

### Test Authentication APIs

```bash
# Health check
curl https://your-subdomain.ngrok.io/api/v1/health

# Register a test user
curl -X POST https://your-subdomain.ngrok.io/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","passphrase":"password123","hint":"test"}'

# Login with the user
curl -X POST https://your-subdomain.ngrok.io/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","passphrase":"password123"}'
```

## 🏠 Option 2: Local Development (HTTP Only)

For local testing without HTTPS:

```bash
# From the shogun-relay directory, run the start script
./docker-start.sh

# Access locally
open http://localhost:8765
```

## 🔧 Quick Configuration

### Set Admin Password

1. Open your relay interface: `https://your-subdomain.ngrok.io`
2. In the Control Panel, set your admin password
3. The password will auto-sync across all admin tools

### Test Your Setup

```bash
# Health check
curl https://your-subdomain.ngrok.io/health

# Basic stats
curl https://your-subdomain.ngrok.io/api/stats

# New authentication health check
curl https://your-subdomain.ngrok.io/api/v1/health
```

## 💡 Quick Tips

### For Development
- Use ngrok's free plan for testing (dynamic URLs)
- Keep the ngrok terminal window open
- Use `docker logs -f shogun-relay-stack` to monitor
- Test authentication APIs with tools like Postman or curl

### For Production
- Purchase ngrok static endpoint or use proper SSL certificates
- Configure environment variables for security
- Set up monitoring and backups
- Implement proper rate limiting for authentication endpoints

### Troubleshooting
- **Container not starting**: Check `docker logs shogun-relay-stack`
- **ngrok connection issues**: Verify your authtoken and account limits
- **Can't access interface**: Ensure port 8765 is exposed in Docker
- **Authentication errors**: Check rate limiting and GunDB connectivity

## 🌟 Next Steps

1. **Connect your app**: Use `https://your-subdomain.ngrok.io/gun` as your Gun.js peer
2. **Upload files**: Visit `/upload` to test IPFS storage
3. **Monitor performance**: Check `/stats` for real-time metrics
4. **Explore tools**: Try `/graph` for live data visualization
5. **Test authentication**: Use the new `/api/v1/auth/*` endpoints
6. **Manage users**: Explore user management APIs

## 📚 More Information

- **Full Documentation**: See [README.md](README.md) for complete feature list
- **API Reference**: Check the web interface for endpoint documentation
- **Configuration**: See environment variables in README.md
- **Authentication**: See [API_AUTHENTICATION.md](relay/API_AUTHENTICATION.md) for detailed auth docs

---

**Need help?** Check the logs with `docker logs shogun-relay-stack` or open an issue on GitHub.
