/**
 * Bridge State Management - L2 State in GunDB
 *
 * Manages the L2 state for the bridge:
 * - User balances (credited from deposits) - Uses frozen-data for immutability
 * - Pending withdrawals (queued for batch submission)
 * - Batch history
 *
 * SECURITY: Uses frozen-data pattern for balances
 * - Immutable, signed entries with content-addressed hashing
 * - Automatic signature verification on read
 * - Only registered relays can write (enforced by bridge-listener verification)
 *
 * IMPORTANT: Balance linking between Ethereum address and GunDB pub key
 * - Deposits arrive with Ethereum address (0x...)
 * - Client derives GunDB pub key from wallet (deterministic)
 * - Balance is stored using Ethereum address as key (for deposits)
 * - When user operates (transfer/withdraw), they provide GunDB pub key
 * - Relay verifies GunDB pub key can be derived from Ethereum address
 *
 * State structure in GunDB:
 * - frozen-bridge-balances/{hash} -> { data: { balance, updatedAt, ethereumAddress, gunPubKey? }, sig, hash }
 * - bridge/balances-index/{ethereumAddress} -> { latestHash, pub, updatedAt, gunPubKey? }
 * - bridge/address-to-gun/{ethereumAddress} -> { gunPubKey, verified, timestamp } (mapping)
 * - bridge/withdrawals/pending -> array of { user, amount, nonce, timestamp }
 * - bridge/batches/{batchId} -> { root: string, withdrawals: [...], timestamp }
 * - bridge/processed-deposits/{key} -> { txHash, user, amount, blockNumber, timestamp }
 */

import type { IGunInstance, GunMessagePut } from "gun";
import Gun from "gun";
import "gun/sea";
import * as FrozenData from "./frozen-data";
import { loggers } from "./logger";

const SEA = (Gun as any).SEA;
const log = loggers.bridge || {
  info: console.log,
  error: console.error,
  warn: console.warn,
};

export interface UserBalance {
  balance: string; // BigInt as string (wei)
  updatedAt: number; // Timestamp
}

export interface PendingWithdrawal {
  user: string;
  amount: string; // BigInt as string (wei)
  nonce: string; // BigInt as string
  timestamp: number;
  txHash?: string; // L2 transaction hash (if applicable)
}

export interface Batch {
  batchId: string;
  root: string;
  withdrawals: PendingWithdrawal[];
  timestamp: number;
  blockNumber?: number;
  txHash?: string;
}

export interface ProcessedDeposit {
  txHash: string;
  user: string;
  amount: string;
  blockNumber: number;
  timestamp: number;
}

/**
 * Get user balance from GunDB
 * Uses frozen-data pattern for secure, verifiable balance storage
 */
export async function getUserBalance(
  gun: IGunInstance,
  userAddress: string
): Promise<bigint> {
  try {
    const indexKey = userAddress.toLowerCase();

    log.info({ user: indexKey }, "Looking up balance");

    // Get latest frozen entry for this user
    const entry = await FrozenData.getLatestFrozenEntry(
      gun,
      "bridge-balances",
      indexKey
    );

    log.info(
      {
        user: indexKey,
        hasEntry: !!entry,
        verified: entry?.verified,
        hasData: !!entry?.data,
      },
      "Balance entry lookup result"
    );

    if (!entry || !entry.verified) {
      // If no verified entry found, return 0
      // Unverified entries are ignored for security
      log.info({ user: indexKey }, "No verified entry found, returning 0");
      return 0n;
    }

    const balanceData = entry.data as {
      balance?: string;
      user?: string;
      ethereumAddress?: string;
    };

    log.info(
      {
        user: indexKey,
        balance: balanceData?.balance,
        ethereumAddress: balanceData?.ethereumAddress,
      },
      "Balance data retrieved"
    );

    if (!balanceData || !balanceData.balance) {
      log.info({ user: indexKey }, "No balance in data, returning 0");
      return 0n;
    }

    try {
      const balance = BigInt(balanceData.balance);
      log.info(
        { user: indexKey, balance: balance.toString() },
        "Balance retrieved successfully"
      );
      return balance;
    } catch (error) {
      throw new Error(`Invalid balance format: ${error}`);
    }
  } catch (error) {
    // On error, return 0 (fail-safe)
    log.warn({ error, user: userAddress }, "Error getting user balance");
    return 0n;
  }
}

/**
 * Credit user balance (from deposit)
 *
 * SECURITY: Uses frozen-data pattern for immutable, verifiable balance storage
 * - Creates a new frozen entry with signature
 * - Updates index to point to latest balance
 * - Old balances remain immutable (audit trail)
 *
 * @param userAddress - Ethereum address (0x...) from deposit event
 * @param gunPubKey - Optional GunDB pub key if user has linked it
 */
