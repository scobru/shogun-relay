/**
 * Registry Client - On-chain relay registry interaction using SDK
 * 
 * This is a refactored version using the Shogun Contracts SDK
 * Provides utilities for:
 * - Querying registered relays from the smart contract
 * - Auto-registration of relays (optional)
 * - Storage deal registration on-chain
 */

import { ethers } from 'ethers';
import { ShogunSDK } from 'shogun-contracts/sdk';
import { 
  CONTRACTS_CONFIG, 
  ERC20_ABI 
} from 'shogun-contracts';

// Generate contract address mappings from centralized config
// This maintains backward compatibility while using the centralized configuration
const generateAddressMappings = () => {
  /** @type {Record<number, string | null>} */
  const registryAddresses = Object.create(null);
  /** @type {Record<number, string | null>} */
  const storageDealRegistryAddresses = Object.create(null);
  /** @type {Record<number, string | null>} */
  const usdcAddresses = Object.create(null);
  /** @type {Record<number, string | null>} */
  const rpcUrls = Object.create(null);

  // Iterate through all network configs
  for (const config of Object.values(CONTRACTS_CONFIG)) {
    if (config && config.chainId) {
      registryAddresses[config.chainId] = config.relayRegistry || null;
      storageDealRegistryAddresses[config.chainId] = config.storageDealRegistry || null;
      usdcAddresses[config.chainId] = config.usdc || null;
      rpcUrls[config.chainId] = config.rpc || null;
    }
  }

  return { registryAddresses, storageDealRegistryAddresses, usdcAddresses, rpcUrls };
};

const { registryAddresses, storageDealRegistryAddresses, usdcAddresses, rpcUrls } = generateAddressMappings();

// Export for backward compatibility
export const REGISTRY_ADDRESSES = registryAddresses;
export const STORAGE_DEAL_REGISTRY_ADDRESSES = storageDealRegistryAddresses;
export const USDC_ADDRESSES = usdcAddresses;
export const RPC_URLS = rpcUrls;

// Relay status enum
const RelayStatus = {
  0: 'Inactive',
  1: 'Active',
  2: 'Unstaking',
  3: 'Slashed',
};

/**
 * Helper to convert bytes to string
 */
function bytesToString(bytes) {
  if (!bytes || bytes.length === 0) return '';
  try {
    return ethers.toUtf8String(bytes);
  } catch {
    return '';
  }
}

/**
 * Helper to format relay info from contract
 */
function formatRelayInfo(info, relayAddress) {
  return {
    address: relayAddress,
    owner: info.owner,
    endpoint: info.endpoint,
    gunPubKey: bytesToString(info.pubkey),
    epub: bytesToString(info.epub),
    stakedAmount: ethers.formatUnits(info.stakedAmount, 6),
    stakedAmountRaw: info.stakedAmount.toString(),
    registeredAt: new Date(Number(info.registeredAt) * 1000).toISOString(),
    updatedAt: new Date(Number(info.updatedAt) * 1000).toISOString(),
    unstakeRequestedAt: info.unstakeRequestedAt > 0
      ? new Date(Number(info.unstakeRequestedAt) * 1000).toISOString()
      : null,
    status: RelayStatus[info.status] || 'Unknown',
    totalSlashed: ethers.formatUnits(info.totalSlashed, 6),
    griefingRatio: info.griefingRatio ? Number(info.griefingRatio) : null,
  };
}

/**
 * Create a registry client instance using SDK
 * @param {number} chainId - Chain ID (84532 for Base Sepolia, 8453 for Base)
 * @param {string} [rpcUrl] - Optional custom RPC URL
 * @returns {Object} Registry client
 */
