# Shogun Relay - Authentication API Documentation

Complete documentation for the user authentication and management APIs.

## Overview

The Shogun Relay includes a comprehensive user authentication system built on GunDB, providing decentralized user management with secure authentication, password recovery, and profile management.

## Base URL

All API endpoints are prefixed with `/api/v1`

## Authentication Endpoints

### Register User

Creates a new user account with email and passphrase.

**Endpoint:** `POST /api/v1/auth/register`

**Request Body:**
```json
{
  "email": "user@example.com",
  "passphrase": "secure-password",
  "hint": "password-hint"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "userPub": "user-public-key",
    "email": "user@example.com",
    "profile": {
      "email": "user@example.com",
      "hint": "password-hint"
    }
  }
}
```

**Error Response (400 Bad Request):**
```json
{
  "success": false,
  "message": "Email and passphrase are required",
  "data": null
}
```

### Login User

Authenticates a user with email and passphrase.

**Endpoint:** `POST /api/v1/auth/login`

**Request Body:**
```json
{
  "email": "user@example.com",
  "passphrase": "secure-password"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "userPub": "user-public-key",
    "email": "user@example.com",
    "profile": {
      "email": "user@example.com",
      "hint": "password-hint"
    }
  }
}
```

**Error Response (400 Bad Request):**
```json
{
  "success": false,
  "message": "Invalid credentials",
  "data": null
}
```

### Password Recovery

Initiates password recovery using email and hint.

**Endpoint:** `POST /api/v1/auth/forgot`

**Request Body:**
```json
{
  "email": "user@example.com",
  "hint": "password-hint"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Temporary password generated",
  "data": {
    "tempPassword": "generated-temp-password"
  }
}
```

**Error Response (400 Bad Request):**
```json
{
  "success": false,
  "message": "User not found or hint incorrect",
  "data": null
}
```

### Reset Password

Resets password using temporary password.

**Endpoint:** `POST /api/v1/auth/reset`

**Request Body:**
```json
{
  "email": "user@example.com",
  "oldPassphrase": "temp-password",
  "newPassphrase": "new-secure-password"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Password reset successfully",
  "data": null
}
```

**Error Response (400 Bad Request):**
```json
{
  "success": false,
  "message": "Temporary password incorrect",
  "data": null
}
```

### Change Password

Changes password for authenticated users.

**Endpoint:** `POST /api/v1/auth/change-password`

**Request Body:**
```json
{
  "email": "user@example.com",
  "oldPassphrase": "current-password",
  "newPassphrase": "new-password"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Password changed successfully",
  "data": null
}
```

**Error Response (400 Bad Request):**
```json
{
  "success": false,
  "message": "Current password incorrect",
  "data": null
}
```

## User Management Endpoints

### Get Current User Profile

Retrieves the profile of the currently authenticated user.

**Endpoint:** `GET /api/v1/users`

**Headers:**
```
Authorization: user-public-key
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": null,
  "data": {
    "pub": "user-public-key",
    "alias": "user@example.com"
  }
}
```

**Error Response (401 Unauthorized):**
```json
{
  "success": false,
  "message": "Authorization header required",
  "data": null
}
```

### Get Specific User Profile

Retrieves the profile of a specific user by public key.

**Endpoint:** `GET /api/v1/users/:pubkey`

**Response (200 OK):**
```json
{
  "success": true,
  "message": null,
  "data": {
    "pub": "user-public-key",
    "alias": "user@example.com"
  }
}
```

**Error Response (403 Forbidden):**
```json
{
  "success": false,
  "message": "Insufficient permissions",
  "data": null
}
```

### Update User Profile

Updates the profile of the authenticated user.

**Endpoint:** `PUT /api/v1/users/profile`

**Headers:**
```
Authorization: user-public-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "profile": {
    "name": "John Doe",
    "bio": "Software Developer",
    "avatar": "https://example.com/avatar.jpg"
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "name": "John Doe",
    "bio": "Software Developer",
    "avatar": "https://example.com/avatar.jpg"
  }
}
```

