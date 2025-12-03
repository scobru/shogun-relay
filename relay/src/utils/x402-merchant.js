/**
 * x402 Merchant Utility for Shogun Relay
 * 
 * Handles payment verification and settlement for IPFS storage subscriptions.
 * Supports both facilitator-based and direct (local) settlement modes.
 */

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from 'viem';
import { baseSepolia, base, polygon, polygonAmoy } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import httpModule from 'http';
import * as RelayUser from './relay-user.js';

// USDC contract ABI for EIP-3009 transferWithAuthorization
const USDC_ABI = [
  {
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    name: 'transferWithAuthorization',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// Network configurations
const NETWORK_CONFIG = {
  'base': {
    chain: base,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    explorer: 'https://basescan.org',
  },
  'base-sepolia': {
    chain: baseSepolia,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    explorer: 'https://sepolia.basescan.org',
  },
  'polygon': {
    chain: polygon,
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    explorer: 'https://polygonscan.com',
  },
  'polygon-amoy': {
    chain: polygonAmoy,
    usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    explorer: 'https://amoy.polygonscan.com',
  },
};

// Subscription tiers
export const SUBSCRIPTION_TIERS = {
  basic: {
    name: 'Basic',
    storageMB: 100,
    priceUSDC: 0.001,
    durationDays: 30,
  },
  standard: {
    name: 'Standard',
    storageMB: 500,
    priceUSDC: 0.004,
    durationDays: 30,
  },
  premium: {
    name: 'Premium',
    storageMB: 2000,
    priceUSDC: 0.01,
    durationDays: 30,
  },
};

export class X402Merchant {
  constructor(options = {}) {
    this.payToAddress = options.payToAddress;
    this.network = options.network || 'base-sepolia';
    this.facilitatorUrl = options.facilitatorUrl || 'https://x402.org/facilitator';
    this.facilitatorApiKey = options.facilitatorApiKey;
    this.settlementMode = options.settlementMode || 'facilitator';
    this.privateKey = options.privateKey;
    this.rpcUrl = options.rpcUrl;
    
    // Get network config
    this.networkConfig = NETWORK_CONFIG[this.network];
    if (!this.networkConfig) {
      throw new Error(`Unsupported network: ${this.network}`);
    }

    // Initialize clients if using direct settlement
    if (this.settlementMode === 'direct' && this.privateKey) {
      this.initializeClients();
    }
  }

  initializeClients() {
    const chain = this.networkConfig.chain;
    const transport = this.rpcUrl ? http(this.rpcUrl) : http();

    this.publicClient = createPublicClient({
      chain,
      transport,
    });

    if (this.privateKey) {
      const account = privateKeyToAccount(this.privateKey.startsWith('0x') ? this.privateKey : `0x${this.privateKey}`);
      this.walletClient = createWalletClient({
        account,
        chain,
        transport,
      });
    }
  }

  /**
   * Create payment requirements for a subscription tier
   */
  createPaymentRequirements(tier = 'basic') {
    const tierConfig = SUBSCRIPTION_TIERS[tier];
    if (!tierConfig) {
      throw new Error(`Invalid subscription tier: ${tier}`);
    }

    const priceInAtomicUnits = parseUnits(tierConfig.priceUSDC.toString(), 6).toString();

    return {
      scheme: 'exact',
      network: this.network,
      maxAmountRequired: priceInAtomicUnits,
      resource: `ipfs-storage-${tier}`,
      description: `${tierConfig.name} IPFS Storage Subscription - ${tierConfig.storageMB}MB for ${tierConfig.durationDays} days`,
      mimeType: 'application/json',
      payTo: this.payToAddress,
      maxTimeoutSeconds: 300,
      asset: this.networkConfig.usdc,
      extra: {
        tier,
        storageMB: tierConfig.storageMB,
        durationDays: tierConfig.durationDays,
        priceUSDC: tierConfig.priceUSDC,
      },
    };
  }

  /**
   * Create a payment-required response following x402 protocol
   */
  createPaymentRequiredResponse(tier = 'basic') {
    const requirements = this.createPaymentRequirements(tier);
    
    return {
      x402Version: 1,
      accepts: [requirements],
      error: 'Payment required for IPFS storage subscription',
    };
  }

  /**
   * Verify a payment payload
   */
  async verifyPayment(paymentPayload, expectedTier = 'basic') {
    if (!paymentPayload) {
      return { isValid: false, invalidReason: 'No payment payload provided' };
    }

    const tierConfig = SUBSCRIPTION_TIERS[expectedTier];
    if (!tierConfig) {
      return { isValid: false, invalidReason: `Invalid tier: ${expectedTier}` };
    }

    try {
      // Basic validation
      if (!paymentPayload.payload) {
        return { isValid: false, invalidReason: 'Missing payload in payment' };
      }

      const { authorization } = paymentPayload.payload;
      if (!authorization) {
        return { isValid: false, invalidReason: 'Missing authorization in payload' };
      }

      // Verify recipient
      if (authorization.to?.toLowerCase() !== this.payToAddress.toLowerCase()) {
        return { 
          isValid: false, 
          invalidReason: `Invalid recipient. Expected ${this.payToAddress}, got ${authorization.to}` 
        };
      }

      // Verify amount
      const expectedAmount = parseUnits(tierConfig.priceUSDC.toString(), 6);
      const paymentAmount = BigInt(authorization.value || '0');
      
      if (paymentAmount < expectedAmount) {
        return { 
          isValid: false, 
          invalidReason: `Insufficient payment. Expected ${formatUnits(expectedAmount, 6)} USDC, got ${formatUnits(paymentAmount, 6)} USDC` 
        };
      }

      // Verify timing
      const now = Math.floor(Date.now() / 1000);
      const validAfter = parseInt(authorization.validAfter || '0');
      const validBefore = parseInt(authorization.validBefore || '0');

      if (now < validAfter) {
        return { isValid: false, invalidReason: 'Payment not yet valid' };
      }

      if (now > validBefore) {
        return { isValid: false, invalidReason: 'Payment has expired' };
      }

      // If using facilitator, verify with facilitator
      if (this.settlementMode === 'facilitator') {
        const facilitatorResult = await this.verifyWithFacilitator(paymentPayload);
        if (!facilitatorResult.isValid) {
          return facilitatorResult;
        }
      }

      return { 
        isValid: true, 
        payer: authorization.from,
        amount: formatUnits(paymentAmount, 6),
        tier: expectedTier,
      };
    } catch (error) {
      console.error('Payment verification error:', error);
      return { isValid: false, invalidReason: error.message };
    }
  }

  /**
   * Verify payment with facilitator
   */
  async verifyWithFacilitator(paymentPayload) {
    try {
      const headers = {
        'Content-Type': 'application/json',
      };

      if (this.facilitatorApiKey) {
        headers['X-API-Key'] = this.facilitatorApiKey;
      }

      const response = await fetch(`${this.facilitatorUrl}/verify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          paymentPayload,
          network: this.network,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { 
          isValid: false, 
          invalidReason: errorData.error || `Facilitator returned ${response.status}` 
        };
      }

      const result = await response.json();
      return { isValid: result.isValid, payer: result.payer };
    } catch (error) {
      console.error('Facilitator verification error:', error);
      return { isValid: false, invalidReason: `Facilitator error: ${error.message}` };
    }
  }

  /**
   * Settle payment (transfer USDC to merchant)
   */
  async settlePayment(paymentPayload) {
    if (this.settlementMode === 'facilitator') {
      return this.settleWithFacilitator(paymentPayload);
    } else {
      return this.settleDirectly(paymentPayload);
    }
  }

  /**
   * Settle payment via facilitator
   */
  async settleWithFacilitator(paymentPayload) {
    try {
      const headers = {
        'Content-Type': 'application/json',
      };

      if (this.facilitatorApiKey) {
        headers['X-API-Key'] = this.facilitatorApiKey;
      }

      const response = await fetch(`${this.facilitatorUrl}/settle`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          paymentPayload,
          network: this.network,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        return {
          success: false,
          errorReason: result.error || `Settlement failed with status ${response.status}`,
        };
      }

      return {
        success: true,
        transaction: result.transactionHash,
        network: this.network,
        explorer: `${this.networkConfig.explorer}/tx/${result.transactionHash}`,
      };
    } catch (error) {
      console.error('Facilitator settlement error:', error);
      return { success: false, errorReason: error.message };
    }
  }

  /**
   * Settle payment directly on-chain
   */
  async settleDirectly(paymentPayload) {
    if (!this.walletClient || !this.publicClient) {
      return { success: false, errorReason: 'Direct settlement not configured' };
    }

    try {
      const { authorization, signature } = paymentPayload.payload;

      // Parse signature components
      const sig = signature.startsWith('0x') ? signature.slice(2) : signature;
      const r = `0x${sig.slice(0, 64)}`;
      const s = `0x${sig.slice(64, 128)}`;
      const v = parseInt(sig.slice(128, 130), 16);

      // Execute transferWithAuthorization
      const hash = await this.walletClient.writeContract({
        address: this.networkConfig.usdc,
        abi: USDC_ABI,
        functionName: 'transferWithAuthorization',
        args: [
          authorization.from,
          authorization.to,
          BigInt(authorization.value),
          BigInt(authorization.validAfter),
          BigInt(authorization.validBefore),
          authorization.nonce,
          v,
          r,
          s,
        ],
      });

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      return {
        success: receipt.status === 'success',
        transaction: hash,
        network: this.network,
        explorer: `${this.networkConfig.explorer}/tx/${hash}`,
        blockNumber: receipt.blockNumber?.toString(),
      };
    } catch (error) {
      console.error('Direct settlement error:', error);
      return { success: false, errorReason: error.message };
    }
  }

  /**
   * Get subscription status for a user from GunDB (relay user space)
   */
  static async getSubscriptionStatus(gun, userAddress) {
    // Check if relay user is initialized
    if (!RelayUser.isRelayUserInitialized()) {
      console.warn('⚠️ Relay user not initialized, cannot read subscription');
      return { active: false, reason: 'Relay user not initialized' };
    }

    try {
      const data = await RelayUser.getSubscription(userAddress);

      if (!data || typeof data !== 'object') {
        return { active: false, reason: 'No subscription found' };
      }

      const now = Date.now();
      const expiresAt = data.expiresAt || 0;

      if (now > expiresAt) {
        return { 
          active: false, 
          reason: 'Subscription expired',
          expiredAt: new Date(expiresAt).toISOString(),
        };
      }

      const tierConfig = SUBSCRIPTION_TIERS[data.tier] || SUBSCRIPTION_TIERS.basic;

      return {
        active: true,
        tier: data.tier,
        storageMB: tierConfig.storageMB,
        storageUsedMB: data.storageUsedMB || 0,
        storageRemainingMB: Math.max(0, tierConfig.storageMB - (data.storageUsedMB || 0)),
        expiresAt: new Date(expiresAt).toISOString(),
        purchasedAt: data.purchasedAt ? new Date(data.purchasedAt).toISOString() : null,
        ownedBy: RelayUser.getRelayPub(),
      };
    } catch (error) {
      console.error('Error getting subscription:', error);
      return { active: false, reason: error.message };
    }
  }

  /**
   * Save subscription to GunDB (relay user space)
   */
  static async saveSubscription(gun, userAddress, tier, paymentDetails) {
    // Check if relay user is initialized
    if (!RelayUser.isRelayUserInitialized()) {
      throw new Error('Relay user not initialized, cannot save subscription');
    }

    const tierConfig = SUBSCRIPTION_TIERS[tier];
    if (!tierConfig) {
      throw new Error(`Invalid tier: ${tier}`);
    }

    const now = Date.now();
    const expiresAt = now + (tierConfig.durationDays * 24 * 60 * 60 * 1000);

    // Get current subscription to handle renewals
    const currentSub = await this.getSubscriptionStatus(gun, userAddress);

    let finalExpiresAt = expiresAt;
    let storageUsedMB = 0;

    // If renewing same or higher tier and subscription is still active, extend expiry
    if (currentSub.active) {
      const currentTierConfig = SUBSCRIPTION_TIERS[currentSub.tier];
      if (tierConfig.storageMB >= currentTierConfig?.storageMB) {
        // Add remaining time
        const remainingTime = new Date(currentSub.expiresAt).getTime() - now;
        if (remainingTime > 0) {
          finalExpiresAt = expiresAt + remainingTime;
        }
        // Keep current storage usage if upgrading
        storageUsedMB = currentSub.storageUsedMB || 0;
      }
    }

    const subscription = {
      tier,
      storageMB: tierConfig.storageMB,
      storageUsedMB,
      priceUSDC: tierConfig.priceUSDC,
      purchasedAt: now,
      expiresAt: finalExpiresAt,
      paymentTx: paymentDetails?.transaction || null,
      paymentNetwork: paymentDetails?.network || null,
      userAddress,
    };

    await RelayUser.saveSubscription(userAddress, subscription);
    
    return {
      ...subscription,
      ownedBy: RelayUser.getRelayPub(),
    };
  }

  /**
   * Update storage usage for a subscription (relay user space)
   */
  static async updateStorageUsage(gun, userAddress, addMB) {
    // Check if relay user is initialized
    if (!RelayUser.isRelayUserInitialized()) {
      throw new Error('Relay user not initialized, cannot update storage');
    }

    const currentSub = await this.getSubscriptionStatus(gun, userAddress);
    
    if (!currentSub.active) {
      throw new Error('No active subscription');
    }

    const newUsage = (currentSub.storageUsedMB || 0) + addMB;

    if (newUsage > currentSub.storageMB) {
      throw new Error(`Storage limit exceeded. Used: ${newUsage}MB, Limit: ${currentSub.storageMB}MB`);
    }

    await RelayUser.updateSubscriptionField(userAddress, 'storageUsedMB', newUsage);
    
    return { 
      storageUsedMB: newUsage, 
      storageRemainingMB: currentSub.storageMB - newUsage 
    };
  }

  /**
   * Check if user can upload a file of given size
   */
  static async canUpload(gun, userAddress, fileSizeMB) {
    const sub = await this.getSubscriptionStatus(gun, userAddress);

    if (!sub.active) {
      return { 
        allowed: false, 
        reason: sub.reason || 'No active subscription',
        requiresPayment: true,
      };
    }

    if (sub.storageRemainingMB < fileSizeMB) {
      return {
        allowed: false,
        reason: `File too large. Remaining storage: ${sub.storageRemainingMB}MB, File size: ${fileSizeMB}MB`,
        requiresUpgrade: true,
        currentTier: sub.tier,
      };
    }

    return { 
      allowed: true,
      storageAfterUpload: sub.storageRemainingMB - fileSizeMB,
    };
  }

  /**
   * Get all uploads for a user from GunDB (relay user space)
   */
  static async getUserUploads(gun, userAddress) {
    // Check if relay user is initialized
    if (!RelayUser.isRelayUserInitialized()) {
      console.warn('⚠️ Relay user not initialized, cannot read uploads');
      return [];
    }

    try {
      return await RelayUser.getUserUploads(userAddress);
    } catch (error) {
      console.error('Error getting user uploads:', error);
      return [];
    }
  }

  /**
   * Get the actual size of an IPFS object from the IPFS API
   */
  static async getIpfsObjectSize(cid, ipfsApiUrl = 'http://127.0.0.1:5001', ipfsApiToken = null) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log(`Timeout getting IPFS stats for ${cid}`);
        resolve(null);
      }, 10000);

      const url = new URL(ipfsApiUrl);
      
      const requestOptions = {
        hostname: url.hostname,
        port: url.port || 5001,
        path: `/api/v0/object/stat?arg=${cid}`,
        method: 'POST',
        headers: {
          'Content-Length': '0',
        },
      };

      if (ipfsApiToken) {
        requestOptions.headers['Authorization'] = `Bearer ${ipfsApiToken}`;
      }

      const req = httpModule.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          clearTimeout(timeout);
          try {
            const result = JSON.parse(data);
            // CumulativeSize includes the object and all linked objects
            resolve({
              cid,
              size: result.CumulativeSize || result.DataSize || 0,
              numLinks: result.NumLinks || 0,
              blockSize: result.BlockSize || 0,
            });
          } catch (error) {
            console.error(`Error parsing IPFS stats for ${cid}:`, error.message);
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        console.error(`Error getting IPFS stats for ${cid}:`, err.message);
        resolve(null);
      });

      req.end();
    });
  }

  /**
   * Calculate real storage usage from IPFS for a user
   * This queries IPFS to get the actual size of each pinned hash
   */
  static async calculateRealStorageUsage(gun, userAddress, ipfsApiUrl, ipfsApiToken) {
    console.log(`Calculating real IPFS storage for ${userAddress}...`);
    
    // Get all uploads from GunDB
    const uploads = await this.getUserUploads(gun, userAddress);
    
    if (uploads.length === 0) {
      return {
        totalBytes: 0,
        totalMB: 0,
        fileCount: 0,
        files: [],
        verified: true,
      };
    }

    console.log(`Found ${uploads.length} uploads for ${userAddress}, verifying sizes on IPFS...`);

    // Get actual sizes from IPFS
    const filesWithSizes = [];
    let totalBytes = 0;

    for (const upload of uploads) {
      const ipfsStats = await this.getIpfsObjectSize(upload.hash, ipfsApiUrl, ipfsApiToken);
      
      if (ipfsStats) {
        filesWithSizes.push({
          hash: upload.hash,
          name: upload.name,
          recordedSize: upload.size,
          actualSize: ipfsStats.size,
          sizeMB: ipfsStats.size / (1024 * 1024),
        });
        totalBytes += ipfsStats.size;
      } else {
        // If we can't get IPFS stats, use recorded size from GunDB
        filesWithSizes.push({
          hash: upload.hash,
          name: upload.name,
          recordedSize: upload.size,
          actualSize: upload.size,
          sizeMB: upload.size / (1024 * 1024),
          warning: 'Could not verify on IPFS',
        });
        totalBytes += upload.size || 0;
      }
    }

    const totalMB = totalBytes / (1024 * 1024);

    console.log(`Real IPFS storage for ${userAddress}: ${totalMB.toFixed(2)}MB across ${filesWithSizes.length} files`);

    return {
      totalBytes,
      totalMB,
      fileCount: filesWithSizes.length,
      files: filesWithSizes,
      verified: true,
    };
  }

  /**
   * Sync storage usage - verifies and updates GunDB with real IPFS storage (relay user space)
   */
  static async syncStorageUsage(gun, userAddress, ipfsApiUrl, ipfsApiToken) {
    // Check if relay user is initialized
    if (!RelayUser.isRelayUserInitialized()) {
      return {
        success: false,
        error: 'Relay user not initialized',
      };
    }

    // Calculate real storage from IPFS
    const realUsage = await this.calculateRealStorageUsage(gun, userAddress, ipfsApiUrl, ipfsApiToken);
    
    // Get current subscription
    const subscription = await this.getSubscriptionStatus(gun, userAddress);
    
    if (!subscription.active) {
      return {
        success: false,
        error: 'No active subscription',
        realUsage,
      };
    }

    const recordedMB = subscription.storageUsedMB || 0;
    const realMB = realUsage.totalMB;
    const discrepancy = Math.abs(recordedMB - realMB);

    console.log(`Storage sync for ${userAddress}:`);
    console.log(`  Recorded: ${recordedMB.toFixed(2)}MB`);
    console.log(`  Actual: ${realMB.toFixed(2)}MB`);
    console.log(`  Discrepancy: ${discrepancy.toFixed(2)}MB`);

    // If there's a significant discrepancy (> 0.1MB), update GunDB
    if (discrepancy > 0.1) {
      console.log(`Updating storage usage from ${recordedMB.toFixed(2)}MB to ${realMB.toFixed(2)}MB`);
      
      try {
        await RelayUser.updateSubscriptionField(userAddress, 'storageUsedMB', realMB);
        
        return {
          success: true,
          previousMB: recordedMB,
          currentMB: realMB,
          discrepancy,
          corrected: true,
          realUsage,
          storageRemainingMB: Math.max(0, subscription.storageMB - realMB),
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          previousMB: recordedMB,
          currentMB: realMB,
          discrepancy,
        };
      }
    }

    return {
      success: true,
      previousMB: recordedMB,
      currentMB: realMB,
      discrepancy,
      corrected: false,
      realUsage,
      storageRemainingMB: subscription.storageRemainingMB,
    };
  }

  /**
   * Check if user can upload with real IPFS verification (relay user space)
   * This verifies actual storage before allowing upload
   */
  static async canUploadVerified(gun, userAddress, fileSizeMB, ipfsApiUrl, ipfsApiToken) {
    // Check if relay user is initialized
    if (!RelayUser.isRelayUserInitialized()) {
      return { 
        allowed: false, 
        reason: 'Relay user not initialized',
        requiresPayment: false,
      };
    }

    const sub = await this.getSubscriptionStatus(gun, userAddress);

    if (!sub.active) {
      return { 
        allowed: false, 
        reason: sub.reason || 'No active subscription',
        requiresPayment: true,
      };
    }

    // Calculate real storage usage from IPFS
    const realUsage = await this.calculateRealStorageUsage(gun, userAddress, ipfsApiUrl, ipfsApiToken);
    const realUsedMB = realUsage.totalMB;
    const realRemainingMB = Math.max(0, sub.storageMB - realUsedMB);

    // Update GunDB if there's a discrepancy
    if (Math.abs(realUsedMB - (sub.storageUsedMB || 0)) > 0.1) {
      console.log(`Storage discrepancy detected. Recorded: ${sub.storageUsedMB || 0}MB, Actual: ${realUsedMB.toFixed(2)}MB`);
      
      // Update the stored value using relay user
      try {
        await RelayUser.updateSubscriptionField(userAddress, 'storageUsedMB', realUsedMB);
      } catch (error) {
        console.warn('Failed to update storage discrepancy:', error.message);
      }
    }

    if (realRemainingMB < fileSizeMB) {
      return {
        allowed: false,
        reason: `File too large. Remaining storage: ${realRemainingMB.toFixed(2)}MB, File size: ${fileSizeMB.toFixed(2)}MB`,
        requiresUpgrade: true,
        currentTier: sub.tier,
        storageUsedMB: realUsedMB,
        storageRemainingMB: realRemainingMB,
        storageTotalMB: sub.storageMB,
        verified: true,
      };
    }

    return { 
      allowed: true,
      storageUsedMB: realUsedMB,
      storageRemainingMB: realRemainingMB,
      storageAfterUpload: realRemainingMB - fileSizeMB,
      storageTotalMB: sub.storageMB,
      verified: true,
    };
  }

  /**
   * Save upload record for a user (relay user space)
   */
  static async saveUploadRecord(userAddress, hash, uploadData) {
    if (!RelayUser.isRelayUserInitialized()) {
      throw new Error('Relay user not initialized');
    }

    await RelayUser.saveUpload(userAddress, hash, uploadData);
  }

  /**
   * Delete upload record for a user (relay user space)
   */
  static async deleteUploadRecord(userAddress, hash) {
    if (!RelayUser.isRelayUserInitialized()) {
      throw new Error('Relay user not initialized');
    }

    await RelayUser.deleteUpload(userAddress, hash);
  }
}

export default X402Merchant;