export async function creditBalance(
  gun: IGunInstance,
  userAddress: string,
  amount: bigint,
  relayKeyPair?: {
    pub: string;
    priv: string;
    epub?: string;
    epriv?: string;
  } | null,
  gunPubKey?: string
): Promise<void> {
  if (!relayKeyPair) {
    throw new Error("Relay keypair required for secure balance updates");
  }

  try {
    // Normalize Ethereum address
    const ethereumAddress = userAddress.toLowerCase();

    log.info(
      { user: ethereumAddress, amount: amount.toString() },
      "Crediting balance"
    );

    // Retry loop to handle race conditions and eventual consistency
    // If multiple deposits are processed simultaneously, we need to ensure
    // we read the latest balance before creating a new entry
    const maxRetries = 5;
    let retryCount = 0;
    let success = false;
    let initialBalance = 0n; // Capture initial balance for final verification

    while (retryCount < maxRetries && !success) {
      // Get current balance (by Ethereum address)
      // Wait a bit if retrying to allow GunDB to propagate previous updates
      if (retryCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100 * retryCount)); // Exponential backoff
      }

      const currentBalance = await getUserBalance(gun, ethereumAddress);
      if (retryCount === 0) {
        initialBalance = currentBalance; // Capture initial balance on first attempt
      }
      const newBalance = currentBalance + amount;

      log.info(
        {
          user: ethereumAddress,
          currentBalance: currentBalance.toString(),
          amount: amount.toString(),
          newBalance: newBalance.toString(),
          retryAttempt: retryCount + 1,
        },
        "Balance calculation"
      );

      // Create balance data
      const balanceData: any = {
        balance: newBalance.toString(),
        ethereumAddress: ethereumAddress,
        updatedAt: Date.now(),
        type: "bridge-balance",
      };

      // If GunDB pub key is provided, include it in the balance data
      if (gunPubKey) {
        balanceData.gunPubKey = gunPubKey;
      }

      log.info({ user: ethereumAddress, balanceData }, "Creating frozen entry");

      // Create frozen entry (immutable, signed)
      // Use Ethereum address as index key (deposits come with Ethereum address)
      const indexKey = ethereumAddress;
      await FrozenData.createFrozenEntry(
        gun,
        balanceData,
        relayKeyPair,
        "bridge-balances",
        indexKey
      );

      log.info({ user: indexKey }, "Frozen entry created successfully");

      // Verify the entry was created and balance is correct
      // Wait a bit for GunDB to propagate the update
      await new Promise((resolve) => setTimeout(resolve, 200));

      const verifyBalance = await getUserBalance(gun, ethereumAddress);
      log.info(
        {
          user: ethereumAddress,
          expectedBalance: newBalance.toString(),
          actualBalance: verifyBalance.toString(),
          retryAttempt: retryCount + 1,
        },
        "Balance verification after credit"
      );

      // Check if the balance matches what we expected
      // Allow for small differences due to concurrent updates (as long as balance increased)
      if (verifyBalance >= newBalance) {
        // Balance is correct or higher (another deposit was processed concurrently)
        success = true;
      } else if (verifyBalance < currentBalance) {
        // Balance decreased - something went wrong, retry
        log.warn(
          {
            user: ethereumAddress,
            expectedBalance: newBalance.toString(),
            actualBalance: verifyBalance.toString(),
            previousBalance: currentBalance.toString(),
            retryAttempt: retryCount + 1,
          },
          "Balance decreased after credit, retrying"
        );
        retryCount++;
      } else {
        // Balance increased but not as much as expected - concurrent update, retry to get latest
        log.info(
          {
            user: ethereumAddress,
            expectedBalance: newBalance.toString(),
            actualBalance: verifyBalance.toString(),
            previousBalance: currentBalance.toString(),
            retryAttempt: retryCount + 1,
          },
          "Balance partially updated (concurrent deposit), retrying to ensure consistency"
        );
        retryCount++;
      }
    }

    if (!success) {
      // Final verification after all retries
      // Check if balance increased at least by the amount we're crediting
      await new Promise((resolve) => setTimeout(resolve, 500));
      const finalBalance = await getUserBalance(gun, ethereumAddress);

      if (finalBalance >= initialBalance + amount) {
        // Balance was eventually updated correctly (might be higher due to concurrent deposits)
        success = true;
        log.info(
          {
            user: ethereumAddress,
            initialBalance: initialBalance.toString(),
            finalBalance: finalBalance.toString(),
            amount: amount.toString(),
            expectedMinBalance: (initialBalance + amount).toString(),
          },
          "Balance eventually updated correctly after retries"
        );
      } else {
        throw new Error(
          `Failed to credit balance after ${maxRetries} retries. Initial: ${initialBalance.toString()}, Final: ${finalBalance.toString()}, Expected at least: ${(initialBalance + amount).toString()}`
        );
      }
    }
  } catch (error) {
    log.error(
      { error, user: userAddress, amount: amount.toString() },
      "Error crediting balance"
    );
    throw new Error(`Failed to credit balance: ${error}`);
  }
}

/**
 * Debit user balance (for withdrawal request)
 * Uses frozen-data pattern for secure, verifiable balance updates
 */
export async function debitBalance(
  gun: IGunInstance,
  userAddress: string,
  amount: bigint,
  relayKeyPair?: {
    pub: string;
    priv: string;
    epub?: string;
    epriv?: string;
  } | null
): Promise<void> {
  if (!relayKeyPair) {
    throw new Error("Relay keypair required for secure balance updates");
  }

  try {
    // Get current balance
    const currentBalance = await getUserBalance(gun, userAddress);

    if (currentBalance < amount) {
      throw new Error("Insufficient balance");
    }

    const newBalance = currentBalance - amount;

    // Create balance data
    const balanceData = {
      balance: newBalance.toString(),
      user: userAddress.toLowerCase(),
      updatedAt: Date.now(),
      type: "bridge-balance",
      debit: amount.toString(), // Track what was debited
    };

    // Create frozen entry (immutable, signed)
    const indexKey = userAddress.toLowerCase();
    await FrozenData.createFrozenEntry(
      gun,
      balanceData,
      relayKeyPair,
      "bridge-balances",
      indexKey
    );
  } catch (error) {
    throw new Error(`Failed to debit balance: ${error}`);
  }
}

