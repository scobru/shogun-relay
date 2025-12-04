/**
 * Registry Client - On-chain relay registry interaction
 * 
 * Provides utilities for:
 * - Querying registered relays from the smart contract
 * - Auto-registration of relays (optional)
 * - Storage deal registration on-chain
 */

import { ethers } from 'ethers';

// Contract addresses
export const REGISTRY_ADDRESSES = {
  84532: '0x412D3Cf47907C231EE26D261714D2126eb3735e6', // Base Sepolia
  8453: null, // Base Mainnet - TBD
};

export const USDC_ADDRESSES = {
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',  // Base Mainnet
};

// Default RPC URLs
export const RPC_URLS = {
  84532: 'https://sepolia.base.org',
  8453: 'https://mainnet.base.org',
};

// ABI for ShogunRelayRegistry (minimal interface for queries)
const REGISTRY_ABI = [
  // View functions
  'function getActiveRelays() view returns (address[])',
  'function getActiveRelayCount() view returns (uint256)',
  'function getRelayInfo(address relay) view returns (tuple(address owner, string endpoint, string gunPubKey, uint256 stakedAmount, uint256 registeredAt, uint256 unstakeRequestedAt, uint8 status, uint256 totalDeals, uint256 totalSlashed, uint256 griefingRatio))',
  'function isActiveRelay(address relay) view returns (bool)',
  'function deals(bytes32 dealId) view returns (tuple(bytes32 dealId, address relay, address client, string cid, uint256 sizeMB, uint256 priceUSDC, uint256 createdAt, uint256 expiresAt, bool active, uint256 clientStake))',
  'function getRelayDeals(address relay) view returns (bytes32[])',
  'function getClientDeals(address client) view returns (bytes32[])',
  'function minStake() view returns (uint256)',
  'function unstakingDelay() view returns (uint256)',
  // State-changing functions (require signer)
  'function registerRelay(string endpoint, string gunPubKey, uint256 stakeAmount, uint256 griefingRatio)',
  'function updateRelay(string newEndpoint, string newGunPubKey)',
  'function increaseStake(uint256 amount)',
  'function requestUnstake()',
  'function withdrawStake()',
  'function registerDeal(bytes32 dealId, address client, string cid, uint256 sizeMB, uint256 priceUSDC, uint256 durationDays, uint256 clientStake)',
  'function completeDeal(bytes32 dealId)',
  // Client griefing functions (called by clients, not relays)
  'function griefMissedProof(address relay, bytes32 dealId, string evidence)',
  'function griefDataLoss(address relay, bytes32 dealId, string evidence)',
  'function calculateGriefingCost(address relay, uint256 slashBps, bytes32 dealId) view returns (uint256 slashAmount, uint256 cost)',
  // Events
  'event RelayRegistered(address indexed relay, address indexed owner, string endpoint, string gunPubKey, uint256 stakedAmount)',
  'event StorageDealRegistered(bytes32 indexed dealId, address indexed relay, address indexed client, string cid, uint256 sizeMB, uint256 priceUSDC, uint256 expiresAt, uint256 clientStake)',
  'event RelaySlashed(bytes32 indexed reportId, address indexed relay, address indexed reporter, uint256 amount, uint256 cost, string reason)',
];

// USDC ABI (minimal)
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// Relay status enum
const RelayStatus = {
  0: 'Inactive',
  1: 'Active',
  2: 'Unstaking',
  3: 'Slashed',
};

