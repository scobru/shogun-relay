# Contributing to Shogun Relay

Thank you for your interest in contributing to Shogun Relay!

## Development Setup

```bash
# Clone the repository
git clone https://github.com/scobru/shogun-relay.git
cd shogun-relay/relay

# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type check
npx tsc --noEmit

# Start development server
npm run start:dev
```

## Code Quality Standards

### Tests Required

All PRs must include tests for:
- New features
- Bug fixes
- Security-related changes

Minimum coverage requirements:
- **Critical modules** (payments, auth): 90%+
- **Utility modules**: 80%+
- **New code**: Must not decrease overall coverage

### Before Submitting a PR

1. **Run the test suite**:
   ```bash
   npm test
   ```

2. **Check types**:
   ```bash
   npx tsc --noEmit
   ```

3. **Run security audit**:
   ```bash
   npm audit
   ```

## Commit Messages

Follow conventional commits:
- `feat:` New features
- `fix:` Bug fixes
- `security:` Security-related changes
- `test:` Test additions/modifications
- `docs:` Documentation
- `refactor:` Code refactoring

Example:
```
feat(x402): add subscription tier validation

- Validate tier limits on upload
- Add storage quota checks
```

## Security Considerations

When contributing to security-sensitive areas:

1. **Payment operations**: Always include nonce/signature validation
2. **Balance updates**: Use locking to prevent race conditions
3. **Authentication**: Use timing-safe comparisons
4. **User input**: Validate and sanitize all inputs

## Pull Request Process

1. Create a feature branch from `develop`
2. Write tests for your changes
3. Ensure all tests pass
4. Update documentation if needed
5. Submit PR with clear description
6. Wait for CI checks to pass
7. Request review from maintainers

## Questions?

Open an issue for questions about contributing.
