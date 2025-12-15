/**
 * Bridge Double-Spend Prevention Tests
 *
 * Critical tests to ensure the bridge prevents replay attacks
 * and double-spend attempts through nonce validation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ethers } from "ethers";

// Simulated nonce tracking (mirrors bridge-state.ts logic)
class NonceTracker {
    private lastNonceByUser = new Map<string, bigint>();
    private usedNonces = new Map<string, Set<string>>();

    /**
     * Get the last used nonce for a user
     */
    getLastNonce(userAddress: string): bigint {
        return this.lastNonceByUser.get(userAddress.toLowerCase()) || 0n;
    }

    /**
     * Set the last used nonce for a user
     */
    setLastNonce(userAddress: string, nonce: bigint): void {
        this.lastNonceByUser.set(userAddress.toLowerCase(), nonce);
    }

    /**
     * Validate that a nonce is greater than the last used nonce
     */
    validateNonceIncremental(
        userAddress: string,
        nonce: bigint
    ): { valid: boolean; error?: string; lastNonce?: bigint } {
        const normalizedAddress = userAddress.toLowerCase();
        const lastNonce = this.getLastNonce(normalizedAddress);

        if (nonce <= lastNonce) {
            return {
                valid: false,
                error: `Nonce must be greater than last used nonce: ${lastNonce.toString()}`,
                lastNonce,
            };
        }

        return { valid: true, lastNonce };
    }

    /**
     * Check if a specific nonce has been used (replay protection)
     */
    isNonceUsed(userAddress: string, nonce: string): boolean {
        const normalizedAddress = userAddress.toLowerCase();
        const userNonces = this.usedNonces.get(normalizedAddress);
        return userNonces?.has(nonce) ?? false;
    }

    /**
     * Mark a nonce as used
     */
    markNonceUsed(userAddress: string, nonce: string): void {
        const normalizedAddress = userAddress.toLowerCase();
        if (!this.usedNonces.has(normalizedAddress)) {
            this.usedNonces.set(normalizedAddress, new Set());
        }
        this.usedNonces.get(normalizedAddress)!.add(nonce);
    }

    /**
     * Atomic withdrawal processing with nonce validation
     */
    processWithdrawal(
        userAddress: string,
        amount: bigint,
        nonce: bigint
    ): { success: boolean; error?: string } {
        // Step 1: Validate nonce is incremental
        const validation = this.validateNonceIncremental(userAddress, nonce);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        // Step 2: Check if specific nonce was already used (replay)
        const nonceStr = nonce.toString();
        if (this.isNonceUsed(userAddress, nonceStr)) {
            return { success: false, error: "Nonce already used (replay attack)" };
        }

        // Step 3: Mark nonce as used and update last nonce
        this.markNonceUsed(userAddress, nonceStr);
        this.setLastNonce(userAddress, nonce);

        return { success: true };
    }

    /**
     * Reset state (for testing)
     */
    reset(): void {
        this.lastNonceByUser.clear();
        this.usedNonces.clear();
    }
}

