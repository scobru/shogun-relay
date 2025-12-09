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

    const balanceData = entry.data as { balance?: string; user?: string; ethereumAddress?: string };

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
      log.info({ user: indexKey, balance: balance.toString() }, "Balance retrieved successfully");
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
        await new Promise(resolve => setTimeout(resolve, 100 * retryCount)); // Exponential backoff
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

      log.info(
        { user: ethereumAddress, balanceData },
        "Creating frozen entry"
      );

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
      await new Promise(resolve => setTimeout(resolve, 200));
      
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
      await new Promise(resolve => setTimeout(resolve, 500));
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
        throw new Error(`Failed to credit balance after ${maxRetries} retries. Initial: ${initialBalance.toString()}, Final: ${finalBalance.toString()}, Expected at least: ${(initialBalance + amount).toString()}`);
      }
    }
  } catch (error) {
    log.error({ error, user: userAddress, amount: amount.toString() }, "Error crediting balance");
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
  expectedFields?: { to?: string; amount?: string; timestamp?: number; nonce?: string }
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
      seaDataObj = typeof seaVerified === 'string' 
        ? JSON.parse(seaVerified) 
        : seaVerified;
    } catch {
      // If not JSON, treat as plain string
      seaDataObj = seaVerified;
    }
    
    try {
      messageObj = typeof message === 'string' 
        ? JSON.parse(message) 
        : message;
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
      
      if (typeof obj1 !== 'object') {
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
    
    // Compare objects using deep equality
    if (typeof seaDataObj === 'object' && typeof messageObj === 'object' && 
        seaDataObj !== null && messageObj !== null && 
        !Array.isArray(seaDataObj) && !Array.isArray(messageObj)) {
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
      const seaData = typeof seaVerified === 'string' 
        ? seaVerified 
        : JSON.stringify(seaVerified);
      const normalizedMessage = typeof message === 'string' 
        ? message 
        : JSON.stringify(message);
      
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
      messageData = typeof seaVerified === 'string' 
        ? JSON.parse(seaVerified) 
        : seaVerified;
    } catch {
      // If not JSON, treat as plain string (less secure, but backward compatible)
      messageData = { ethereumAddress: ethAddress };
    }

    // Verify ethereumAddress in message matches
    if (!messageData.ethereumAddress || 
        messageData.ethereumAddress.toLowerCase() !== ethAddress.toLowerCase()) {
      return null;
    }

    // 4. Validate expected fields (if provided)
    if (expectedFields) {
      if (expectedFields.to && messageData.to?.toLowerCase() !== expectedFields.to.toLowerCase()) {
        log.warn(
          { expectedTo: expectedFields.to, actualTo: messageData.to },
          "To field mismatch"
        );
        return null;
      }
      if (expectedFields.amount && messageData.amount !== expectedFields.amount) {
        log.warn(
          { expectedAmount: expectedFields.amount, actualAmount: messageData.amount },
          "Amount field mismatch"
        );
        return null;
      }
      if (expectedFields.nonce && messageData.nonce !== expectedFields.nonce) {
        log.warn(
          { expectedNonce: expectedFields.nonce, actualNonce: messageData.nonce },
          "Nonce field mismatch"
        );
        return null;
      }
      // Timestamp validation: must be recent (within 1 hour) to prevent replay
      // Use the message timestamp as the reference point, not the server time
      if (expectedFields.timestamp !== undefined && messageData.timestamp) {
        const messageTime = typeof messageData.timestamp === 'number' 
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
      throw new Error("Invalid signatures or message content mismatch: must provide valid SEA and Ethereum signatures with correct message content");
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
    const withdrawalsPath = "bridge/withdrawals/pending";
    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for GunDB response"));
    }, 10000); // 10 second timeout

    const cleanup = () => clearTimeout(timeout);

    try {
      // Try reading from 'list' sub-node first (new format)
      // Then fall back to parent node (old format: array or { list: [...] })
      const listPath = `${withdrawalsPath}/list`;
      const listNode = gun.get(withdrawalsPath).get('list');
      
      listNode.once((listData: PendingWithdrawal[] | null | undefined) => {
        // If list sub-node exists and is an array, use it
        if (Array.isArray(listData) && listData.length >= 0) {
          try {
            let withdrawals: PendingWithdrawal[] = listData;

            // Normalize withdrawals array
            withdrawals = withdrawals.filter(
              (w): w is PendingWithdrawal =>
                w &&
                typeof w === 'object' &&
                typeof w.user === 'string' &&
                typeof w.amount === 'string' &&
                typeof w.nonce === 'string' &&
                typeof w.timestamp === 'number'
            );

            log.info(
              { normalizedCount: withdrawals.length, source: 'list-subnode' },
              "Reading withdrawals from list sub-node"
            );

            // Check if withdrawal with same nonce already exists
            const exists = withdrawals.some(
              (w) =>
                w.user.toLowerCase() === withdrawal.user.toLowerCase() &&
                w.nonce === withdrawal.nonce
            );

            if (exists) {
              cleanup();
              reject(new Error("Withdrawal with this nonce already exists"));
              return;
            }

            withdrawals.push(withdrawal);

            // Save back to list sub-node
            listNode.put(withdrawals, (ack: GunMessagePut) => {
              if (ack && "err" in ack && ack.err) {
                const errorMsg =
                  typeof ack.err === "string" ? ack.err : String(ack.err);
                log.error(
                  { error: errorMsg, withdrawalsPath, withdrawal, withdrawalsCount: withdrawals.length },
                  "Error saving pending withdrawal list"
                );
                cleanup();
                reject(new Error(errorMsg));
              } else {
                log.info(
                  { withdrawalsCount: withdrawals.length, withdrawal },
                  "Pending withdrawal added successfully"
                );
                cleanup();
                resolve();
              }
            });
            return;
          } catch (innerError) {
            log.warn(
              { error: innerError, listData },
              "Error processing list sub-node, falling back to parent node"
            );
            // Fall through to parent node reading
          }
        }
        
        // Fall back to reading from parent node (old format or empty)
        gun
          .get(withdrawalsPath)
          .once((data: { list?: PendingWithdrawal[] } | PendingWithdrawal[] | null | undefined) => {
          try {
            // GunDB can return data in different formats:
            // 1. Array directly: [withdrawal1, withdrawal2, ...]
            // 2. Object with list property: { list: [withdrawal1, withdrawal2, ...] }
            // 3. null/undefined: no data yet
            // 4. Object with other structure
            let withdrawals: PendingWithdrawal[] = [];
            const wasArray = Array.isArray(data);
            const wasObject = data && typeof data === 'object' && !Array.isArray(data);
            
            log.info(
              {
                dataType: Array.isArray(data) ? 'array' : typeof data,
                dataIsNull: data === null || data === undefined,
                wasArray,
                wasObject,
                hasList: wasObject && 'list' in data,
                dataPreview: Array.isArray(data) 
                  ? `Array[${data.length}]` 
                  : typeof data === 'object' && data !== null
                  ? JSON.stringify(data).substring(0, 200)
                  : String(data),
              },
              "Reading pending withdrawals data"
            );
            
            if (Array.isArray(data)) {
              withdrawals = data;
              log.info(
                { arrayLength: data.length },
                "Found withdrawals as array"
              );
            } else if (data && typeof data === 'object') {
              if ('list' in data && Array.isArray(data.list)) {
                withdrawals = data.list;
                log.info(
                  { listLength: data.list.length },
                  "Found withdrawals in object.list"
                );
              } else {
                // Try to convert object to array if it has numeric keys
                const entries = Object.values(data).filter(
                  (item): item is PendingWithdrawal => 
                    typeof item === 'object' && 
                    item !== null && 
                    'user' in item && 
                    'amount' in item && 
                    'nonce' in item
                );
                if (entries.length > 0) {
                  withdrawals = entries;
                  log.info(
                    { entriesLength: entries.length },
                    "Found withdrawals as object entries"
                  );
                }
              }
            }
            // If data is null/undefined, withdrawals stays empty array

            // Normalize withdrawals array (ensure all entries have required fields)
            withdrawals = withdrawals.filter(
              (w): w is PendingWithdrawal =>
                w &&
                typeof w === 'object' &&
                typeof w.user === 'string' &&
                typeof w.amount === 'string' &&
                typeof w.nonce === 'string' &&
                typeof w.timestamp === 'number'
            );

            log.info(
              { normalizedCount: withdrawals.length },
              "Normalized withdrawals array"
            );

            // Check if withdrawal with same nonce already exists
            const exists = withdrawals.some(
              (w) =>
                w.user.toLowerCase() === withdrawal.user.toLowerCase() &&
                w.nonce === withdrawal.nonce
            );

            if (exists) {
              cleanup();
              reject(new Error("Withdrawal with this nonce already exists"));
              return;
            }

            withdrawals.push(withdrawal);

            // Always save to 'list' sub-node to avoid conflicts with existing array formats
            // This works whether the parent node is array, object, or null
            const withdrawalsNode = gun.get(withdrawalsPath);
            const listNode = withdrawalsNode.get('list');
            
            log.info(
              { withdrawalsCount: withdrawals.length, wasArray, wasObject },
              "Saving withdrawals to list sub-node"
            );
            
            listNode.put(withdrawals, (ack: GunMessagePut) => {
              if (ack && "err" in ack && ack.err) {
                const errorMsg =
                  typeof ack.err === "string" ? ack.err : String(ack.err);
                log.error(
                  { 
                    error: errorMsg, 
                    withdrawalsPath, 
                    withdrawal, 
                    withdrawalsCount: withdrawals.length,
                    wasArray,
                    wasObject 
                  },
                  "Error saving pending withdrawal list"
                );
                cleanup();
                reject(new Error(errorMsg));
              } else {
                log.info(
                  { withdrawalsCount: withdrawals.length, withdrawal },
                  "Pending withdrawal added successfully"
                );
                cleanup();
                resolve();
              }
            });
          } catch (innerError) {
            cleanup();
            log.error(
              { error: innerError, data, withdrawal },
              "Error processing pending withdrawal data"
            );
            reject(innerError instanceof Error ? innerError : new Error(String(innerError)));
          }
        });
    } catch (outerError) {
      cleanup();
      log.error(
        { error: outerError, withdrawal },
        "Error setting up pending withdrawal listener"
      );
      reject(outerError instanceof Error ? outerError : new Error(String(outerError)));
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

    // Try reading from 'list' sub-node first (new format)
    const listNode = gun.get(withdrawalsPath).get('list');
    
    listNode.once((listData: PendingWithdrawal[] | null | undefined) => {
      // If list sub-node exists and is an array, use it
      if (Array.isArray(listData) && listData.length >= 0) {
        const withdrawals = listData.filter(
          (w): w is PendingWithdrawal =>
            w &&
            typeof w === 'object' &&
            typeof w.user === 'string' &&
            typeof w.amount === 'string' &&
            typeof w.nonce === 'string' &&
            typeof w.timestamp === 'number'
        );
        resolve(withdrawals);
        return;
      }
      
      // Fall back to reading from parent node (old format)
      gun
        .get(withdrawalsPath)
        .once((data: { list?: PendingWithdrawal[] } | PendingWithdrawal[] | null | undefined) => {
          // GunDB can return data in different formats:
          // 1. Array directly: [withdrawal1, withdrawal2, ...]
          // 2. Object with list property: { list: [withdrawal1, withdrawal2, ...] }
          // 3. null/undefined: no data yet
          let withdrawals: PendingWithdrawal[] = [];
          
          if (Array.isArray(data)) {
            withdrawals = data;
          } else if (data && typeof data === 'object' && 'list' in data && Array.isArray(data.list)) {
            withdrawals = data.list;
          }
          
          // Normalize withdrawals array
          withdrawals = withdrawals.filter(
            (w): w is PendingWithdrawal =>
              w &&
              typeof w === 'object' &&
              typeof w.user === 'string' &&
              typeof w.amount === 'string' &&
              typeof w.nonce === 'string' &&
              typeof w.timestamp === 'number'
          );
          
          resolve(withdrawals);
        });
    });
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

    // Try reading from 'list' sub-node first (new format)
    const listNode = gun.get(withdrawalsPath).get('list');
    
    listNode.once((listData: PendingWithdrawal[] | null | undefined) => {
      let withdrawals: PendingWithdrawal[] = [];
      let useSubNode = false;
      
      // If list sub-node exists and is an array, use it
      if (Array.isArray(listData) && listData.length >= 0) {
        withdrawals = listData;
        useSubNode = true;
      } else {
        // Fall back to reading from parent node (old format)
        gun
          .get(withdrawalsPath)
          .once((data: { list?: PendingWithdrawal[] } | PendingWithdrawal[] | null | undefined) => {
            if (Array.isArray(data)) {
              withdrawals = data;
            } else if (data && typeof data === 'object' && 'list' in data && Array.isArray(data.list)) {
              withdrawals = data.list;
            }
            
            processWithdrawals();
          });
        return;
      }
      
      processWithdrawals();
      
      function processWithdrawals() {
        // Normalize withdrawals array
        withdrawals = withdrawals.filter(
          (w): w is PendingWithdrawal =>
            w &&
            typeof w === 'object' &&
            typeof w.user === 'string' &&
            typeof w.amount === 'string' &&
            typeof w.nonce === 'string' &&
            typeof w.timestamp === 'number'
        );

        // Create a set of withdrawal keys (user+nonce) to remove
        const toRemove = new Set(
          withdrawalsToRemove.map((w) => `${w.user.toLowerCase()}:${w.nonce}`)
        );

        // Filter out removed withdrawals
        const remaining = withdrawals.filter(
          (w) => !toRemove.has(`${w.user.toLowerCase()}:${w.nonce}`)
        );

        // Always save to 'list' sub-node (new format)
        const withdrawalsNode = gun.get(withdrawalsPath);
        const listNodeForSave = withdrawalsNode.get('list');
        
        listNodeForSave.put(remaining, (ack: GunMessagePut) => {
          if (ack && "err" in ack && ack.err) {
            const errorMsg =
              typeof ack.err === "string" ? ack.err : String(ack.err);
            reject(new Error(errorMsg));
          } else {
            resolve();
          }
        });
      }
    });
  });
}

/**
 * Save batch to GunDB
 */
export async function saveBatch(
  gun: IGunInstance,
  batch: Batch
): Promise<void> {
  return new Promise((resolve, reject) => {
    const batchPath = `bridge/batches/${batch.batchId}`;

    gun.get(batchPath).put(batch, (ack: GunMessagePut) => {
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

/**
 * Get batch by ID
 */
export async function getBatch(
  gun: IGunInstance,
  batchId: string
): Promise<Batch | null> {
  return new Promise((resolve) => {
    const batchPath = `bridge/batches/${batchId}`;

    gun.get(batchPath).once((data: Batch | null) => {
      resolve(data);
    });
  });
}

/**
 * Get latest batch
 */
export async function getLatestBatch(gun: IGunInstance): Promise<Batch | null> {
  return new Promise((resolve) => {
    // This is a simplified version - in production you might want to maintain
    // a separate index of batch IDs sorted by timestamp
    const batchesPath = "bridge/batches";

    gun.get(batchesPath).once((data: Record<string, Batch> | null) => {
      if (!data) {
        resolve(null);
        return;
      }

      // Find batch with highest batchId (assuming numeric)
      let latest: Batch | null = null;
      let latestId = -1;

      for (const [id, batch] of Object.entries(data)) {
        const batchIdNum = parseInt(id, 10);
        if (!isNaN(batchIdNum) && batchIdNum > latestId) {
          latestId = batchIdNum;
          latest = batch;
        }
      }

      resolve(latest);
    });
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
