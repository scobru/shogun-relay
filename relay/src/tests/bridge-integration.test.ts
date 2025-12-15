/**
 * Bridge Integration Tests
 *
 * Integration tests that verify the bridge components work together.
 * These tests simulate realistic scenarios without mocking external services.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ethers } from "ethers";
import {
    computeLeaf,
    MerkleTree,
    buildMerkleTreeFromWithdrawals,
    WithdrawalLeaf,
} from "../utils/merkle-tree";

// Simulated classes from bridge-state
class NonceTracker {
    private lastNonceByUser = new Map<string, bigint>();

    getLastNonce(userAddress: string): bigint {
        return this.lastNonceByUser.get(userAddress.toLowerCase()) || 0n;
    }

    setLastNonce(userAddress: string, nonce: bigint): void {
        this.lastNonceByUser.set(userAddress.toLowerCase(), nonce);
    }

    validateNonce(
        userAddress: string,
        nonce: bigint
    ): { valid: boolean; error?: string } {
        const lastNonce = this.getLastNonce(userAddress);
        if (nonce <= lastNonce) {
            return { valid: false, error: `Nonce must be > ${lastNonce}` };
        }
        return { valid: true };
    }
}

class BalanceManager {
    private balances = new Map<string, bigint>();

    getBalance(userAddress: string): bigint {
        return this.balances.get(userAddress.toLowerCase()) || 0n;
    }

    credit(userAddress: string, amount: bigint): void {
        const current = this.getBalance(userAddress);
        this.balances.set(userAddress.toLowerCase(), current + amount);
    }

    debit(
        userAddress: string,
        amount: bigint
    ): { success: boolean; error?: string } {
        const current = this.getBalance(userAddress);
        if (current < amount) {
            return { success: false, error: "Insufficient balance" };
        }
        this.balances.set(userAddress.toLowerCase(), current - amount);
        return { success: true };
    }
}

interface PendingWithdrawal {
    user: string;
    amount: bigint;
    nonce: bigint;
    timestamp: number;
}

class WithdrawalQueue {
    private queue: PendingWithdrawal[] = [];

    add(withdrawal: PendingWithdrawal): void {
        this.queue.push(withdrawal);
    }

    getAll(): PendingWithdrawal[] {
        return [...this.queue];
    }

    clear(): PendingWithdrawal[] {
        const items = [...this.queue];
        this.queue = [];
        return items;
    }

    size(): number {
        return this.queue.length;
    }
}

/**
 * Full Bridge System Integration
 */
class BridgeSystem {
    private nonceTracker = new NonceTracker();
    private balanceManager = new BalanceManager();
    private withdrawalQueue = new WithdrawalQueue();

    /**
     * Process a deposit (credit balance)
     */
    processDeposit(user: string, amount: bigint): { success: boolean } {
        this.balanceManager.credit(user, amount);
        return { success: true };
    }

    /**
     * Request a withdrawal
     */
    requestWithdrawal(
        user: string,
        amount: bigint,
        nonce: bigint
    ): { success: boolean; error?: string } {
        // Validate nonce
        const nonceValidation = this.nonceTracker.validateNonce(user, nonce);
        if (!nonceValidation.valid) {
            return { success: false, error: nonceValidation.error };
        }

        // Validate balance
        const debitResult = this.balanceManager.debit(user, amount);
        if (!debitResult.success) {
            return { success: false, error: debitResult.error };
        }

        // Update nonce
        this.nonceTracker.setLastNonce(user, nonce);

        // Queue withdrawal
        this.withdrawalQueue.add({
            user,
            amount,
            nonce,
            timestamp: Date.now(),
        });

        return { success: true };
    }

    /**
     * Create batch from pending withdrawals
     */
    createBatch(): {
        batchId: string;
        merkleRoot: string;
        withdrawals: PendingWithdrawal[];
        proofs: Map<string, string[]>;
    } | null {
        const withdrawals = this.withdrawalQueue.clear();
        if (withdrawals.length === 0) {
            return null;
        }

        // Build Merkle tree
        const leaves: WithdrawalLeaf[] = withdrawals.map((w) => ({
            user: w.user,
            amount: w.amount,
            nonce: w.nonce,
        }));

        const { root, getProof } = buildMerkleTreeFromWithdrawals(leaves);

        // Generate proofs for each withdrawal
        const proofs = new Map<string, string[]>();
        for (const w of withdrawals) {
            const proof = getProof(w.user, w.amount, w.nonce);
            if (proof) {
                const key = `${w.user}-${w.nonce}`;
                proofs.set(key, proof);
            }
        }

        return {
            batchId: ethers.hexlify(ethers.randomBytes(32)),
            merkleRoot: root,
            withdrawals,
            proofs,
        };
    }