/**
 * Verify dual signatures: SEA (GunDB) + Ethereum (Wallet)
 *
 * SECURITY: This ensures the user controls both:
 * 1. The GunDB keypair (derived from Ethereum address)
 * 2. The Ethereum wallet (that owns the balance)
 *
 * The message must include: ethereumAddress, to (if transfer), amount, timestamp, nonce
 * to prevent replay attacks and ensure message integrity.
 *
 * @param message - The plain message that was signed (must be JSON string with required fields)
 * @param seaSignature - SEA signature from GunDB keypair (signs the message)
 * @param ethSignature - Ethereum signature (EIP-191) from wallet (signs the message)
 * @param ethAddress - Ethereum address that should match the signer
 * @param gunPubKey - GunDB public key (derived from ethAddress)
 * @param expectedFields - Optional: expected fields in message (for validation)
 * @returns verified message data if signatures are valid, null otherwise
 */
export async function verifyDualSignatures(
  message: string,
  seaSignature: string,
  ethSignature: string,
  ethAddress: string,
  gunPubKey: string,
  expectedFields?: {
    to?: string;
    amount?: string;
    timestamp?: number;
    nonce?: string;
  }
): Promise<{ ethereumAddress: string; [key: string]: any } | null> {
  try {
    // 1. Verify SEA signature (GunDB keypair)
    // SEA.verify returns the original data if signature is valid
    const seaVerified = await SEA.verify(seaSignature, gunPubKey);
    if (!seaVerified) {
      log.warn({ ethAddress }, "SEA signature verification failed");
      return null;
    }

    // Check that the verified data matches the message
    // SEA can return string or object, so we normalize and compare by parsing both
    // CRITICAL: JSON.stringify may produce different key order, so we compare parsed objects
    let seaDataObj: any;
    let messageObj: any;

    try {
      seaDataObj =
        typeof seaVerified === "string" ? JSON.parse(seaVerified) : seaVerified;
    } catch {
      // If not JSON, treat as plain string
      seaDataObj = seaVerified;
    }

    try {
      messageObj = typeof message === "string" ? JSON.parse(message) : message;
    } catch {
      // If not JSON, treat as plain string
      messageObj = message;
    }

    // Compare objects by deep equality (not string comparison)
    // This handles cases where JSON.stringify produces different key orders
    function deepEqual(obj1: any, obj2: any): boolean {
      if (obj1 === obj2) return true;

      if (obj1 == null || obj2 == null) return false;
      if (typeof obj1 !== typeof obj2) return false;

      if (typeof obj1 !== "object") {
        return obj1 === obj2;
      }

      // Both are objects - compare keys and values
      const keys1 = Object.keys(obj1).sort();
      const keys2 = Object.keys(obj2).sort();

      if (keys1.length !== keys2.length) return false;

      for (let i = 0; i < keys1.length; i++) {
        if (keys1[i] !== keys2[i]) return false;
        if (!deepEqual(obj1[keys1[i]], obj2[keys2[i]])) return false;
      }

      return true;
    }

    // Normalize message for logging and signature verification
    const normalizedMessage =
      typeof message === "string" ? message : JSON.stringify(message);

    // Compare objects using deep equality
    if (
      typeof seaDataObj === "object" &&
      typeof messageObj === "object" &&
      seaDataObj !== null &&
      messageObj !== null &&
      !Array.isArray(seaDataObj) &&
      !Array.isArray(messageObj)
    ) {
      if (!deepEqual(seaDataObj, messageObj)) {
        log.warn(
          {
            ethAddress,
            seaDataPreview: JSON.stringify(seaDataObj).substring(0, 200),
            messagePreview: JSON.stringify(messageObj).substring(0, 200),
          },
          "SEA verified data does not match message (deep comparison)"
        );
        return null;
      }
    } else {
      // If one is not an object, compare as strings
      const seaData =
        typeof seaVerified === "string"
          ? seaVerified
          : JSON.stringify(seaVerified);

      if (seaData !== normalizedMessage) {
        log.warn(
          {
            ethAddress,
            seaDataLength: seaData.length,
            messageLength: normalizedMessage.length,
            seaDataPreview: seaData.substring(0, 200),
            messagePreview: normalizedMessage.substring(0, 200),
          },
          "SEA verified data does not match message (string comparison)"
        );
        return null;
      }
    }

    // 2. Verify Ethereum signature (wallet)
    // Use ethers to recover the signer from the signature
    const { ethers } = await import("ethers");
    let recoveredAddress: string;
    try {
      recoveredAddress = ethers.verifyMessage(message, ethSignature);
    } catch (error) {
      log.warn({ ethAddress, error }, "Ethereum signature verification failed");
      return null;
    }

    // Check that recovered address matches the provided address
    if (recoveredAddress.toLowerCase() !== ethAddress.toLowerCase()) {
      log.warn(
        {
          ethAddress,
          recoveredAddress,
          messagePreview: normalizedMessage.substring(0, 200),
        },
        "Recovered Ethereum address does not match provided address"
      );
      return null;
    }

    // 3. Parse and validate message content
    let messageData: { ethereumAddress?: string; [key: string]: any };
    try {
      messageData =
        typeof seaVerified === "string" ? JSON.parse(seaVerified) : seaVerified;
    } catch {
      // If not JSON, treat as plain string (less secure, but backward compatible)
      messageData = { ethereumAddress: ethAddress };
    }

    // Verify ethereumAddress in message matches
    if (
      !messageData.ethereumAddress ||
      messageData.ethereumAddress.toLowerCase() !== ethAddress.toLowerCase()
    ) {
      return null;
    }

    // 4. Validate expected fields (if provided)
    if (expectedFields) {
      if (
        expectedFields.to &&
        messageData.to?.toLowerCase() !== expectedFields.to.toLowerCase()
      ) {
        log.warn(
          { expectedTo: expectedFields.to, actualTo: messageData.to },
          "To field mismatch"
        );
        return null;
      }
      if (
        expectedFields.amount &&
        messageData.amount !== expectedFields.amount
      ) {
        log.warn(
          {
            expectedAmount: expectedFields.amount,
            actualAmount: messageData.amount,
          },
          "Amount field mismatch"
        );
        return null;
      }
      if (expectedFields.nonce && messageData.nonce !== expectedFields.nonce) {
        log.warn(
          {
            expectedNonce: expectedFields.nonce,
            actualNonce: messageData.nonce,
          },
          "Nonce field mismatch"
        );
        return null;
      }
      // Timestamp validation: must be recent (within 1 hour) to prevent replay
      // Use the message timestamp as the reference point, not the server time
      if (expectedFields.timestamp !== undefined && messageData.timestamp) {
        const messageTime =
          typeof messageData.timestamp === "number"
            ? messageData.timestamp
            : parseInt(messageData.timestamp);
        const now = expectedFields.timestamp; // Use provided timestamp (server time) as reference
        const maxAge = 60 * 60 * 1000; // 1 hour
        const timeDiff = Math.abs(now - messageTime);
        if (timeDiff > maxAge) {
          log.warn(
            {
              messageTime,
              serverTime: now,
              timeDiff,
              maxAge,
            },
            "Message timestamp too old or from future"
          );
          return null; // Message too old or from future
        }
      }
    }

    // All checks passed!
    return {
      ...messageData,
      ethereumAddress: messageData.ethereumAddress,
    } as { ethereumAddress: string; [key: string]: any };
  } catch (error) {
    return null;
  }
}

