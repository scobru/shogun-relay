/**
 * Merkle Tree Tests
 *
 * Tests for the Merkle tree utilities used in the L2 bridge.
 * These are critical for ensuring withdrawal proofs work correctly.
 */

import { describe, it, expect } from "vitest";
import {
  computeLeaf,
  MerkleTree,
  buildMerkleTreeFromWithdrawals,
  generateProof,
  type WithdrawalLeaf,
} from "../utils/merkle-tree";
import { ethers } from "ethers";

describe("Merkle Tree", () => {
  // Test addresses
  const USER_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const USER_2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  const USER_3 = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

  describe("computeLeaf", () => {
    it("should compute leaf hash correctly", () => {
      const user = USER_1;
      const amount = BigInt("1000000000000000000"); // 1 ETH
      const nonce = BigInt(1);

      const leaf = computeLeaf(user, amount, nonce);

      // Leaf should be a valid bytes32 hash
      expect(leaf).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Same inputs should produce same leaf
      const leaf2 = computeLeaf(user, amount, nonce);
      expect(leaf).toBe(leaf2);
    });

    it("should produce different leaves for different inputs", () => {
      const amount = BigInt("1000000000000000000");

      const leaf1 = computeLeaf(USER_1, amount, BigInt(1));
      const leaf2 = computeLeaf(USER_2, amount, BigInt(1));
      const leaf3 = computeLeaf(USER_1, amount, BigInt(2));
      const leaf4 = computeLeaf(USER_1, BigInt("2000000000000000000"), BigInt(1));

      expect(leaf1).not.toBe(leaf2); // Different user
      expect(leaf1).not.toBe(leaf3); // Different nonce
      expect(leaf1).not.toBe(leaf4); // Different amount
    });

    it("should handle checksummed and lowercase addresses", () => {
      const amount = BigInt("1000000000000000000");
      const nonce = BigInt(1);

      const checksummed = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const lowercase = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

      const leaf1 = computeLeaf(checksummed, amount, nonce);
      const leaf2 = computeLeaf(lowercase, amount, nonce);

      // Both should produce the same leaf
      expect(leaf1).toBe(leaf2);
    });

    it("should match Solidity encoding", () => {
      // This test ensures our encoding matches what the Solidity contract expects
      const user = USER_1;
      const amount = BigInt("1000000000000000000");
      const nonce = BigInt(1);

      const leaf = computeLeaf(user, amount, nonce);

      // Manual encoding to verify
      const encoded = ethers.solidityPacked(
        ["address", "uint256", "uint256"],
        [ethers.getAddress(user), amount, nonce]
      );
      const expectedLeaf = ethers.keccak256(encoded);

      expect(leaf).toBe(expectedLeaf);
    });
  });

  describe("MerkleTree", () => {
    it("should throw error for empty leaves", () => {
      expect(() => new MerkleTree([])).toThrow("MerkleTree: Cannot build tree with empty leaves");
    });

    it("should handle single leaf", () => {
      const leaf = computeLeaf(USER_1, BigInt("1000000000000000000"), BigInt(1));
      const tree = new MerkleTree([leaf]);

      const root = tree.getRoot();
      expect(root).toBe(leaf); // Single leaf = root

      const proof = tree.getProof(leaf);
      expect(proof).toEqual([]);
    });

    it("should build tree with two leaves", () => {
      const leaf1 = computeLeaf(USER_1, BigInt("1000000000000000000"), BigInt(1));
      const leaf2 = computeLeaf(USER_2, BigInt("2000000000000000000"), BigInt(1));

      const tree = new MerkleTree([leaf1, leaf2]);
      const root = tree.getRoot();

      expect(root).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(root).not.toBe(leaf1);
      expect(root).not.toBe(leaf2);

      // Both leaves should have proofs
      const proof1 = tree.getProof(leaf1);
      const proof2 = tree.getProof(leaf2);

      expect(proof1).toHaveLength(1);
      expect(proof2).toHaveLength(1);
    });

    it("should build tree with multiple leaves", () => {
      const leaves = [
        computeLeaf(USER_1, BigInt("1000000000000000000"), BigInt(1)),
        computeLeaf(USER_2, BigInt("2000000000000000000"), BigInt(1)),
        computeLeaf(USER_3, BigInt("3000000000000000000"), BigInt(1)),
      ];

      const tree = new MerkleTree(leaves);
      const root = tree.getRoot();

      expect(root).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // All leaves should have proofs
      for (const leaf of leaves) {
        const proof = tree.getProof(leaf);
        expect(proof).not.toBeNull();
        expect(proof!.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("should produce deterministic root regardless of input order", () => {
      const leaf1 = computeLeaf(USER_1, BigInt("1000000000000000000"), BigInt(1));
      const leaf2 = computeLeaf(USER_2, BigInt("2000000000000000000"), BigInt(1));
      const leaf3 = computeLeaf(USER_3, BigInt("3000000000000000000"), BigInt(1));

      const tree1 = new MerkleTree([leaf1, leaf2, leaf3]);
      const tree2 = new MerkleTree([leaf3, leaf1, leaf2]);
      const tree3 = new MerkleTree([leaf2, leaf3, leaf1]);

      expect(tree1.getRoot()).toBe(tree2.getRoot());
      expect(tree2.getRoot()).toBe(tree3.getRoot());
    });
  });

  describe("MerkleTree.verifyProof", () => {
    it("should verify valid proof", () => {
      const leaf1 = computeLeaf(USER_1, BigInt("1000000000000000000"), BigInt(1));
      const leaf2 = computeLeaf(USER_2, BigInt("2000000000000000000"), BigInt(1));
      const leaf3 = computeLeaf(USER_3, BigInt("3000000000000000000"), BigInt(1));

      const tree = new MerkleTree([leaf1, leaf2, leaf3]);
      const root = tree.getRoot();

      for (const leaf of [leaf1, leaf2, leaf3]) {
        const proof = tree.getProof(leaf)!;
        const isValid = MerkleTree.verifyProof(proof, root, leaf);
        expect(isValid).toBe(true);
      }
    });

    it("should reject invalid leaf", () => {
      const leaf1 = computeLeaf(USER_1, BigInt("1000000000000000000"), BigInt(1));
      const leaf2 = computeLeaf(USER_2, BigInt("2000000000000000000"), BigInt(1));
      const fakeLeaf = computeLeaf(USER_3, BigInt("999"), BigInt(99));

      const tree = new MerkleTree([leaf1, leaf2]);
      const root = tree.getRoot();
      const proof = tree.getProof(leaf1)!;

      // Proof for leaf1 should not verify fakeLeaf
      const isValid = MerkleTree.verifyProof(proof, root, fakeLeaf);
      expect(isValid).toBe(false);
    });

    it("should reject tampered proof", () => {
      const leaf1 = computeLeaf(USER_1, BigInt("1000000000000000000"), BigInt(1));
      const leaf2 = computeLeaf(USER_2, BigInt("2000000000000000000"), BigInt(1));

      const tree = new MerkleTree([leaf1, leaf2]);
      const root = tree.getRoot();
      const proof = tree.getProof(leaf1)!;

      // Tamper with proof
      const tamperedProof = [
        "0x" + "0".repeat(63) + "1", // Invalid proof element
      ];

      const isValid = MerkleTree.verifyProof(tamperedProof, root, leaf1);
      expect(isValid).toBe(false);
    });

    it("should reject wrong root", () => {
      const leaf1 = computeLeaf(USER_1, BigInt("1000000000000000000"), BigInt(1));
      const leaf2 = computeLeaf(USER_2, BigInt("2000000000000000000"), BigInt(1));

      const tree = new MerkleTree([leaf1, leaf2]);
      const proof = tree.getProof(leaf1)!;
      const fakeRoot = "0x" + "f".repeat(64);

      const isValid = MerkleTree.verifyProof(proof, fakeRoot, leaf1);
      expect(isValid).toBe(false);
    });
  });

  describe("buildMerkleTreeFromWithdrawals", () => {
    it("should build tree from withdrawal data", () => {
      const withdrawals: WithdrawalLeaf[] = [
        { user: USER_1, amount: BigInt("1000000000000000000"), nonce: BigInt(1) },
        { user: USER_2, amount: BigInt("2000000000000000000"), nonce: BigInt(1) },
        { user: USER_3, amount: BigInt("3000000000000000000"), nonce: BigInt(1) },
      ];

      const { root, getProof } = buildMerkleTreeFromWithdrawals(withdrawals);

      expect(root).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Get proof for each withdrawal
      for (const w of withdrawals) {
        const proof = getProof(w.user, w.amount, w.nonce);
        expect(proof).not.toBeNull();

        // Verify the proof
        const leaf = computeLeaf(w.user, w.amount, w.nonce);
        const isValid = MerkleTree.verifyProof(proof!, root, leaf);
        expect(isValid).toBe(true);
      }
    });

    it("should return null proof for non-existent withdrawal", () => {
      const withdrawals: WithdrawalLeaf[] = [
        { user: USER_1, amount: BigInt("1000000000000000000"), nonce: BigInt(1) },
      ];

      const { getProof } = buildMerkleTreeFromWithdrawals(withdrawals);

      // Non-existent withdrawal
      const proof = getProof(USER_2, BigInt("9999"), BigInt(99));
      expect(proof).toBeNull();
    });
  });

  describe("generateProof", () => {
    it("should generate proof for valid withdrawal", () => {
      const withdrawals: WithdrawalLeaf[] = [
        { user: USER_1, amount: BigInt("1000000000000000000"), nonce: BigInt(1) },
        { user: USER_2, amount: BigInt("2000000000000000000"), nonce: BigInt(2) },
      ];

      const proof = generateProof(withdrawals, USER_1, BigInt("1000000000000000000"), BigInt(1));

      expect(proof).not.toBeNull();
      expect(Array.isArray(proof)).toBe(true);
    });

    it("should return null for invalid withdrawal", () => {
      const withdrawals: WithdrawalLeaf[] = [
        { user: USER_1, amount: BigInt("1000000000000000000"), nonce: BigInt(1) },
      ];

      const proof = generateProof(
        withdrawals,
        USER_2, // Wrong user
        BigInt("1000000000000000000"),
        BigInt(1)
      );

      expect(proof).toBeNull();
    });
  });

  describe("End-to-end proof verification", () => {
    it("should work for realistic batch scenario", () => {
      // Simulate a batch of 10 withdrawals
      const withdrawals: WithdrawalLeaf[] = [];
      for (let i = 0; i < 10; i++) {
        withdrawals.push({
          user: ethers.Wallet.createRandom().address,
          amount: BigInt(Math.floor(Math.random() * 10) + 1) * BigInt("1000000000000000000"),
          nonce: BigInt(i + 1),
        });
      }

      const { root, getProof } = buildMerkleTreeFromWithdrawals(withdrawals);

      // Verify each withdrawal can be proven
      for (const w of withdrawals) {
        const proof = getProof(w.user, w.amount, w.nonce);
        expect(proof).not.toBeNull();

        const leaf = computeLeaf(w.user, w.amount, w.nonce);
        const isValid = MerkleTree.verifyProof(proof!, root, leaf);
        expect(isValid).toBe(true);
      }
    });
  });
});