/**
 * Create a registry client instance
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
  const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, provider);
  const usdcAddress = USDC_ADDRESSES[chainId];

  return {
    chainId,
    registryAddress,
    usdcAddress,
    provider,
    registry,

    /**
     * Get all active relays with their info
     * @returns {Promise<Array>} List of active relays
     */
    async getActiveRelays() {
      const addresses = await registry.getActiveRelays();
      const relays = [];

      for (const addr of addresses) {
        try {
          const info = await registry.getRelayInfo(addr);
          relays.push({
            address: addr,
            owner: info.owner,
            endpoint: info.endpoint,
            gunPubKey: info.gunPubKey,
            stakedAmount: ethers.formatUnits(info.stakedAmount, 6),
            stakedAmountRaw: info.stakedAmount.toString(),
            registeredAt: new Date(Number(info.registeredAt) * 1000).toISOString(),
            status: RelayStatus[info.status] || 'Unknown',
            totalDeals: Number(info.totalDeals),
            totalSlashed: ethers.formatUnits(info.totalSlashed, 6),
            griefingRatio: info.griefingRatio ? Number(info.griefingRatio) : null,
          });
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
      const count = await registry.getActiveRelayCount();
      return Number(count);
    },

    /**
     * Get relay info by address
     * @param {string} relayAddress
     * @returns {Promise<Object|null>}
     */
    async getRelayInfo(relayAddress) {
      try {
        const info = await registry.getRelayInfo(relayAddress);
        if (info.owner === ethers.ZeroAddress) {
          return null;
        }
        return {
          address: relayAddress,
          owner: info.owner,
          endpoint: info.endpoint,
          gunPubKey: info.gunPubKey,
          stakedAmount: ethers.formatUnits(info.stakedAmount, 6),
          stakedAmountRaw: info.stakedAmount.toString(),
          registeredAt: new Date(Number(info.registeredAt) * 1000).toISOString(),
          unstakeRequestedAt: info.unstakeRequestedAt > 0
            ? new Date(Number(info.unstakeRequestedAt) * 1000).toISOString()
            : null,
          status: RelayStatus[info.status] || 'Unknown',
          totalDeals: Number(info.totalDeals),
          totalSlashed: ethers.formatUnits(info.totalSlashed, 6),
          griefingRatio: info.griefingRatio ? Number(info.griefingRatio) : null,
        };
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
      return await registry.isActiveRelay(relayAddress);
    },

    /**
     * Get deal info by ID
     * @param {string} dealId - bytes32 deal ID
     * @returns {Promise<Object|null>}
     */
    async getDeal(dealId) {
      try {
        // Normalize dealId to bytes32 format
        let dealIdBytes32;
        if (typeof dealId === 'string') {
          // If it's already a hex string, use it; otherwise treat as bytes32
          dealIdBytes32 = dealId.startsWith('0x') ? dealId : ethers.id(dealId);
        } else {
          dealIdBytes32 = ethers.hexlify(dealId);
        }
        
        const deal = await registry.deals(dealIdBytes32);
        
        // Check if deal exists (createdAt will be 0 if not found)
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
        };
      } catch (e) {
        // Only log if it's not a "deal not found" type error
        if (!e.message.includes('could not decode') && !e.message.includes('execution reverted')) {
          console.error(`Error fetching deal ${dealId}:`, e.message);
        }
        return null;
      }
    },

    /**
     * Get all deals for a relay
     * @param {string} relayAddress
     * @returns {Promise<Array>}
     */
    async getRelayDeals(relayAddress) {
      const dealIds = await registry.getRelayDeals(relayAddress);
      const deals = [];
      for (const id of dealIds) {
        const deal = await this.getDeal(id);
        if (deal) deals.push(deal);
      }
      return deals;
    },

    /**
     * Get all deals for a client
     * @param {string} clientAddress
     * @returns {Promise<Array>}
     */
    async getClientDeals(clientAddress) {
      try {
        // Normalize address to checksum format for consistency
        const normalizedAddress = ethers.getAddress(clientAddress);
        const dealIds = await registry.getClientDeals(normalizedAddress);
        
        if (!dealIds || dealIds.length === 0) {
          return [];
        }
        
        const deals = [];
        for (const id of dealIds) {
          try {
            // Convert to bytes32 format if needed
            let dealIdBytes32;
            if (typeof id === 'string') {
              // If already a hex string with 0x, use it directly
              dealIdBytes32 = id.startsWith('0x') ? id : ethers.id(id);
            } else {
              // Convert BigNumber or other types to hex string
              dealIdBytes32 = ethers.hexlify(id);
            }
            
            const deal = await this.getDeal(dealIdBytes32);
            if (deal) {
              deals.push(deal);
            }
          } catch (dealError) {
            // Only log non-decode errors (decode errors are expected for non-existent deals)
            if (!dealError.message.includes('could not decode')) {
              console.warn(`⚠️ Error fetching deal:`, dealError.message.substring(0, 100));
            }
            // Continue with other deals
          }
        }
        return deals;
      } catch (error) {
        console.error(`Error fetching client deals for ${clientAddress}:`, error.message);
        return [];
      }
    },

    /**
     * Get registry parameters
     * @returns {Promise<Object>}
     */
    async getRegistryParams() {
      const [minStake, unstakingDelay] = await Promise.all([
        registry.minStake(),
        registry.unstakingDelay(),
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

        const [slashAmount, cost] = await registry.calculateGriefingCost(
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
  const registryWithSigner = client.registry.connect(wallet);
  const usdc = new ethers.Contract(client.usdcAddress, ERC20_ABI, wallet);

  return {
    ...client,
    wallet,
    registryWithSigner,
    usdc,

    /**
     * Register this relay on-chain
     * @param {string} endpoint - Relay endpoint URL
     * @param {string} gunPubKey - GunDB public key
     * @param {string} stakeAmount - Amount to stake in USDC (human readable, e.g., "100")
     * @param {number} [griefingRatio] - Custom griefing ratio in basis points (0 = use default)
     * @returns {Promise<Object>} Transaction receipt
     */
    async registerRelay(endpoint, gunPubKey, stakeAmount, griefingRatio = 0) {
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
        await approveTx.wait();
        console.log('USDC approved');
      }

      // Register
      console.log(`Registering relay: ${endpoint}${griefingRatio > 0 ? ` with griefing ratio ${griefingRatio} bps` : ''}`);
      const tx = await registryWithSigner.registerRelay(endpoint, gunPubKey, stakeWei, griefingRatio);
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
     * @returns {Promise<Object>}
     */
    async updateRelay(newEndpoint = '', newGunPubKey = '') {
      const tx = await registryWithSigner.updateRelay(newEndpoint, newGunPubKey);
      const receipt = await tx.wait();
      return {
        success: true,
        txHash: receipt.hash,
      };
    },

    /**
     * Register a storage deal on-chain
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
      
      // Normalize client address to checksum format for consistency
      const normalizedClientAddress = ethers.getAddress(clientAddress);

      const tx = await registryWithSigner.registerDeal(
        dealIdBytes32,
        normalizedClientAddress,
        cid,
        sizeMB,
        priceWei,
        durationDays,
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
      const tx = await registryWithSigner.completeDeal(dealIdBytes32);
      const receipt = await tx.wait();
      return {
        success: true,
        txHash: receipt.hash,
      };
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

      const tx = await registryWithSigner.increaseStake(amountWei);
      const receipt = await tx.wait();
      return {
        success: true,
        txHash: receipt.hash,
      };
    },

    /**
     * Request unstake (start 7-day delay)
     * @returns {Promise<Object>}
     */
    async requestUnstake() {
      const tx = await registryWithSigner.requestUnstake();
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
      const tx = await registryWithSigner.withdrawStake();
      const receipt = await tx.wait();
      return {
        success: true,
        txHash: receipt.hash,
      };
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

export default {
  createRegistryClient,
  createRegistryClientWithSigner,
  generateDealId,
  dealIdToBytes32,
  REGISTRY_ADDRESSES,
  USDC_ADDRESSES,
  RPC_URLS,
};