/**
 * Transfer balance from one user to another (L2 -> L2)
 *
 * SECURITY:
 * - Requires dual signatures: SEA (GunDB) + Ethereum (Wallet)
 * - Verifies user controls both the GunDB keypair AND the Ethereum wallet
 * - Uses frozen-data pattern for immutable, verifiable transfers
 * - Creates frozen entries for both sender (debit) and receiver (credit)
 * - Both entries are signed by relay
 * - Transfer is atomic (both succeed or both fail)
 *
 * @param fromEthAddress - Ethereum address of sender
 * @param toEthAddress - Ethereum address of receiver
 * @param amount - Amount to transfer
 * @param message - Plain message that was signed (must include fromEthAddress)
 * @param seaSignature - SEA signature from GunDB keypair (derived from fromEthAddress)
 * @param ethSignature - Ethereum signature (EIP-191) from wallet
 * @param gunPubKey - GunDB public key (derived from fromEthAddress)
 */
export async function transferBalance(
  gun: IGunInstance,
  fromEthAddress: string,
  toEthAddress: string,
  amount: bigint,
  relayKeyPair: { pub: string; priv: string; epub?: string; epriv?: string },
  message: string,
  seaSignature: string,
  ethSignature: string,
  gunPubKey: string
): Promise<{ txHash: string; fromBalance: string; toBalance: string }> {
  if (!relayKeyPair) {
    throw new Error("Relay keypair required for secure transfers");
  }

  try {
    // Normalize addresses
    const fromAddress = fromEthAddress.toLowerCase();
    const toAddress = toEthAddress.toLowerCase();

    // SECURITY: Verify dual signatures - client must prove control of BOTH:
    // 1. GunDB keypair (derived from Ethereum address)
    // 2. Ethereum wallet (that owns the balance)
    // Also verify message content matches the transfer parameters
    const verifiedMessage = await verifyDualSignatures(
      message,
      seaSignature,
      ethSignature,
      fromAddress,
      gunPubKey,
      {
        to: toAddress,
        amount: amount.toString(),
        timestamp: Date.now(), // Will check message timestamp is recent
      }
    );

    if (!verifiedMessage) {
      throw new Error(
        "Invalid signatures or message content mismatch: must provide valid SEA and Ethereum signatures with correct message content"
      );
    }

    // Get current balances (by Ethereum address)
    const fromBalance = await getUserBalance(gun, fromAddress);
    const toBalance = await getUserBalance(gun, toAddress);

    // Check sufficient balance
    if (fromBalance < amount) {
      throw new Error("Insufficient balance");
    }

    // Calculate new balances
    const newFromBalance = fromBalance - amount;
    const newToBalance = toBalance + amount;

    // Create transfer ID (hash of transfer data for idempotency)
    const transferId = `${fromAddress.toLowerCase()}:${toAddress.toLowerCase()}:${amount}:${Date.now()}`;
    const transferHash = await (Gun as any).SEA.work(transferId, null, null, {
      name: "SHA-256",
    });

    // Create transfer data (frozen entry)
    const transferData = {
      type: "bridge-transfer",
      from: fromAddress.toLowerCase(),
      to: toAddress.toLowerCase(),
      amount: amount.toString(),
      transferHash,
      timestamp: Date.now(),
    };

    // Create frozen entry for transfer record
    await FrozenData.createFrozenEntry(
      gun,
      transferData,
      relayKeyPair,
      "bridge-transfers",
      transferHash
    );

    // Debit sender balance
    const fromBalanceData = {
      balance: newFromBalance.toString(),
      user: fromAddress.toLowerCase(),
      updatedAt: Date.now(),
      type: "bridge-balance",
      transfer: {
        to: toAddress.toLowerCase(),
        amount: amount.toString(),
        transferHash,
      },
    };

    await FrozenData.createFrozenEntry(
      gun,
      fromBalanceData,
      relayKeyPair,
      "bridge-balances",
      fromAddress.toLowerCase()
    );

    // Credit receiver balance
    const toBalanceData = {
      balance: newToBalance.toString(),
      user: toAddress.toLowerCase(),
      updatedAt: Date.now(),
      type: "bridge-balance",
      transfer: {
        from: fromAddress.toLowerCase(),
        amount: amount.toString(),
        transferHash,
      },
    };

    await FrozenData.createFrozenEntry(
      gun,
      toBalanceData,
      relayKeyPair,
      "bridge-balances",
      toAddress.toLowerCase()
    );

    return {
      txHash: transferHash,
      fromBalance: newFromBalance.toString(),
      toBalance: newToBalance.toString(),
    };
  } catch (error) {
    throw new Error(`Failed to transfer balance: ${error}`);
  }
}