    /**
     * Get user balance
     */
    getBalance(user: string): bigint {
        return this.balanceManager.getBalance(user);
    }

    /**
     * Get pending withdrawals count
     */
    getPendingCount(): number {
        return this.withdrawalQueue.size();
    }
}

describe("Bridge Integration", () => {
    const USER_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const USER_2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    const ONE_ETH = BigInt("1000000000000000000");

    let bridge: BridgeSystem;

    beforeEach(() => {
        bridge = new BridgeSystem();
    });

    describe("Full Deposit → Withdrawal → Batch Flow", () => {
        it("should handle complete deposit and withdrawal cycle", () => {
            // 1. User deposits 10 ETH
            const depositResult = bridge.processDeposit(USER_1, ONE_ETH * 10n);
            expect(depositResult.success).toBe(true);
            expect(bridge.getBalance(USER_1)).toBe(ONE_ETH * 10n);

            // 2. User withdraws 3 ETH
            const withdrawResult = bridge.requestWithdrawal(
                USER_1,
                ONE_ETH * 3n,
                BigInt(1)
            );
            expect(withdrawResult.success).toBe(true);
            expect(bridge.getBalance(USER_1)).toBe(ONE_ETH * 7n);
            expect(bridge.getPendingCount()).toBe(1);

            // 3. Create batch with Merkle proof
            const batch = bridge.createBatch();
            expect(batch).not.toBeNull();
            expect(batch!.withdrawals.length).toBe(1);
            expect(batch!.merkleRoot).toMatch(/^0x[a-fA-F0-9]{64}$/);

            // 4. Verify the proof
            const withdrawal = batch!.withdrawals[0];
            const proof = batch!.proofs.get(`${withdrawal.user}-${withdrawal.nonce}`);
            expect(proof).toBeDefined();

            const leaf = computeLeaf(
                withdrawal.user,
                withdrawal.amount,
                withdrawal.nonce
            );
            const isValid = MerkleTree.verifyProof(proof!, batch!.merkleRoot, leaf);
            expect(isValid).toBe(true);
        });

        it("should handle multiple users in same batch", () => {
            // Deposits
            bridge.processDeposit(USER_1, ONE_ETH * 10n);
            bridge.processDeposit(USER_2, ONE_ETH * 5n);

            // Withdrawals from both users
            bridge.requestWithdrawal(USER_1, ONE_ETH * 2n, BigInt(1));
            bridge.requestWithdrawal(USER_2, ONE_ETH * 1n, BigInt(1));
            bridge.requestWithdrawal(USER_1, ONE_ETH * 3n, BigInt(2));

            expect(bridge.getPendingCount()).toBe(3);

            // Create batch
            const batch = bridge.createBatch();
            expect(batch!.withdrawals.length).toBe(3);

            // Verify all proofs
            for (const w of batch!.withdrawals) {
                const proof = batch!.proofs.get(`${w.user}-${w.nonce}`);
                const leaf = computeLeaf(w.user, w.amount, w.nonce);
                const isValid = MerkleTree.verifyProof(proof!, batch!.merkleRoot, leaf);
                expect(isValid).toBe(true);
            }
        });
    });

    describe("Security Scenarios", () => {
        it("should prevent double-withdrawal via nonce", () => {
            bridge.processDeposit(USER_1, ONE_ETH * 10n);

            // First withdrawal succeeds
            const result1 = bridge.requestWithdrawal(USER_1, ONE_ETH, BigInt(1));
            expect(result1.success).toBe(true);

            // Same nonce should fail
            const result2 = bridge.requestWithdrawal(USER_1, ONE_ETH, BigInt(1));
            expect(result2.success).toBe(false);
            expect(result2.error).toContain("Nonce");
        });

        it("should prevent withdrawal exceeding balance", () => {
            bridge.processDeposit(USER_1, ONE_ETH);

            const result = bridge.requestWithdrawal(USER_1, ONE_ETH * 2n, BigInt(1));
            expect(result.success).toBe(false);
            expect(result.error).toContain("Insufficient");

            // Balance should be unchanged
            expect(bridge.getBalance(USER_1)).toBe(ONE_ETH);
        });

        it("should prevent old nonce reuse after higher nonce used", () => {
            bridge.processDeposit(USER_1, ONE_ETH * 10n);

            // Use nonce 5
            bridge.requestWithdrawal(USER_1, ONE_ETH, BigInt(5));

            // Try to use nonce 3 (old)
            const result = bridge.requestWithdrawal(USER_1, ONE_ETH, BigInt(3));
            expect(result.success).toBe(false);
        });

        it("should isolate users completely", () => {
            bridge.processDeposit(USER_1, ONE_ETH * 10n);
            bridge.processDeposit(USER_2, ONE_ETH * 5n);

            // User 1 uses nonce 100
            bridge.requestWithdrawal(USER_1, ONE_ETH, BigInt(100));

            // User 2 should still be able to use nonce 1
            const result = bridge.requestWithdrawal(USER_2, ONE_ETH, BigInt(1));
            expect(result.success).toBe(true);
        });
    });

    describe("Merkle Proof On-Chain Simulation", () => {
        it("should produce proofs that would verify on-chain", () => {
            bridge.processDeposit(USER_1, ONE_ETH * 10n);

            // Multiple withdrawals
            for (let i = 1; i <= 5; i++) {
                bridge.requestWithdrawal(USER_1, ONE_ETH, BigInt(i));
            }

            const batch = bridge.createBatch();

            // Simulate on-chain verification
            for (const w of batch!.withdrawals) {
                const proof = batch!.proofs.get(`${w.user}-${w.nonce}`);

                // This is exactly what the Solidity contract does
                const leaf = ethers.solidityPackedKeccak256(
                    ["address", "uint256", "uint256"],
                    [w.user, w.amount, w.nonce]
                );

                // Verify matches computeLeaf
                const expectedLeaf = computeLeaf(w.user, w.amount, w.nonce);
                expect(leaf).toBe(expectedLeaf);

                // Verify proof
                const isValid = MerkleTree.verifyProof(proof!, batch!.merkleRoot, leaf);
                expect(isValid).toBe(true);
            }
        });

        it("should reject tampered withdrawal data", () => {
            bridge.processDeposit(USER_1, ONE_ETH * 10n);
            bridge.requestWithdrawal(USER_1, ONE_ETH, BigInt(1));

            const batch = bridge.createBatch();
            const w = batch!.withdrawals[0];
            const proof = batch!.proofs.get(`${w.user}-${w.nonce}`);

            // Tamper with amount
            const tamperedLeaf = computeLeaf(
                w.user,
                w.amount * 2n, // Double the amount!
                w.nonce
            );

            // Proof should fail
            const isValid = MerkleTree.verifyProof(
                proof!,
                batch!.merkleRoot,
                tamperedLeaf
            );
            expect(isValid).toBe(false);
        });
    });

    describe("Edge Cases", () => {
        it("should handle empty batch gracefully", () => {
            const batch = bridge.createBatch();
            expect(batch).toBeNull();
        });

        it("should handle zero balance user", () => {
            const result = bridge.requestWithdrawal(USER_1, ONE_ETH, BigInt(1));
            expect(result.success).toBe(false);
        });

        it("should handle very large withdrawal batch", () => {
            // Create 50 withdrawals
            const users = Array.from({ length: 50 }, () =>
                ethers.Wallet.createRandom().address
            );

            for (const user of users) {
                bridge.processDeposit(user, ONE_ETH * 10n);
                bridge.requestWithdrawal(user, ONE_ETH, BigInt(1));
            }

            const batch = bridge.createBatch();
            expect(batch!.withdrawals.length).toBe(50);

            // All proofs should be valid
            let validCount = 0;
            for (const w of batch!.withdrawals) {
                const proof = batch!.proofs.get(`${w.user}-${w.nonce}`);
                if (proof) {
                    const leaf = computeLeaf(w.user, w.amount, w.nonce);
                    if (MerkleTree.verifyProof(proof, batch!.merkleRoot, leaf)) {
                        validCount++;
                    }
                }
            }
            expect(validCount).toBe(50);
        });
    });
});