describe("Bridge Double-Spend Prevention", () => {
    const USER_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const USER_2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

    let nonceTracker: NonceTracker;

    beforeEach(() => {
        nonceTracker = new NonceTracker();
    });

    describe("Nonce Validation", () => {
        it("should accept first withdrawal with nonce 1", () => {
            const result = nonceTracker.validateNonceIncremental(USER_1, BigInt(1));
            expect(result.valid).toBe(true);
            expect(result.lastNonce).toBe(BigInt(0));
        });

        it("should accept incrementing nonces", () => {
            nonceTracker.setLastNonce(USER_1, BigInt(5));

            const result = nonceTracker.validateNonceIncremental(USER_1, BigInt(6));
            expect(result.valid).toBe(true);

            // Also accept skipping nonces (e.g., 5 -> 10)
            const result2 = nonceTracker.validateNonceIncremental(USER_1, BigInt(10));
            expect(result2.valid).toBe(true);
        });

        it("should REJECT reused nonce (double-spend attempt)", () => {
            nonceTracker.setLastNonce(USER_1, BigInt(5));

            const result = nonceTracker.validateNonceIncremental(USER_1, BigInt(5));
            expect(result.valid).toBe(false);
            expect(result.error).toContain("greater than last used nonce");
        });

        it("should REJECT old nonce (replay attack)", () => {
            nonceTracker.setLastNonce(USER_1, BigInt(10));

            // Try to use an old nonce
            const result = nonceTracker.validateNonceIncremental(USER_1, BigInt(3));
            expect(result.valid).toBe(false);
            expect(result.error).toContain("greater than last used nonce: 10");
        });

        it("should REJECT nonce 0", () => {
            const result = nonceTracker.validateNonceIncremental(USER_1, BigInt(0));
            expect(result.valid).toBe(false);
        });

        it("should isolate nonces per user", () => {
            nonceTracker.setLastNonce(USER_1, BigInt(100));
            nonceTracker.setLastNonce(USER_2, BigInt(5));

            // User 1's high nonce shouldn't affect User 2
            const result1 = nonceTracker.validateNonceIncremental(USER_2, BigInt(6));
            expect(result1.valid).toBe(true);

            // User 2's low nonce shouldn't allow User 1 to use old nonce
            const result2 = nonceTracker.validateNonceIncremental(USER_1, BigInt(50));
            expect(result2.valid).toBe(false);
        });

        it("should handle address case normalization", () => {
            const checksummed = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
            const lowercase = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

            nonceTracker.setLastNonce(checksummed, BigInt(10));

            // Should work with lowercase
            const result = nonceTracker.validateNonceIncremental(lowercase, BigInt(11));
            expect(result.valid).toBe(true);

            // Old nonce should fail with either case
            const result2 = nonceTracker.validateNonceIncremental(checksummed, BigInt(5));
            expect(result2.valid).toBe(false);
        });
    });

    describe("Replay Attack Prevention", () => {
        it("should prevent same withdrawal from being processed twice", () => {
            const amount = BigInt("1000000000000000000"); // 1 ETH

            // First withdrawal succeeds
            const result1 = nonceTracker.processWithdrawal(USER_1, amount, BigInt(1));
            expect(result1.success).toBe(true);

            // Same withdrawal (same nonce) should fail
            const result2 = nonceTracker.processWithdrawal(USER_1, amount, BigInt(1));
            expect(result2.success).toBe(false);
            expect(result2.error).toContain("greater than last used nonce");
        });

        it("should track used nonces for explicit replay detection", () => {
            const nonceStr = "12345";

            expect(nonceTracker.isNonceUsed(USER_1, nonceStr)).toBe(false);

            nonceTracker.markNonceUsed(USER_1, nonceStr);

            expect(nonceTracker.isNonceUsed(USER_1, nonceStr)).toBe(true);
            expect(nonceTracker.isNonceUsed(USER_2, nonceStr)).toBe(false); // Isolated
        });

        it("should handle rapid sequential withdrawals correctly", () => {
            const amount = BigInt("1000000000000000000");

            const results = [];
            for (let i = 1; i <= 10; i++) {
                results.push(nonceTracker.processWithdrawal(USER_1, amount, BigInt(i)));
            }

            // All should succeed
            expect(results.every((r) => r.success)).toBe(true);

            // Current last nonce should be 10
            expect(nonceTracker.getLastNonce(USER_1)).toBe(BigInt(10));
        });

        it("should prevent interleaved replay attempts", () => {
            const amount = BigInt("1000000000000000000");

            // Process nonces 1, 2, 3
            nonceTracker.processWithdrawal(USER_1, amount, BigInt(1));
            nonceTracker.processWithdrawal(USER_1, amount, BigInt(2));
            nonceTracker.processWithdrawal(USER_1, amount, BigInt(3));

            // Try to replay nonce 2
            const replay = nonceTracker.processWithdrawal(USER_1, amount, BigInt(2));
            expect(replay.success).toBe(false);

            // Continue with valid nonce
            const valid = nonceTracker.processWithdrawal(USER_1, amount, BigInt(4));
            expect(valid.success).toBe(true);
        });
    });

    describe("Edge Cases", () => {
        it("should handle very large nonces", () => {
            const largeNonce = BigInt("9999999999999999999999999");
            nonceTracker.setLastNonce(USER_1, largeNonce);

            const result = nonceTracker.validateNonceIncremental(
                USER_1,
                largeNonce + BigInt(1)
            );
            expect(result.valid).toBe(true);
        });

        it("should handle concurrent user operations", () => {
            const amount = BigInt("1000000000000000000");

            // Simulate concurrent operations from different users
            const user1Results = [
                nonceTracker.processWithdrawal(USER_1, amount, BigInt(1)),
                nonceTracker.processWithdrawal(USER_1, amount, BigInt(2)),
            ];

            const user2Results = [
                nonceTracker.processWithdrawal(USER_2, amount, BigInt(1)),
                nonceTracker.processWithdrawal(USER_2, amount, BigInt(2)),
            ];

            // All should succeed - users are independent
            expect(user1Results.every((r) => r.success)).toBe(true);
            expect(user2Results.every((r) => r.success)).toBe(true);
        });

        it("should not allow nonce gaps to be filled later", () => {
            const amount = BigInt("1000000000000000000");

            // Use nonces 1, 2, then skip to 10
            nonceTracker.processWithdrawal(USER_1, amount, BigInt(1));
            nonceTracker.processWithdrawal(USER_1, amount, BigInt(2));
            nonceTracker.processWithdrawal(USER_1, amount, BigInt(10));

            // Try to use skipped nonces 3-9
            for (let i = 3; i <= 9; i++) {
                const result = nonceTracker.processWithdrawal(USER_1, amount, BigInt(i));
                expect(result.success).toBe(false);
            }

            // Only nonce 11+ should work
            const valid = nonceTracker.processWithdrawal(USER_1, amount, BigInt(11));
            expect(valid.success).toBe(true);
        });
    });

    describe("Withdrawal Signature Verification", () => {
        it("should create deterministic withdrawal hash", () => {
            const user = USER_1;
            const amount = BigInt("1000000000000000000");
            const nonce = BigInt(1);

            // Compute withdrawal hash (matches on-chain)
            const hash1 = ethers.solidityPackedKeccak256(
                ["address", "uint256", "uint256"],
                [user, amount, nonce]
            );

            const hash2 = ethers.solidityPackedKeccak256(
                ["address", "uint256", "uint256"],
                [user, amount, nonce]
            );

            expect(hash1).toBe(hash2);
            expect(hash1).toMatch(/^0x[a-fA-F0-9]{64}$/);
        });

        it("should produce different hashes for different withdrawals", () => {
            const user = USER_1;
            const amount = BigInt("1000000000000000000");

            const hash1 = ethers.solidityPackedKeccak256(
                ["address", "uint256", "uint256"],
                [user, amount, BigInt(1)]
            );

            const hash2 = ethers.solidityPackedKeccak256(
                ["address", "uint256", "uint256"],
                [user, amount, BigInt(2)]
            );

            expect(hash1).not.toBe(hash2);
        });
    });
});