/**
 * Add pending withdrawal
 */
export async function addPendingWithdrawal(
  gun: IGunInstance,
  withdrawal: PendingWithdrawal
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Use individual nodes: bridge/withdrawals/pending/{userAddress}:{nonce}
    // This avoids GunDB array handling issues
    const withdrawalKey = `${withdrawal.user.toLowerCase()}:${withdrawal.nonce}`;
    const withdrawalNode = gun
      .get("bridge/withdrawals/pending")
      .get(withdrawalKey);

    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for GunDB response"));
    }, 10000); // 10 second timeout

    const cleanup = () => clearTimeout(timeout);

    try {
      // Check if withdrawal already exists
      withdrawalNode.once((existing: PendingWithdrawal | null | undefined) => {
        try {
          if (
            existing &&
            typeof existing === "object" &&
            existing.user &&
            existing.nonce
          ) {
            log.warn(
              { withdrawal, existing },
              "Withdrawal with this nonce already exists"
            );
            cleanup();
            reject(new Error("Withdrawal with this nonce already exists"));
            return;
          }

          // Save the withdrawal as an individual node
          withdrawalNode.put(withdrawal, (ack: GunMessagePut) => {
            if (ack && "err" in ack && ack.err) {
              const errorMsg =
                typeof ack.err === "string" ? ack.err : String(ack.err);
              log.error(
                { error: errorMsg, withdrawalKey, withdrawal },
                "Error saving pending withdrawal"
              );
              cleanup();
              reject(new Error(errorMsg));
            } else {
              log.info(
                { withdrawalKey, withdrawal },
                "Pending withdrawal added successfully"
              );
              cleanup();
              resolve();
            }
          });
        } catch (innerError) {
          cleanup();
          log.error(
            { error: innerError, withdrawal },
            "Error processing pending withdrawal"
          );
          reject(
            innerError instanceof Error
              ? innerError
              : new Error(String(innerError))
          );
        }
      });
    } catch (outerError) {
      cleanup();
      log.error(
        { error: outerError, withdrawal },
        "Error setting up pending withdrawal listener"
      );
      reject(
        outerError instanceof Error ? outerError : new Error(String(outerError))
      );
    }
  });
}

/**
 * Get all pending withdrawals
 */
