/**
 * Merkle Tree Utilities for L2 Bridge
 * 
 * Provides functions to:
 * - Build Merkle trees from withdrawal data
 * - Generate Merkle proofs for specific leaves
 * - Verify Merkle proofs
 * 
 * The tree structure matches the Solidity contract's verifyProof function:
 * - Leaves are hashed as: keccak256(abi.encodePacked(user, amount, nonce))
 * - Tree uses sorted pairs (left <= right) for deterministic structure
 */

import { ethers } from "ethers";

export interface WithdrawalLeaf {
  user: string;
  amount: bigint;
  nonce: bigint;
}

/**
 * Compute the leaf hash for a withdrawal
 * Matches Solidity: keccak256(abi.encodePacked(user, amount, nonce))
 */
export function computeLeaf(user: string, amount: bigint, nonce: bigint): string {
  // Ensure user is a valid address (checksummed)
  const userAddress = ethers.getAddress(user);
  
  // Encode: user (address, 20 bytes) + amount (uint256, 32 bytes) + nonce (uint256, 32 bytes)
  const encoded = ethers.solidityPacked(
    ["address", "uint256", "uint256"],
    [userAddress, amount, nonce]
  );
  
  return ethers.keccak256(encoded);
}

/**
 * Build a Merkle tree from an array of withdrawal leaves
 * Returns the root and a map of leaf -> proof
 */
export class MerkleTree {
  private leaves: string[];
  private tree: string[][];
  private root: string = "";
  private proofs: Map<string, string[]>;

  constructor(leaves: string[]) {
    if (leaves.length === 0) {
      throw new Error("MerkleTree: Cannot build tree with empty leaves");
    }

    // Sort leaves for deterministic tree structure
    this.leaves = [...leaves].sort();
    this.tree = [];
    this.proofs = new Map();
    
    this.buildTree();
  }

  /**
   * Build the Merkle tree bottom-up
   */
  private buildTree(): void {
    // Start with leaves
    let currentLevel = [...this.leaves];
    this.tree.push(currentLevel);

    // Build up to root
    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      
      // Process pairs
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : currentLevel[i];
        
        // Sort to ensure deterministic hashing (left <= right)
        const [first, second] = left <= right ? [left, right] : [right, left];
        const hash = ethers.keccak256(ethers.solidityPacked(["bytes32", "bytes32"], [first, second]));
        nextLevel.push(hash);
      }
      
      this.tree.push(nextLevel);
      currentLevel = nextLevel;
    }

    this.root = currentLevel[0];
    this.generateProofs();
  }

  /**
   * Generate proofs for all leaves
   */
  private generateProofs(): void {
    for (let i = 0; i < this.leaves.length; i++) {
      const proof: string[] = [];
      let index = i;
      
      // Traverse up the tree, collecting sibling hashes
      for (let level = 0; level < this.tree.length - 1; level++) {
        const currentLevel = this.tree[level];
        const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
        
        if (siblingIndex < currentLevel.length) {
          proof.push(currentLevel[siblingIndex]);
        } else {
          // If no sibling, use the node itself (for odd-length levels)
          proof.push(currentLevel[index]);
        }
        
        index = Math.floor(index / 2);
      }
      
      this.proofs.set(this.leaves[i], proof);
    }
  }

  /**
   * Get the Merkle root
   */
  getRoot(): string {
    return this.root;
  }

  /**
   * Get the Merkle proof for a specific leaf
   */
  getProof(leaf: string): string[] | null {
    return this.proofs.get(leaf) || null;
  }

  /**
   * Verify a Merkle proof
   * Matches Solidity contract's verifyProof function
   */
  static verifyProof(proof: string[], root: string, leaf: string): boolean {
    let computedHash = leaf;

    for (let i = 0; i < proof.length; i++) {
      const proofElement = proof[i];

      // Sort hashes (matches Solidity logic)
      if (computedHash <= proofElement) {
        computedHash = ethers.keccak256(
          ethers.solidityPacked(["bytes32", "bytes32"], [computedHash, proofElement])
        );
      } else {
        computedHash = ethers.keccak256(
          ethers.solidityPacked(["bytes32", "bytes32"], [proofElement, computedHash])
        );
      }
    }

    return computedHash === root;
  }
}

/**
 * Build a Merkle tree from withdrawal data
 */
export function buildMerkleTreeFromWithdrawals(withdrawals: WithdrawalLeaf[]): {
  root: string;
  getProof: (user: string, amount: bigint, nonce: bigint) => string[] | null;
} {
  // Compute all leaves
  const leaves = withdrawals.map((w) => computeLeaf(w.user, w.amount, w.nonce));

  // Build tree
  const tree = new MerkleTree(leaves);

  // Return root and proof getter
  return {
    root: tree.getRoot(),
    getProof: (user: string, amount: bigint, nonce: bigint) => {
      const leaf = computeLeaf(user, amount, nonce);
      return tree.getProof(leaf);
    },
  };
}

/**
 * Generate a Merkle proof for a specific withdrawal
 * @param withdrawals All withdrawals in the batch
 * @param user User address
 * @param amount Withdrawal amount
 * @param nonce Withdrawal nonce
 * @returns Merkle proof array, or null if withdrawal not found
 */
export function generateProof(
  withdrawals: WithdrawalLeaf[],
  user: string,
  amount: bigint,
  nonce: bigint
): string[] | null {
  const { getProof } = buildMerkleTreeFromWithdrawals(withdrawals);
  return getProof(user, amount, nonce);
}