### Get User Statistics

Retrieves statistics for a specific user.

**Endpoint:** `GET /api/v1/users/stats/:pubkey`

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Statistics retrieved successfully",
  "data": {
    "uploads": 15,
    "storageUsed": "2.5GB",
    "lastActive": "2024-01-15T10:30:00Z"
  }
}
```

## Rate Limiting

All authentication endpoints are protected by rate limiting:

- **Authentication endpoints**: 5 requests per 15 minutes per IP
- **User management endpoints**: 100 requests per 15 minutes per IP
- **General endpoints**: 1000 requests per 15 minutes per IP

When rate limit is exceeded:
```json
{
  "success": false,
  "message": "Too many requests. Try again in 15 minutes.",
  "data": null
}
```

## Error Codes

| Status Code | Description |
|-------------|-------------|
| 200 | Success |
| 201 | Created (user registration) |
| 400 | Bad Request (invalid input) |
| 401 | Unauthorized (missing or invalid auth) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found (user not found) |
| 429 | Too Many Requests (rate limit exceeded) |
| 500 | Internal Server Error |

## Security Features

### Password Requirements
- Minimum 8 characters for registration
- Passwords are encrypted using base64 encoding (production should use stronger encryption)

### Authentication Flow
1. User registers with email and passphrase
2. GunDB creates user with encrypted credentials
3. User profile is stored in GunDB
4. Login validates credentials against GunDB
5. User receives public key for subsequent requests

### Data Protection
- User passwords are encrypted before storage
- Public keys are used for authorization
- Rate limiting prevents brute force attacks
- Session management handled by GunDB

## Usage Examples

### JavaScript/Node.js

```javascript
// Register a new user
const registerUser = async (email, passphrase, hint) => {
  const response = await fetch('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, passphrase, hint })
  });
  return response.json();
};

// Login user
const loginUser = async (email, passphrase) => {
  const response = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, passphrase })
  });
  return response.json();
};

// Get user profile
const getUserProfile = async (userPub) => {
  const response = await fetch('/api/v1/users', {
    headers: { 'Authorization': userPub }
  });
  return response.json();
};
```

### cURL Examples

```bash
# Register user
curl -X POST http://localhost:8765/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","passphrase":"password123","hint":"test"}'

# Login user
curl -X POST http://localhost:8765/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","passphrase":"password123"}'

# Get user profile
curl -X GET http://localhost:8765/api/v1/users \
  -H "Authorization: user-public-key"
```

## Testing

### Health Check
```bash
curl http://localhost:8765/api/v1/health
```

### Test User Registration
```bash
curl -X POST http://localhost:8765/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","passphrase":"password123","hint":"test"}'
```

## Troubleshooting

### Common Issues

1. **Rate Limiting**: Reduce request frequency or increase limits
2. **Authentication Errors**: Verify user exists and credentials are correct
3. **GunDB Connection**: Check relay logs for GunDB initialization errors
4. **CORS Issues**: Ensure proper CORS configuration for web clients

### Debug Commands

```bash
# Check relay logs
docker logs -f shogun-relay-stack

# Test GunDB connection
curl http://localhost:8765/gun

# Check authentication routes
docker logs shogun-relay-stack | grep "Route"
```

## Integration with Applications

### Frontend Integration

```javascript
class ShogunAuth {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async register(email, passphrase, hint) {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, passphrase, hint })
    });
    return response.json();
  }

  async login(email, passphrase) {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, passphrase })
    });
    return response.json();
  }

  async getProfile(userPub) {
    const response = await fetch(`${this.baseUrl}/api/v1/users`, {
      headers: { 'Authorization': userPub }
    });
    return response.json();
  }
}

// Usage
const auth = new ShogunAuth('http://localhost:8765');
const result = await auth.register('user@example.com', 'password123', 'hint');
```

This authentication system provides a solid foundation for building decentralized applications with user management capabilities. 