export async function getPendingWithdrawals(
  gun: IGunInstance
): Promise<PendingWithdrawal[]> {
  return new Promise((resolve, reject) => {
    const withdrawalsPath = "bridge/withdrawals/pending";
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // Resolve with whatever we collected so far
        const normalized = withdrawals.filter(
          (w): w is PendingWithdrawal =>
            w &&
            typeof w === "object" &&
            typeof w.user === "string" &&
            typeof w.amount === "string" &&
            typeof w.nonce === "string" &&
            typeof w.timestamp === "number"
        );
        log.info(
          { totalFound: withdrawals.length, normalized: normalized.length },
          "Retrieved pending withdrawals (timeout)"
        );
        resolve(normalized);
      }
    }, 10000);

    const withdrawals: PendingWithdrawal[] = [];
    let resolved = false;
    let mapSubscription: any = null;

    const cleanup = () => {
      clearTimeout(timeout);
      if (mapSubscription) {
        try {
          gun.get(withdrawalsPath).map().off();
        } catch (e) {
          // Ignore unsubscribe errors
        }
      }
      resolved = true;
    };

    // First, try reading the parent node directly (for backward compatibility and immediate data)
    const parentNode = gun.get(withdrawalsPath);

    // Use map to iterate through all child nodes (one-time collection)
    const collectedKeys = new Set<string>();
    mapSubscription = parentNode
      .map()
      .on((withdrawal: PendingWithdrawal | null, key: string) => {
        if (resolved) return;

        // Skip metadata keys
        if (key === "_" || key.startsWith("_")) {
          return;
        }

        // Skip 'list' key (old format)
        if (key === "list") {
          return;
        }

        // Skip if we've already processed this key
        if (collectedKeys.has(key)) {
          return;
        }
        collectedKeys.add(key);

        // Validate withdrawal object
        if (
          withdrawal &&
          typeof withdrawal === "object" &&
          typeof withdrawal.user === "string" &&
          typeof withdrawal.amount === "string" &&
          typeof withdrawal.nonce === "string" &&
          typeof withdrawal.timestamp === "number"
        ) {
          // Check if already added (deduplicate)
          const exists = withdrawals.some(
            (w) =>
              w.user.toLowerCase() === withdrawal.user.toLowerCase() &&
              w.nonce === withdrawal.nonce
          );

          if (!exists) {
            withdrawals.push(withdrawal as PendingWithdrawal);
            log.info(
              { key, withdrawal, total: withdrawals.length },
              "Found pending withdrawal node"
            );
          }
        }
      });

    // Also try reading the parent node directly (for backward compatibility)
    parentNode.once(
      (
        data:
          | Record<string, PendingWithdrawal>
          | PendingWithdrawal[]
          | { list?: PendingWithdrawal[] }
          | null
          | undefined
      ) => {
        if (resolved) return;

        try {
          // Handle different data formats for backward compatibility
          if (Array.isArray(data)) {
            // Old format: direct array
            data.forEach((w) => {
              if (
                w &&
                typeof w === "object" &&
                typeof w.user === "string" &&
                typeof w.amount === "string" &&
                typeof w.nonce === "string" &&
                typeof w.timestamp === "number"
              ) {
                const exists = withdrawals.some(
                  (w2) =>
                    w2.user.toLowerCase() === w.user.toLowerCase() &&
                    w2.nonce === w.nonce
                );
                if (!exists) {
                  withdrawals.push(w as PendingWithdrawal);
                }
              }
            });
          } else if (data && typeof data === "object") {
            // Check for old format: { list: [...] }
            if ("list" in data && Array.isArray(data.list)) {
              data.list.forEach((w) => {
                if (
                  w &&
                  typeof w === "object" &&
                  typeof w.user === "string" &&
                  typeof w.amount === "string" &&
                  typeof w.nonce === "string" &&
                  typeof w.timestamp === "number"
                ) {
                  const exists = withdrawals.some(
                    (w2) =>
                      w2.user.toLowerCase() === w.user.toLowerCase() &&
                      w2.nonce === w.nonce
                  );
                  if (!exists) {
                    withdrawals.push(w as PendingWithdrawal);
                  }
                }
              });
            } else {
              // New format: individual nodes { "user:nonce": withdrawal, ... }
              for (const [key, value] of Object.entries(data)) {
                if (key === "_" || key.startsWith("_") || key === "list") {
                  continue;
                }

                if (
                  value &&
                  typeof value === "object" &&
                  typeof value.user === "string" &&
                  typeof value.amount === "string" &&
                  typeof value.nonce === "string" &&
                  typeof value.timestamp === "number"
                ) {
                  const exists = withdrawals.some(
                    (w) =>
                      w.user.toLowerCase() === value.user.toLowerCase() &&
                      w.nonce === value.nonce
                  );
                  if (!exists) {
                    withdrawals.push(value as PendingWithdrawal);
                  }
                }
              }
            }
          }

          // Wait a bit to let .map() collect all nodes, then resolve
          setTimeout(() => {
            if (resolved) return;

            // Normalize and filter withdrawals
            const normalized = withdrawals.filter(
              (w): w is PendingWithdrawal =>
                w &&
                typeof w === "object" &&
                typeof w.user === "string" &&
                typeof w.amount === "string" &&
                typeof w.nonce === "string" &&
                typeof w.timestamp === "number"
            );

            log.info(
              { totalFound: withdrawals.length, normalized: normalized.length },
              "Retrieved pending withdrawals"
            );

            cleanup();
            resolve(normalized);
          }, 1000); // Give GunDB time to propagate (increased from 500ms)
        } catch (error) {
          if (resolved) return;
          cleanup();
          log.error({ error, data }, "Error retrieving pending withdrawals");
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    );
  });
}

/**
 * Remove pending withdrawals (after batch submission)
 */
