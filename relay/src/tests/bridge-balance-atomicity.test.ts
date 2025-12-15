/**
 * Bridge Balance Atomicity Tests
 *
 * Critical tests to ensure balance operations are atomic
 * and prevent race conditions or inconsistent state.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ethers } from "ethers";

// Simulated balance manager with locking (mirrors bridge-state.ts)
class BalanceManager {
  private balances = new Map<string, bigint>();
  private locks = new Map<string, boolean>();
  private lockQueue = new Map<string, Array<() => void>>();

  /**
   * Get user balance
   */
  getBalance(userAddress: string): bigint {
    return this.balances.get(userAddress.toLowerCase()) || 0n;
  }

  /**
   * Acquire lock for a user (prevents concurrent modifications)
   */
  private async acquireLock(userAddress: string): Promise<void> {
    const key = userAddress.toLowerCase();

    // If lock is free, acquire it
    if (!this.locks.get(key)) {
      this.locks.set(key, true);
      return;
    }

    // Otherwise, wait in queue
    return new Promise((resolve) => {
      if (!this.lockQueue.has(key)) {
        this.lockQueue.set(key, []);
      }
      this.lockQueue.get(key)!.push(resolve);
    });
  }

  /**
   * Release lock for a user
   */
  private releaseLock(userAddress: string): void {
    const key = userAddress.toLowerCase();
    const queue = this.lockQueue.get(key);

    if (queue && queue.length > 0) {
      // Give lock to next waiter
      const next = queue.shift()!;
      next();
    } else {
      // No waiters, free the lock
      this.locks.set(key, false);
    }
  }

  /**
   * Execute operation with lock
   */
  async executeWithLock<T>(userAddress: string, operation: () => Promise<T>): Promise<T> {
    await this.acquireLock(userAddress);
    try {
      return await operation();
    } finally {
      this.releaseLock(userAddress);
    }
  }

  /**
   * Credit balance (atomic)
   */
  async creditBalance(
    userAddress: string,
    amount: bigint
  ): Promise<{ success: boolean; newBalance: bigint }> {
    return this.executeWithLock(userAddress, async () => {
      const current = this.getBalance(userAddress);
      const newBalance = current + amount;
      this.balances.set(userAddress.toLowerCase(), newBalance);
      return { success: true, newBalance };
    });
  }

  /**
   * Debit balance (atomic, with validation)
   */
  async debitBalance(
    userAddress: string,
    amount: bigint
  ): Promise<{ success: boolean; newBalance?: bigint; error?: string }> {
    return this.executeWithLock(userAddress, async () => {
      const current = this.getBalance(userAddress);

      if (current < amount) {
        return { success: false, error: "Insufficient balance" };
      }

      const newBalance = current - amount;
      this.balances.set(userAddress.toLowerCase(), newBalance);
      return { success: true, newBalance };
    });
  }

  /**
   * Transfer between users (atomic)
   */
  async transfer(
    from: string,
    to: string,
    amount: bigint
  ): Promise<{ success: boolean; error?: string }> {
    // Lock both users to prevent race conditions
    // Always lock in alphabetical order to prevent deadlocks
    const [first, second] = from.toLowerCase() < to.toLowerCase() ? [from, to] : [to, from];

    return this.executeWithLock(first, async () => {
      return this.executeWithLock(second, async () => {
        const fromBalance = this.getBalance(from);

        if (fromBalance < amount) {
          return { success: false, error: "Insufficient balance" };
        }

        // Atomic update
        this.balances.set(from.toLowerCase(), fromBalance - amount);
        this.balances.set(to.toLowerCase(), this.getBalance(to) + amount);

        return { success: true };
      });
    });
  }

  /**
   * Reset state (for testing)
   */
  reset(): void {
    this.balances.clear();
    this.locks.clear();
    this.lockQueue.clear();
  }
}