export function createRegistryClient(chainId = 84532, rpcUrl = null) {
  const registryAddress = REGISTRY_ADDRESSES[chainId];
  if (!registryAddress) {
    throw new Error(`Registry not deployed on chain ${chainId}`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl || RPC_URLS[chainId]);
  const sdk = new ShogunSDK({ provider, chainId });
  const relayRegistry = sdk.getRelayRegistry();
  const usdcAddress = USDC_ADDRESSES[chainId];

  return {
    chainId,
    registryAddress,
    usdcAddress,
    provider,
    registry: relayRegistry.getContract(), // For backward compatibility
    sdk,
    relayRegistry,

    /**
     * Get all active relays with their info
     * @returns {Promise<Array>} List of active relays
     */
    async getActiveRelays() {
      const addresses = await relayRegistry.getActiveRelays();
      const relays = [];

      for (const addr of addresses) {
        try {
          const info = await relayRegistry.getRelayInfo(addr);
          if (info.owner === ethers.ZeroAddress) continue;
          relays.push(formatRelayInfo(info, addr));
        } catch (e) {
          console.error(`Error fetching relay info for ${addr}:`, e.message);
        }
      }

      return relays;
    },

    /**
     * Get count of active relays
     * @returns {Promise<number>}
     */
    async getActiveRelayCount() {
      const count = await relayRegistry.getContract().getActiveRelayCount();
      return Number(count);
    },

    /**
     * Get relay info by address
     * @param {string} relayAddress
     * @returns {Promise<Object|null>}
     */
    async getRelayInfo(relayAddress) {
      try {
        const info = await relayRegistry.getRelayInfo(relayAddress);
        if (info.owner === ethers.ZeroAddress) {
          return null;
        }
        return formatRelayInfo(info, relayAddress);
      } catch (e) {
        console.error(`Error fetching relay info:`, e.message);
        return null;
      }
    },

    /**
     * Check if address is an active relay
     * @param {string} relayAddress
     * @returns {Promise<boolean>}
     */
    async isActiveRelay(relayAddress) {
      return await relayRegistry.isActiveRelay(relayAddress);
    },

    /**
     * Get deal info by ID (from StorageDealRegistry)
     * @param {string} dealId - bytes32 deal ID
     * @returns {Promise<Object|null>}
     */
    async getDeal(dealId) {
      // This method should use StorageDealRegistry, not RelayRegistry
      // Keeping for backward compatibility but delegating to StorageDealRegistry
      const storageDealClient = createStorageDealRegistryClient(this.chainId);
      return await storageDealClient.getDeal(dealId);
    },

    /**
     * Get all deals for a relay (from StorageDealRegistry)
     * @param {string} relayAddress
     * @returns {Promise<Array>}
     */
    async getRelayDeals(relayAddress) {
      const storageDealClient = createStorageDealRegistryClient(this.chainId);
      return await storageDealClient.getRelayDeals(relayAddress);
    },

    /**
     * Get all deals for a client (from StorageDealRegistry)
     * @param {string} clientAddress
     * @returns {Promise<Array>}
     */
    async getClientDeals(clientAddress) {
      const storageDealClient = createStorageDealRegistryClient(this.chainId);
      return await storageDealClient.getClientDeals(clientAddress);
    },

    /**
     * Get registry parameters
     * @returns {Promise<Object>}
     */
    async getRegistryParams() {
      const contract = relayRegistry.getContract();
      const [minStake, unstakingDelay] = await Promise.all([
        contract.minStake(),
        contract.unstakingDelay(),
      ]);
      return {
        minStake: ethers.formatUnits(minStake, 6),
        minStakeRaw: minStake.toString(),
        unstakingDelay: Number(unstakingDelay),
        unstakingDelayDays: Number(unstakingDelay) / 86400,
      };
    },

    /**
     * Calculate griefing cost for slashing a relay
     * Note: This method may not exist in the contract, keeping for backward compatibility
     * @param {string} relayAddress - Relay address
     * @param {number} slashBps - Slash percentage in basis points (100 = 1%, 1000 = 10%)
     * @param {string} dealId - Deal ID (bytes32 or string to hash)
     * @returns {Promise<Object>} { slashAmount, cost } in USDC
     */
    async calculateGriefingCost(relayAddress, slashBps, dealId) {
      try {
        let dealIdBytes32;
        if (typeof dealId === 'string') {
          dealIdBytes32 = dealId.startsWith('0x') ? dealId : ethers.id(dealId);
        } else {
          dealIdBytes32 = ethers.hexlify(dealId);
        }

        const contract = relayRegistry.getContract();
        // Check if method exists
        if (typeof contract.calculateGriefingCost === 'function') {
          const [slashAmount, cost] = await contract.calculateGriefingCost(
            relayAddress,
            slashBps,
            dealIdBytes32
          );

          return {
            slashAmount: ethers.formatUnits(slashAmount, 6),
            slashAmountRaw: slashAmount.toString(),
            cost: ethers.formatUnits(cost, 6),
            costRaw: cost.toString(),
          };
        } else {
          // Fallback: calculate manually if method doesn't exist
          const relayInfo = await relayRegistry.getRelayInfo(relayAddress);
          const stakedAmount = BigInt(relayInfo.stakedAmountRaw);
          const slashAmount = (stakedAmount * BigInt(slashBps)) / BigInt(10000);
          // Default griefing ratio is 500 bps (5% cost per 1% slash)
          const griefingRatio = relayInfo.griefingRatio || 500;
          const cost = (slashAmount * BigInt(griefingRatio)) / BigInt(10000);
          
          return {
            slashAmount: ethers.formatUnits(slashAmount, 6),
            slashAmountRaw: slashAmount.toString(),
            cost: ethers.formatUnits(cost, 6),
            costRaw: cost.toString(),
          };
        }
      } catch (error) {
        console.error(`Error calculating griefing cost:`, error.message);
        throw error;
      }
    },
  };
}

/**
 * Create a registry client with signer for state-changing operations
 * @param {string} privateKey - Relay operator private key
 * @param {number} chainId - Chain ID
 * @param {string} [rpcUrl] - Optional custom RPC URL
 * @returns {Object} Registry client with signer
 */
export function createRegistryClientWithSigner(privateKey, chainId = 84532, rpcUrl = null) {
  const client = createRegistryClient(chainId, rpcUrl);
  const wallet = new ethers.Wallet(privateKey, client.provider);
  const sdkWithSigner = new ShogunSDK({ 
    provider: client.provider, 
    signer: wallet, 
    chainId 
  });
  const relayRegistry = sdkWithSigner.getRelayRegistry();
  const usdc = new ethers.Contract(client.usdcAddress, ERC20_ABI, wallet);

  return {
    ...client,
    wallet,
    registryWithSigner: relayRegistry.getContract(), // For backward compatibility
    usdc,
    sdk: sdkWithSigner,
    relayRegistry,

    /**
     * Register this relay on-chain
     * @param {string} endpoint - Relay endpoint URL
     * @param {string} gunPubKey - GunDB public key (string, will be converted to bytes)
     * @param {string} stakeAmount - Amount to stake in USDC (human readable, e.g., "100")
     * @param {number} [griefingRatio] - Custom griefing ratio in basis points (0 = use default)
     * @param {string} [epub] - Ephemeral encryption public key (optional, defaults to empty bytes)
     * @returns {Promise<Object>} Transaction receipt
     */
    async registerRelay(endpoint, gunPubKey, stakeAmount, griefingRatio = 0, epub = '') {
      const stakeWei = ethers.parseUnits(stakeAmount, 6);

      // Check USDC balance
      const balance = await usdc.balanceOf(wallet.address);
      if (balance < stakeWei) {
        throw new Error(`Insufficient USDC balance. Have: ${ethers.formatUnits(balance, 6)}, Need: ${stakeAmount}`);
      }

      // Check/set allowance
      const allowance = await usdc.allowance(wallet.address, client.registryAddress);
      if (allowance < stakeWei) {
        console.log('Approving USDC spend...');
        const approveTx = await usdc.approve(client.registryAddress, stakeWei);
        console.log(`⏳ Waiting for approve transaction confirmation: ${approveTx.hash}`);
        const approveReceipt = await approveTx.wait();
        console.log(`✅ Approve transaction confirmed in block ${approveReceipt.blockNumber}`);
        
        // Verify allowance was updated
        let retries = 5;
        while (retries > 0) {
          const newAllowance = await usdc.allowance(wallet.address, client.registryAddress);
          if (newAllowance >= stakeWei) {
            console.log(`✅ USDC allowance confirmed: ${ethers.formatUnits(newAllowance, 6)} USDC`);
            break;
          }
          console.log(`⏳ Waiting for allowance to update... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          retries--;
        }
        
        if (retries === 0) {
          const finalAllowance = await usdc.allowance(wallet.address, client.registryAddress);
          if (finalAllowance < stakeWei) {
            throw new Error(`Allowance not updated after approval. Expected: ${ethers.formatUnits(stakeWei, 6)}, Got: ${ethers.formatUnits(finalAllowance, 6)}`);
          }
        }
      }

      // Convert pubkey and epub strings to bytes
      const pubkeyBytes = ethers.toUtf8Bytes(gunPubKey || '');
      const epubBytes = epub ? ethers.toUtf8Bytes(epub) : '0x';

      // Register using SDK
      console.log(`Registering relay: ${endpoint}${griefingRatio > 0 ? ` with griefing ratio ${griefingRatio} bps` : ''}`);
      const tx = await relayRegistry.registerRelay(
        endpoint,
        pubkeyBytes,
        epubBytes,
        stakeWei,
        BigInt(griefingRatio)
      );
      const receipt = await tx.wait();

      return {
        success: true,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        relayAddress: wallet.address,
      };
    },

    /**
     * Update relay info
     * @param {string} [newEndpoint] - New endpoint (empty to keep current)
     * @param {string} [newGunPubKey] - New GunDB public key (empty to keep current)
     * @param {string} [newEpub] - New epub (empty to keep current)
     * @returns {Promise<Object>}
     */
    async updateRelay(newEndpoint = '', newGunPubKey = '', newEpub = '') {
      if (newEndpoint) {
        const tx = await relayRegistry.updateRelay(newEndpoint);
        const receipt = await tx.wait();
        return {
          success: true,
          txHash: receipt.hash,
        };
      }
      
      if (newGunPubKey || newEpub) {
        const pubkeyBytes = newGunPubKey ? ethers.toUtf8Bytes(newGunPubKey) : '0x';
        const epubBytes = newEpub ? ethers.toUtf8Bytes(newEpub) : '0x';
        const tx = await relayRegistry.updateRelayEncryptionKeys(pubkeyBytes, epubBytes);
        const receipt = await tx.wait();
        return {
          success: true,
          txHash: receipt.hash,
        };
      }
      
      throw new Error('At least one field (endpoint, gunPubKey, or epub) must be provided');
    },

    /**
     * Increase stake
     * @param {string} amount - Additional USDC to stake
     * @returns {Promise<Object>}
     */
    async increaseStake(amount) {
      const amountWei = ethers.parseUnits(amount, 6);

      // Check/set allowance
      const allowance = await usdc.allowance(wallet.address, client.registryAddress);
      if (allowance < amountWei) {
        const approveTx = await usdc.approve(client.registryAddress, amountWei);
        await approveTx.wait();
      }

      const tx = await relayRegistry.increaseStake(amountWei);
      const receipt = await tx.wait();
      return {
        success: true,
        txHash: receipt.hash,
      };
    },

    /**
     * Request unstake (start delay)
     * @returns {Promise<Object>}
     */
    async requestUnstake() {
      const tx = await relayRegistry.requestUnstake();
      const receipt = await tx.wait();
      return {
        success: true,
        txHash: receipt.hash,
      };
    },

    /**
     * Withdraw stake after delay period
     * @returns {Promise<Object>}
     */
    async withdrawStake() {
      const tx = await relayRegistry.withdrawStake();
      const receipt = await tx.wait();
      return {
        success: true,
        txHash: receipt.hash,
      };
    },

    /**
     * Report missed proof (Griefing)
     * Note: This should use StorageDealRegistry.grief, keeping for backward compatibility
     * @param {string} relayAddress - Address of the relay to slash
     * @param {string} dealId - Deal ID associated with the failure
     * @param {string} evidence - Evidence string (e.g. IPFS hash of log)
     * @returns {Promise<Object>}
     */
    async griefMissedProof(relayAddress, dealId, evidence) {
      // This should be handled by StorageDealRegistry
      const storageDealClient = createStorageDealRegistryClientWithSigner(
        privateKey,
        chainId,
        rpcUrl
      );
      const slashBps = 100; // 1%
      const relayInfo = await this.getRelayInfo(relayAddress);
      const stakedAmount = BigInt(relayInfo.stakedAmountRaw);
      const slashAmount = (stakedAmount * BigInt(slashBps)) / BigInt(10000);
      return await storageDealClient.grief(dealId, ethers.formatUnits(slashAmount, 6), evidence);
    },

    /**
     * Report data loss (Griefing)
     * Note: This should use StorageDealRegistry.grief, keeping for backward compatibility
     * @param {string} relayAddress - Address of the relay to slash
     * @param {string} dealId - Deal ID associated with the failure
     * @param {string} evidence - Evidence string
     * @returns {Promise<Object>}
     */
    async griefDataLoss(relayAddress, dealId, evidence) {
      const storageDealClient = createStorageDealRegistryClientWithSigner(
        privateKey,
        chainId,
        rpcUrl
      );
      const slashBps = 1000; // 10%
      const relayInfo = await this.getRelayInfo(relayAddress);
      const stakedAmount = BigInt(relayInfo.stakedAmountRaw);
      const slashAmount = (stakedAmount * BigInt(slashBps)) / BigInt(10000);
      return await storageDealClient.grief(dealId, ethers.formatUnits(slashAmount, 6), evidence);
    },
  };
}

/**
 * Generate deal ID from parameters
 * @param {string} cid
 * @param {string} clientAddress
 * @param {number} timestamp
 * @returns {string} Deal ID string
 */
export function generateDealId(cid, clientAddress, timestamp = Date.now()) {
  return `deal-${cid}-${clientAddress}-${timestamp}`;
}

/**
 * Convert deal ID string to bytes32
 * @param {string} dealId
 * @returns {string} bytes32 hash
 */
export function dealIdToBytes32(dealId) {
  return ethers.id(dealId);
}

/**
 * Create a StorageDealRegistry client instance using SDK
 * @param {number} chainId - Chain ID (84532 for Base Sepolia, 8453 for Base)
 * @param {string} [rpcUrl] - Optional custom RPC URL
 * @returns {Object} StorageDealRegistry client
 */
export function createStorageDealRegistryClient(chainId = 84532, rpcUrl = null) {
  const registryAddress = STORAGE_DEAL_REGISTRY_ADDRESSES[chainId];
  if (!registryAddress) {
    throw new Error(`StorageDealRegistry not deployed on chain ${chainId}`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl || RPC_URLS[chainId]);
  const sdk = new ShogunSDK({ provider, chainId });
  const storageDealRegistry = sdk.getStorageDealRegistry();
  const usdcAddress = USDC_ADDRESSES[chainId];

  return {
    chainId,
    registryAddress,
    usdcAddress,
    provider,
    storageDealRegistry: storageDealRegistry.getContract(), // For backward compatibility
    sdk,
    storageDealRegistrySDK: storageDealRegistry,

    /**
     * Get deal info by ID
     * @param {string} dealId - bytes32 deal ID (or string to hash)
     * @returns {Promise<Object|null>}
     */
    async getDeal(dealId) {
      try {
        let dealIdBytes32;
        if (typeof dealId === 'string') {
          dealIdBytes32 = dealId.startsWith('0x') && dealId.length === 66 ? dealId : ethers.id(dealId);
        } else {
          dealIdBytes32 = ethers.hexlify(dealId);
        }
        
        const deal = await storageDealRegistry.getDeal(dealIdBytes32);
        
        if (!deal || deal.createdAt === 0n || deal.createdAt === 0) {
          return null;
        }
        
        return {
          dealId: typeof deal.dealId === 'string' ? deal.dealId : ethers.hexlify(deal.dealId),
          relay: typeof deal.relay === 'string' ? deal.relay : deal.relay.toLowerCase(),
          client: typeof deal.client === 'string' ? deal.client : deal.client.toLowerCase(),
          cid: deal.cid,
          sizeMB: Number(deal.sizeMB),
          priceUSDC: ethers.formatUnits(deal.priceUSDC, 6),
          createdAt: new Date(Number(deal.createdAt) * 1000).toISOString(),
          expiresAt: new Date(Number(deal.expiresAt) * 1000).toISOString(),
          active: deal.active,
          clientStake: deal.clientStake ? ethers.formatUnits(deal.clientStake, 6) : '0',
          clientStakeRaw: deal.clientStake ? deal.clientStake.toString() : '0',
          griefed: deal.griefed || false,
        };
      } catch (e) {
        if (!e.message.includes('could not decode') && !e.message.includes('execution reverted')) {
          console.error(`Error fetching deal ${dealId}:`, e.message);
        }
        return null;
      }
    },

    /**
     * Get all deals for a client
     * @param {string} clientAddress
     * @returns {Promise<Array>}
     */
    async getClientDeals(clientAddress) {
      try {
        const normalizedAddress = ethers.getAddress(clientAddress);
        const dealIds = await storageDealRegistry.getClientDeals(normalizedAddress);
        
        if (!dealIds || dealIds.length === 0) {
          return [];
        }
        
        const deals = [];
        for (const id of dealIds) {
          try {
            let dealIdBytes32;
            if (typeof id === 'string') {
              dealIdBytes32 = id.startsWith('0x') ? id : ethers.id(id);
            } else {
              dealIdBytes32 = ethers.hexlify(id);
            }
            
            const deal = await this.getDeal(dealIdBytes32);
            if (deal) {
              deals.push(deal);
            }
          } catch (dealError) {
            if (!dealError.message.includes('could not decode')) {
              console.warn(`⚠️ Error fetching deal:`, dealError.message.substring(0, 100));
            }
          }
        }
        return deals;
      } catch (error) {
        console.error(`Error fetching client deals for ${clientAddress}:`, error.message);
        return [];
      }
    },

    /**
     * Get all deals for a relay
     * @param {string} relayAddress
     * @returns {Promise<Array>}
     */
    async getRelayDeals(relayAddress) {
      try {
        const normalizedAddress = ethers.getAddress(relayAddress);
        const dealIds = await storageDealRegistry.getRelayDeals(normalizedAddress);
        
        const deals = [];
        for (const id of dealIds) {
          const deal = await this.getDeal(id);
          if (deal) deals.push(deal);
        }
        return deals;
      } catch (error) {
        console.error(`Error fetching relay deals for ${relayAddress}:`, error.message);
        return [];
      }
    },
  };
}

/**
 * Create a StorageDealRegistry client with signer for state-changing operations
 * @param {string} privateKey - Relay operator private key
 * @param {number} chainId - Chain ID
 * @param {string} [rpcUrl] - Optional custom RPC URL
 * @returns {Object} StorageDealRegistry client with signer
 */
export function createStorageDealRegistryClientWithSigner(privateKey, chainId = 84532, rpcUrl = null) {
  const client = createStorageDealRegistryClient(chainId, rpcUrl);
  const wallet = new ethers.Wallet(privateKey, client.provider);
  const sdkWithSigner = new ShogunSDK({ 
    provider: client.provider, 
    signer: wallet, 
    chainId 
  });
  const storageDealRegistry = sdkWithSigner.getStorageDealRegistry();

  return {
    ...client,
    wallet,
    storageDealRegistryWithSigner: storageDealRegistry.getContract(), // For backward compatibility
    sdk: sdkWithSigner,
    storageDealRegistrySDK: storageDealRegistry,

    /**
     * Register a storage deal on-chain (called by relay)
     * @param {string} dealId - Unique deal ID (will be hashed to bytes32)
     * @param {string} clientAddress - Client address
     * @param {string} cid - IPFS CID
     * @param {number} sizeMB - Size in MB
     * @param {string} priceUSDC - Price in USDC (human readable)
     * @param {number} durationDays - Duration in days
     * @param {string} [clientStake] - Optional client stake in USDC (human readable, e.g., "10")
     * @returns {Promise<Object>}
     */
    async registerDeal(dealId, clientAddress, cid, sizeMB, priceUSDC, durationDays, clientStake = '0') {
      const dealIdBytes32 = ethers.id(dealId); // keccak256 hash
      const priceWei = ethers.parseUnits(priceUSDC, 6);
      const clientStakeWei = ethers.parseUnits(clientStake, 6);
      
      // Normalize client address to checksum format
      const normalizedClientAddress = ethers.getAddress(clientAddress);

      const tx = await storageDealRegistry.registerDeal(
        dealIdBytes32,
        normalizedClientAddress,
        cid,
        BigInt(sizeMB),
        priceWei,
        BigInt(durationDays),
        clientStakeWei
      );
      const receipt = await tx.wait();

      return {
        success: true,
        txHash: receipt.hash,
        dealIdBytes32,
      };
    },

    /**
     * Complete a storage deal
     * @param {string} dealId - Deal ID (string, will be hashed)
     * @returns {Promise<Object>}
     */
    async completeDeal(dealId) {
      const dealIdBytes32 = ethers.id(dealId);
      const tx = await storageDealRegistry.completeDeal(dealIdBytes32);
      const receipt = await tx.wait();
      return {
        success: true,
        txHash: receipt.hash,
      };
    },

    /**
     * Grief a storage deal
     * @param {string} dealId - Deal ID
     * @param {string} slashAmount - Amount to slash in USDC
     * @param {string} reason - Reason for griefing
     * @returns {Promise<Object>}
     */
    async grief(dealId, slashAmount, reason) {
      const dealIdBytes32 = ethers.id(dealId);
      const slashAmountWei = ethers.parseUnits(slashAmount, 6);
      const tx = await storageDealRegistry.grief(dealIdBytes32, slashAmountWei, reason);
      const receipt = await tx.wait();
      return {
        success: true,
        txHash: receipt.hash,
      };
    },
  };
}

export default {
  createRegistryClient,
  createRegistryClientWithSigner,
  createStorageDealRegistryClient,
  createStorageDealRegistryClientWithSigner,
  generateDealId,
  dealIdToBytes32,
  REGISTRY_ADDRESSES,
  STORAGE_DEAL_REGISTRY_ADDRESSES,
  USDC_ADDRESSES,
  RPC_URLS,
};