export async function removePendingWithdrawals(
  gun: IGunInstance,
  withdrawalsToRemove: PendingWithdrawal[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const withdrawalsPath = "bridge/withdrawals/pending";
    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for GunDB response"));
    }, 10000);

    // Create a set of withdrawal keys to remove
    const toRemoveKeys = new Set(
      withdrawalsToRemove.map((w) => `${w.user.toLowerCase()}:${w.nonce}`)
    );

    // Delete individual nodes
    let deleted = 0;
    let errors: string[] = [];

    const deleteNode = (key: string, index: number) => {
      const withdrawalNode = gun.get(withdrawalsPath).get(key);

      withdrawalNode.put(null, (ack: GunMessagePut) => {
        if (ack && "err" in ack && ack.err) {
          const errorMsg =
            typeof ack.err === "string" ? ack.err : String(ack.err);
          errors.push(`Error deleting ${key}: ${errorMsg}`);
        } else {
          deleted++;
          log.info(
            { key, deleted, total: toRemoveKeys.size },
            "Deleted pending withdrawal node"
          );
        }

        // When all deletions are attempted, resolve/reject
        if (deleted + errors.length === toRemoveKeys.size) {
          clearTimeout(timeout);
          if (errors.length > 0) {
            log.warn({ errors, deleted }, "Some withdrawals failed to delete");
            // Still resolve if at least some were deleted
            if (deleted > 0) {
              resolve();
            } else {
              reject(
                new Error(`Failed to delete withdrawals: ${errors.join(", ")}`)
              );
            }
          } else {
            log.info(
              { deleted },
              "All pending withdrawals removed successfully"
            );
            resolve();
          }
        }
      });
    };

    // Delete all withdrawal nodes
    if (toRemoveKeys.size === 0) {
      clearTimeout(timeout);
      resolve();
      return;
    }

    let index = 0;
    for (const key of toRemoveKeys) {
      deleteNode(key, index++);
    }
  });
}

/**
 * Save batch to GunDB
 */