describe("Bridge Balance Atomicity", () => {
  const USER_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const USER_2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  const ONE_ETH = BigInt("1000000000000000000");

  let balanceManager: BalanceManager;

  beforeEach(() => {
    balanceManager = new BalanceManager();
  });

  describe("Credit Operations", () => {
    it("should credit balance correctly", async () => {
      const result = await balanceManager.creditBalance(USER_1, ONE_ETH);

      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(ONE_ETH);
      expect(balanceManager.getBalance(USER_1)).toBe(ONE_ETH);
    });

    it("should accumulate multiple credits", async () => {
      await balanceManager.creditBalance(USER_1, ONE_ETH);
      await balanceManager.creditBalance(USER_1, ONE_ETH);
      await balanceManager.creditBalance(USER_1, ONE_ETH);

      expect(balanceManager.getBalance(USER_1)).toBe(ONE_ETH * 3n);
    });

    it("should handle concurrent credits atomically", async () => {
      // Simulate 10 concurrent deposits
      const deposits = Array(10)
        .fill(null)
        .map(() => balanceManager.creditBalance(USER_1, ONE_ETH));

      await Promise.all(deposits);

      // Should have exactly 10 ETH
      expect(balanceManager.getBalance(USER_1)).toBe(ONE_ETH * 10n);
    });

    it("should isolate credits per user", async () => {
      await balanceManager.creditBalance(USER_1, ONE_ETH * 5n);
      await balanceManager.creditBalance(USER_2, ONE_ETH * 3n);

      expect(balanceManager.getBalance(USER_1)).toBe(ONE_ETH * 5n);
      expect(balanceManager.getBalance(USER_2)).toBe(ONE_ETH * 3n);
    });
  });

  describe("Debit Operations", () => {
    it("should debit balance correctly", async () => {
      await balanceManager.creditBalance(USER_1, ONE_ETH * 10n);

      const result = await balanceManager.debitBalance(USER_1, ONE_ETH * 3n);

      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(ONE_ETH * 7n);
      expect(balanceManager.getBalance(USER_1)).toBe(ONE_ETH * 7n);
    });

    it("should REJECT debit exceeding balance", async () => {
      await balanceManager.creditBalance(USER_1, ONE_ETH);

      const result = await balanceManager.debitBalance(USER_1, ONE_ETH * 2n);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Insufficient balance");
      // Balance should be unchanged
      expect(balanceManager.getBalance(USER_1)).toBe(ONE_ETH);
    });

    it("should REJECT debit on zero balance", async () => {
      const result = await balanceManager.debitBalance(USER_1, ONE_ETH);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Insufficient balance");
    });

    it("should allow exact balance debit", async () => {
      await balanceManager.creditBalance(USER_1, ONE_ETH);

      const result = await balanceManager.debitBalance(USER_1, ONE_ETH);

      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(0n);
    });

    it("should handle concurrent debits atomically", async () => {
      // Start with 5 ETH
      await balanceManager.creditBalance(USER_1, ONE_ETH * 5n);

      // Try 10 concurrent withdrawals of 1 ETH each
      const withdrawals = Array(10)
        .fill(null)
        .map(() => balanceManager.debitBalance(USER_1, ONE_ETH));

      const results = await Promise.all(withdrawals);

      // Exactly 5 should succeed, 5 should fail
      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      expect(successful.length).toBe(5);
      expect(failed.length).toBe(5);
      expect(balanceManager.getBalance(USER_1)).toBe(0n);
    });
  });

  describe("Transfer Operations", () => {
    it("should transfer between users correctly", async () => {
      await balanceManager.creditBalance(USER_1, ONE_ETH * 10n);

      const result = await balanceManager.transfer(USER_1, USER_2, ONE_ETH * 3n);

      expect(result.success).toBe(true);
      expect(balanceManager.getBalance(USER_1)).toBe(ONE_ETH * 7n);
      expect(balanceManager.getBalance(USER_2)).toBe(ONE_ETH * 3n);
    });

    it("should REJECT transfer exceeding balance", async () => {
      await balanceManager.creditBalance(USER_1, ONE_ETH);

      const result = await balanceManager.transfer(USER_1, USER_2, ONE_ETH * 2n);

      expect(result.success).toBe(false);
      // Balances unchanged
      expect(balanceManager.getBalance(USER_1)).toBe(ONE_ETH);
      expect(balanceManager.getBalance(USER_2)).toBe(0n);
    });

    it("should handle concurrent transfers atomically", async () => {
      // User 1 has 5 ETH
      await balanceManager.creditBalance(USER_1, ONE_ETH * 5n);

      // Try 10 concurrent transfers of 1 ETH
      const transfers = Array(10)
        .fill(null)
        .map(() => balanceManager.transfer(USER_1, USER_2, ONE_ETH));

      const results = await Promise.all(transfers);

      const successful = results.filter((r) => r.success);

      expect(successful.length).toBe(5);
      expect(balanceManager.getBalance(USER_1)).toBe(0n);
      expect(balanceManager.getBalance(USER_2)).toBe(ONE_ETH * 5n);
    });

    it("should prevent balance sum from changing during transfer", async () => {
      await balanceManager.creditBalance(USER_1, ONE_ETH * 10n);
      await balanceManager.creditBalance(USER_2, ONE_ETH * 5n);

      const totalBefore = balanceManager.getBalance(USER_1) + balanceManager.getBalance(USER_2);

      await balanceManager.transfer(USER_1, USER_2, ONE_ETH * 3n);

      const totalAfter = balanceManager.getBalance(USER_1) + balanceManager.getBalance(USER_2);

      // Total should be unchanged (no money created or destroyed)
      expect(totalAfter).toBe(totalBefore);
    });
  });

  describe("Race Condition Prevention", () => {
    it("should prevent double-spend via concurrent withdrawals", async () => {
      // User has exactly 1 ETH
      await balanceManager.creditBalance(USER_1, ONE_ETH);

      // Try to withdraw 1 ETH twice simultaneously
      const [result1, result2] = await Promise.all([
        balanceManager.debitBalance(USER_1, ONE_ETH),
        balanceManager.debitBalance(USER_1, ONE_ETH),
      ]);

      // Only one should succeed
      const successCount = [result1, result2].filter((r) => r.success).length;
      expect(successCount).toBe(1);

      // Balance should be 0
      expect(balanceManager.getBalance(USER_1)).toBe(0n);
    });

    it("should handle interleaved credit and debit", async () => {
      // Start with 5 ETH
      await balanceManager.creditBalance(USER_1, ONE_ETH * 5n);

      // Interleave credits and debits
      const operations = [
        balanceManager.debitBalance(USER_1, ONE_ETH * 2n), // -2 = 3
        balanceManager.creditBalance(USER_1, ONE_ETH * 3n), // +3 = 6
        balanceManager.debitBalance(USER_1, ONE_ETH * 4n), // -4 = 2
        balanceManager.creditBalance(USER_1, ONE_ETH * 1n), // +1 = 3
      ];

      await Promise.all(operations);

      // Final balance should be 3 ETH (order guaranteed by locks)
      expect(balanceManager.getBalance(USER_1)).toBe(ONE_ETH * 3n);
    });

    it("should handle mixed user concurrent operations", async () => {
      await balanceManager.creditBalance(USER_1, ONE_ETH * 10n);
      await balanceManager.creditBalance(USER_2, ONE_ETH * 10n);

      const operations = [
        // User 1 operations
        balanceManager.debitBalance(USER_1, ONE_ETH),
        balanceManager.creditBalance(USER_1, ONE_ETH * 2n),
        // User 2 operations
        balanceManager.debitBalance(USER_2, ONE_ETH * 3n),
        // Cross-user transfer
        balanceManager.transfer(USER_1, USER_2, ONE_ETH * 2n),
      ];

      await Promise.all(operations);

      // Calculate expected balances
      // This test verifies no data corruption under concurrent load
      const user1Balance = balanceManager.getBalance(USER_1);
      const user2Balance = balanceManager.getBalance(USER_2);

      // Verify conservation: no money was created from thin air
      // Total cannot exceed initial 20 ETH (some operations may fail)
      expect(user1Balance + user2Balance).toBeLessThanOrEqual(ONE_ETH * 20n);

      // Balances must be non-negative (no overdraft)
      expect(user1Balance).toBeGreaterThanOrEqual(0n);
      expect(user2Balance).toBeGreaterThanOrEqual(0n);
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero amount operations", async () => {
      await balanceManager.creditBalance(USER_1, ONE_ETH);

      const creditResult = await balanceManager.creditBalance(USER_1, 0n);
      expect(creditResult.success).toBe(true);
      expect(balanceManager.getBalance(USER_1)).toBe(ONE_ETH);

      const debitResult = await balanceManager.debitBalance(USER_1, 0n);
      expect(debitResult.success).toBe(true);
      expect(balanceManager.getBalance(USER_1)).toBe(ONE_ETH);
    });

    it("should handle very large balances", async () => {
      const largeAmount = BigInt("999999999999999999999999999");

      await balanceManager.creditBalance(USER_1, largeAmount);
      expect(balanceManager.getBalance(USER_1)).toBe(largeAmount);

      const result = await balanceManager.debitBalance(USER_1, largeAmount);
      expect(result.success).toBe(true);
      expect(balanceManager.getBalance(USER_1)).toBe(0n);
    });

    it("should normalize address case", async () => {
      const checksummed = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const lowercase = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

      await balanceManager.creditBalance(checksummed, ONE_ETH);
      expect(balanceManager.getBalance(lowercase)).toBe(ONE_ETH);

      await balanceManager.debitBalance(lowercase, ONE_ETH);
      expect(balanceManager.getBalance(checksummed)).toBe(0n);
    });
  });
});
