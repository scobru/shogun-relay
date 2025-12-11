/**
 * Security Utilities
 * 
 * Provides secure authentication, input validation, and security helpers
 */

import crypto from 'crypto';
import { loggers } from './logger';

const log = loggers.server || console;

/**
 * Secure token comparison to prevent timing attacks
 * Uses crypto.timingSafeEqual for constant-time comparison
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  try {
    return crypto.timingSafeEqual(
      Buffer.from(a, 'utf8'),
      Buffer.from(b, 'utf8')
    );
  } catch {
    return false;
  }
}

/**
 * Hash a token/password using SHA-256
 * Used for secure password storage and comparison
 */
export function hashToken(token: string): string {
  return crypto
    .createHash('sha256')
    .update(token || '')
    .digest('hex');
}

/**
 * Validate Ethereum address format
 */
export function isValidEthereumAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }
  
  // Basic format check: 0x followed by 40 hex characters
  const addressRegex = /^0x[a-fA-F0-9]{40}$/;
  return addressRegex.test(address);
}

/**
 * Validate amount is within safe bounds
 */
export function isValidAmount(amount: bigint): { valid: boolean; error?: string } {
  if (amount <= 0n) {
    return { valid: false, error: 'Amount must be positive' };
  }
  
  // Max value: 2^256 - 1 (max uint256)
  const MAX_AMOUNT = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
  if (amount > MAX_AMOUNT) {
    return { valid: false, error: 'Amount exceeds maximum value' };
  }
  
  return { valid: true };
}

/**
 * Validate string length and sanitize
 */
export function validateString(
  value: string,
  fieldName: string,
  maxLength: number = 10000,
  minLength: number = 0
): { valid: boolean; error?: string; sanitized?: string } {
  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  
  if (value.length < minLength) {
    return { valid: false, error: `${fieldName} is too short (min ${minLength} characters)` };
  }
  
  if (value.length > maxLength) {
    return { valid: false, error: `${fieldName} is too long (max ${maxLength} characters)` };
  }
  
  // Basic sanitization: remove null bytes and control characters
  const sanitized = value
    .replace(/\0/g, '') // Remove null bytes
    .replace(/[\x00-\x1F\x7F]/g, ''); // Remove control characters
  
  return { valid: true, sanitized };
}

/**
 * Validate signature format
 */
export function isValidSignatureFormat(signature: string, type: 'sea' | 'eth' = 'eth'): boolean {
  if (!signature || typeof signature !== 'string') {
    return false;
  }
  
  if (type === 'eth') {
    // Ethereum signature: 0x + 130 hex characters (65 bytes * 2)
    return /^0x[a-fA-F0-9]{130}$/.test(signature);
  } else {
    // SEA signature: variable length, but should be reasonable
    return signature.length >= 50 && signature.length <= 500;
  }
}

/**
 * Sanitize data for logging (remove sensitive fields)
 */
export function sanitizeForLog(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }
  
  const sensitiveFields = [
    'privateKey', 'priv', 'epriv',
    'signature', 'seaSignature', 'ethSignature',
    'password', 'token', 'secret',
    'apiKey', 'apiToken'
  ];
  
  const sanitized = Array.isArray(data) ? [...data] : { ...data };
  
  for (const key in sanitized) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
      sanitized[key] = '***REDACTED***';
    } else if (typeof sanitized[key] === 'string' && sanitized[key].length > 200) {
      // Truncate long strings
      sanitized[key] = sanitized[key].substring(0, 200) + '...';
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeForLog(sanitized[key]);
    }
  }
  
  return sanitized;
}

/**
 * Create timeout wrapper for promises
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timeout'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

/**
 * User operation lock manager to prevent race conditions
 */
class UserLockManager {
  private locks = new Map<string, Promise<unknown>>();
  
  /**
   * Execute an operation with a lock for a specific user
   * Ensures only one operation per user executes at a time
   */
  async executeWithLock<T>(
    userKey: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const normalizedKey = userKey.toLowerCase();
    
    // Wait for any existing operation to complete
    const existingLock = this.locks.get(normalizedKey);
    if (existingLock) {
      await existingLock;
    }
    
    // Create new lock promise
    // Use a wrapper to avoid referencing lockPromise before assignment
    const lockPromise: Promise<T> = new Promise((resolve, reject) => {
      const operationPromise = (async () => {
        try {
          return await operation();
        } finally {
          // Remove lock when done
          const currentLock = this.locks.get(normalizedKey);
          if (currentLock === lockPromise) {
            this.locks.delete(normalizedKey);
          }
        }
      })();
      
      operationPromise.then(resolve).catch(reject);
    });
    
    this.locks.set(normalizedKey, lockPromise);
    return lockPromise;
  }
  
  /**
   * Check if a user has an active lock
   */
  hasLock(userKey: string): boolean {
    return this.locks.has(userKey.toLowerCase());
  }
  
  /**
   * Clear all locks (for testing/cleanup)
   */
  clearAll(): void {
    this.locks.clear();
  }
}

// Export singleton instance
export const userLockManager = new UserLockManager();