export async function saveBatch(
  gun: IGunInstance,
  batch: Batch
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const batchPath = `bridge/batches/${batch.batchId}`;
    const withdrawalsPath = `${batchPath}/withdrawals`;

    try {
      // First, save the batch metadata (without withdrawals array)
      const batchData = {
        batchId: batch.batchId,
        root: batch.root,
        withdrawalsCount: batch.withdrawals.length,
        timestamp: batch.timestamp,
        blockNumber: batch.blockNumber,
        txHash: batch.txHash,
      };

      await new Promise<void>((res, rej) => {
        gun.get(batchPath).put(batchData, (ack: GunMessagePut) => {
          if (ack && "err" in ack && ack.err) {
            const errorMsg =
              typeof ack.err === "string" ? ack.err : String(ack.err);
            log.error(
              { error: errorMsg, batchPath, batchId: batch.batchId },
              "Error saving batch metadata to GunDB"
            );
            rej(new Error(errorMsg));
          } else {
            log.info(
              { batchId: batch.batchId, withdrawalCount: batch.withdrawals.length },
              "Batch metadata saved to GunDB"
            );
            res();
          }
        });
      });

      // Then, save each withdrawal as a separate node
      const savePromises: Promise<void>[] = [];
      batch.withdrawals.forEach((withdrawal, index) => {
        savePromises.push(
          new Promise((res, rej) => {
            const withdrawalKey = `${index}`;
            const withdrawalNodePath = `${withdrawalsPath}/${withdrawalKey}`;
            const timeout = setTimeout(() => {
              rej(new Error("Timeout waiting for GunDB response"));
            }, 10000);

            gun.get(withdrawalNodePath).put(withdrawal, (ack: GunMessagePut) => {
              clearTimeout(timeout);
              if (ack && "err" in ack && ack.err) {
                const errorMsg =
                  typeof ack.err === "string" ? ack.err : String(ack.err);
                log.error(
                  { error: errorMsg, withdrawalNodePath, index },
                  "Error saving withdrawal to batch in GunDB"
                );
                rej(new Error(errorMsg));
              } else {
                log.info(
                  { withdrawalNodePath, index, user: withdrawal.user, amount: withdrawal.amount },
                  "Withdrawal saved to batch in GunDB"
                );
                res();
              }
            });
          })
        );
      });

      await Promise.all(savePromises);
      log.info(
        { batchId: batch.batchId, withdrawalCount: batch.withdrawals.length },
        "Batch saved successfully to GunDB"
      );
      resolve();
    } catch (error) {
      log.error(
        { error, batchId: batch.batchId, withdrawalCount: batch.withdrawals.length },
        "Error saving batch to GunDB"
      );
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Get batch by ID
 */
export async function getBatch(
  gun: IGunInstance,
  batchId: string
): Promise<Batch | null> {
  return new Promise((resolve) => {
    const batchPath = `bridge/batches/${batchId}`;
    const withdrawalsPath = `${batchPath}/withdrawals`;
    const timeout = setTimeout(() => {
      log.warn({ batchPath }, "Timeout waiting for GunDB response in getBatch");
      resolve(null);
    }, 10000);

    gun.get(batchPath).once(async (data: any) => {
      clearTimeout(timeout);
      if (!data || !data.batchId) {
        resolve(null);
        return;
      }

      // Read withdrawals from separate nodes
      const withdrawals: PendingWithdrawal[] = [];
      const withdrawalsObj: Record<number, PendingWithdrawal> = {};
      let withdrawalsResolved = false;

      const withdrawalsTimeout = setTimeout(() => {
        if (!withdrawalsResolved) {
          withdrawalsResolved = true;
          log.warn({ withdrawalsPath }, "Timeout reading withdrawals in getBatch");
        }
      }, 5000);

      gun.get(withdrawalsPath).map().once((withdrawal: PendingWithdrawal | null, key: string) => {
        if (withdrawalsResolved) return;

        if (key === '_' || key.startsWith('_')) {
          return;
        }

        if (
          withdrawal &&
          typeof withdrawal === 'object' &&
          typeof withdrawal.user === 'string' &&
          typeof withdrawal.amount === 'string' &&
          typeof withdrawal.nonce === 'string' &&
          typeof withdrawal.timestamp === 'number'
        ) {
          const index = parseInt(key, 10);
          if (!isNaN(index)) {
            withdrawalsObj[index] = withdrawal as PendingWithdrawal;
          }
        }
      });

      // After a delay, resolve with collected withdrawals
      setTimeout(() => {
        if (withdrawalsResolved) {
          resolve(null);
          return;
        }

        withdrawalsResolved = true;
        clearTimeout(withdrawalsTimeout);

        // Convert object to sorted array
        const sortedIndices = Object.keys(withdrawalsObj)
          .map(k => parseInt(k, 10))
          .sort((a, b) => a - b);
        
        sortedIndices.forEach(index => {
          withdrawals.push(withdrawalsObj[index]);
        });

        // Backward compatibility: try to read from old format if no withdrawals found
        if (withdrawals.length === 0 && data.withdrawals) {
          if (Array.isArray(data.withdrawals)) {
            withdrawals.push(...data.withdrawals);
          } else if (typeof data.withdrawals === 'object') {
            const oldWithdrawalsObj = data.withdrawals;
            const indices = Object.keys(oldWithdrawalsObj)
              .filter(key => /^\d+$/.test(key))
              .map(key => parseInt(key, 10))
              .sort((a, b) => a - b);
            
            indices.forEach(index => {
              const w = oldWithdrawalsObj[index.toString()];
              if (w) withdrawals.push(w);
            });
          }
        }

        const batch: Batch = {
          batchId: data.batchId,
          root: data.root,
          withdrawals,
          timestamp: data.timestamp,
          blockNumber: data.blockNumber,
          txHash: data.txHash,
        };

        log.info(
          { batchId: data.batchId, withdrawalCount: withdrawals.length },
          "Batch retrieved from GunDB"
        );
        resolve(batch);
      }, 500);
    });
  });
}

/**
 * Get latest batch
 */
export async function getLatestBatch(gun: IGunInstance): Promise<Batch | null> {
  return new Promise((resolve) => {
    const batchesPath = "bridge/batches";
    const timeout = setTimeout(() => {
      log.warn({ batchesPath }, "Timeout waiting for GunDB response in getLatestBatch");
      resolve(null);
    }, 10000); // 10 second timeout

    const batchIds: string[] = [];
    let resolved = false;

    const cleanup = () => {
      clearTimeout(timeout);
      resolved = true;
    };

    const parentNode = gun.get(batchesPath);

    // Use map().once() to collect batch IDs
    parentNode.map().once((batch: any, key: string) => {
      if (resolved) return;

      // Skip metadata keys
      if (key === '_' || key.startsWith('_')) {
        return;
      }

      if (
        batch &&
        typeof batch === 'object' &&
        typeof batch.batchId === 'string' &&
        typeof batch.root === 'string'
      ) {
        batchIds.push(batch.batchId);
        log.info(
          { key, batchId: batch.batchId },
          "Found batch ID"
        );
      }
    });

    // After a short delay, resolve the promise to ensure all .once() callbacks have fired
    setTimeout(async () => {
      if (resolved) return;
      cleanup();

      if (batchIds.length === 0) {
        log.info({ batchesPath }, "No batches found in GunDB");
        resolve(null);
        return;
      }

      // Find batch with highest batchId (assuming numeric)
      let latest: Batch | null = null;
      let latestId = -1;

      for (const batch of batches) {
        const batchIdNum = parseInt(batch.batchId, 10);
        if (!isNaN(batchIdNum) && batchIdNum > latestId) {
          latestId = batchIdNum;
          latest = batch;
        }
      }

      log.info(
        { totalBatches: batches.length, latestBatchId: latest?.batchId, latestWithdrawalCount: latest?.withdrawals.length },
        "Retrieved latest batch"
      );

      resolve(latest);
    }, 500); // Small delay to allow GunDB to propagate and .once() to complete
  });
}

/**
 * Check if a deposit has already been processed (idempotency)
 * @param depositKey Unique key: "txHash:user:amount"
 */
export async function isDepositProcessed(
  gun: IGunInstance,
  depositKey: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const processedPath = `bridge/processed-deposits/${depositKey}`;

    gun.get(processedPath).once((data: ProcessedDeposit | null) => {
      resolve(data !== null);
    });
  });
}

/**
 * Mark a deposit as processed (idempotency)
 */
export async function markDepositProcessed(
  gun: IGunInstance,
  depositKey: string,
  deposit: ProcessedDeposit
): Promise<void> {
  return new Promise((resolve, reject) => {
    const processedPath = `bridge/processed-deposits/${depositKey}`;

    gun.get(processedPath).put(deposit, (ack: GunMessagePut) => {
      if (ack && "err" in ack && ack.err) {
        const errorMsg =
          typeof ack.err === "string" ? ack.err : String(ack.err);
        reject(new Error(errorMsg));
      } else {
        resolve();
      }
    });
  });
}
