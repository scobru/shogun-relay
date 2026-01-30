# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Shogun Relay, please report it responsibly:

1. **DO NOT** open a public GitHub issue for security vulnerabilities
2. Email security concerns to the maintainers directly
3. Include as much detail as possible:
   - Type of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

- **Initial Response**: Within 48 hours
- **Assessment**: Within 1 week
- **Fix Timeline**: Depends on severity
  - Critical: 24-48 hours
  - High: 1 week
  - Medium: 2 weeks
  - Low: Next release

## Security Measures

This project implements several security measures:

### Authentication
- Timing-safe token comparison (prevents timing attacks)
- SHA-256 hashed admin tokens
- Rate limiting on failed attempts

### Payment Security (x402)
- EIP-3009 signature verification
- Time-window validation
- Nonce tracking to prevent replay

### TLS / Self-signed certificates
- `MINIO_SKIP_SSL_VERIFY` and `GUN_S3_SKIP_SSL_VERIFY` allow accepting self-signed TLS certs for MinIO/S3 endpoints. Use only in development or on trusted networks; in production prefer proper certificates.

## Audit Status

- [ ] Internal code review completed
- [ ] External security audit pending
- [ ] Formal verification (planned)

## Bug Bounty

Currently, we do not have a formal bug bounty program. However, responsible disclosure of significant security issues will be acknowledged in release notes.
