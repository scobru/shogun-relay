/**
 * Registry Routes - On-chain relay management
 * 
 * API endpoints for:
 * - Relay registration on-chain
 * - Staking/unstaking USDC
 * - Deal registration
 * - Registry queries
 */

import express from 'express';
import { 
  createRegistryClient, 
  createRegistryClientWithSigner,
  generateDealId,
  REGISTRY_ADDRESSES,
  USDC_ADDRESSES 
} from '../utils/registry-client.js';

const router = express.Router();

// Get chain configuration from environment
const REGISTRY_CHAIN_ID = parseInt(process.env.REGISTRY_CHAIN_ID) || 84532;
const RELAY_PRIVATE_KEY = process.env.RELAY_PRIVATE_KEY;

/**
 * GET /api/v1/registry/status
 * 
 * Get this relay's on-chain registration status
 */
router.get('/status', async (req, res) => {
  try {
    if (!RELAY_PRIVATE_KEY) {
      return res.json({
        success: true,
        registered: false,
        configured: false,
        message: 'RELAY_PRIVATE_KEY not configured - on-chain features disabled',
        chainId: REGISTRY_CHAIN_ID,
        registryAddress: REGISTRY_ADDRESSES[REGISTRY_CHAIN_ID],
      });
    }

    const client = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
    const relayAddress = client.wallet.address;
    const info = await client.getRelayInfo(relayAddress);

    if (!info) {
      return res.json({
        success: true,
        registered: false,
        configured: true,
        relayAddress,
        chainId: REGISTRY_CHAIN_ID,
        registryAddress: client.registryAddress,
        message: 'Relay not registered on-chain',
      });
    }

    res.json({
      success: true,
      registered: true,
      configured: true,
      relayAddress,
      chainId: REGISTRY_CHAIN_ID,
      registryAddress: client.registryAddress,
      relay: info,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/registry/balance
 * 
 * Get wallet balances (ETH for gas, USDC for staking)
 */
router.get('/balance', async (req, res) => {
  try {
    if (!RELAY_PRIVATE_KEY) {
      return res.status(400).json({
        success: false,
        error: 'RELAY_PRIVATE_KEY not configured',
      });
    }

    const client = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
    const relayAddress = client.wallet.address;

    const [ethBalance, usdcBalance] = await Promise.all([
      client.provider.getBalance(relayAddress),
      client.usdc.balanceOf(relayAddress),
    ]);

    const { ethers } = await import('ethers');

    res.json({
      success: true,
      relayAddress,
      chainId: REGISTRY_CHAIN_ID,
      balances: {
        eth: ethers.formatEther(ethBalance),
        ethWei: ethBalance.toString(),
        usdc: ethers.formatUnits(usdcBalance, 6),
        usdcRaw: usdcBalance.toString(),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/registry/params
 * 
 * Get registry parameters
 */
router.get('/params', async (req, res) => {
  try {
    const client = createRegistryClient(REGISTRY_CHAIN_ID);
    const params = await client.getRegistryParams();

    res.json({
      success: true,
      chainId: REGISTRY_CHAIN_ID,
      registryAddress: client.registryAddress,
      usdcAddress: client.usdcAddress,
      params,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/register
 * 
 * Register this relay on-chain
 * Requires: endpoint, gunPubKey, stakeAmount
 */
router.post('/register', async (req, res) => {
  try {
    if (!RELAY_PRIVATE_KEY) {
      return res.status(400).json({
        success: false,
        error: 'RELAY_PRIVATE_KEY not configured',
      });
    }

    const { endpoint, gunPubKey, stakeAmount, griefingRatio } = req.body;

    if (!endpoint || !gunPubKey || !stakeAmount) {
      return res.status(400).json({
        success: false,
        error: 'endpoint, gunPubKey, and stakeAmount are required',
      });
    }

    const client = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
    
    // Check if already registered
    const existing = await client.getRelayInfo(client.wallet.address);
    if (existing && existing.status !== 'Inactive') {
      return res.status(400).json({
        success: false,
        error: 'Relay already registered',
        currentStatus: existing.status,
      });
    }

    // Use provided griefingRatio or default to 0 (contract will use default)
    const finalGriefingRatio = griefingRatio !== undefined ? parseInt(griefingRatio) : 0;

    console.log(`📝 Registering relay on-chain: ${endpoint}`);
    const result = await client.registerRelay(endpoint, gunPubKey, stakeAmount, finalGriefingRatio);

    res.json({
      success: true,
      message: 'Relay registered successfully',
      ...result,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/update
 * 
 * Update relay endpoint and/or pubkey
 */
router.post('/update', async (req, res) => {
  try {
    if (!RELAY_PRIVATE_KEY) {
      return res.status(400).json({
        success: false,
        error: 'RELAY_PRIVATE_KEY not configured',
      });
    }

    const { newEndpoint, newGunPubKey } = req.body;

    if (!newEndpoint && !newGunPubKey) {
      return res.status(400).json({
        success: false,
        error: 'At least one of newEndpoint or newGunPubKey required',
      });
    }

    const client = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
    const result = await client.updateRelay(newEndpoint || '', newGunPubKey || '');

    res.json({
      success: true,
      message: 'Relay updated successfully',
      ...result,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/stake/increase
 * 
 * Increase stake amount
 */
router.post('/stake/increase', async (req, res) => {
  try {
    if (!RELAY_PRIVATE_KEY) {
      return res.status(400).json({
        success: false,
        error: 'RELAY_PRIVATE_KEY not configured',
      });
    }

    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({
        success: false,
        error: 'amount is required (USDC)',
      });
    }

    const client = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
    const result = await client.increaseStake(amount);

    res.json({
      success: true,
      message: `Stake increased by ${amount} USDC`,
      ...result,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/stake/unstake
 * 
 * Request to unstake (starts 7-day delay)
 */
router.post('/stake/unstake', async (req, res) => {
  try {
    if (!RELAY_PRIVATE_KEY) {
      return res.status(400).json({
        success: false,
        error: 'RELAY_PRIVATE_KEY not configured',
      });
    }

    const client = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
    
    // Get current info
    const info = await client.getRelayInfo(client.wallet.address);
    if (!info || info.status !== 'Active') {
      return res.status(400).json({
        success: false,
        error: 'Relay must be Active to request unstake',
        currentStatus: info?.status || 'Not registered',
      });
    }

    const result = await client.requestUnstake();
    const params = await client.getRegistryParams();

    res.json({
      success: true,
      message: 'Unstake requested - stake will be available after delay period',
      unstakingDelayDays: params.unstakingDelayDays,
      stakedAmount: info.stakedAmount,
      ...result,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/stake/withdraw
 * 
 * Withdraw stake after unstaking delay
 */
router.post('/stake/withdraw', async (req, res) => {
  try {
    if (!RELAY_PRIVATE_KEY) {
      return res.status(400).json({
        success: false,
        error: 'RELAY_PRIVATE_KEY not configured',
      });
    }

    const client = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
    
    // Check status
    const info = await client.getRelayInfo(client.wallet.address);
    if (!info || info.status !== 'Unstaking') {
      return res.status(400).json({
        success: false,
        error: 'Relay must be in Unstaking status',
        currentStatus: info?.status || 'Not registered',
      });
    }

    const result = await client.withdrawStake();

    res.json({
      success: true,
      message: 'Stake withdrawn successfully',
      withdrawnAmount: info.stakedAmount,
      ...result,
    });
  } catch (error) {
    // Check for delay not passed error
    if (error.message.includes('UnstakingDelayNotPassed')) {
      return res.status(400).json({
        success: false,
        error: 'Unstaking delay has not passed yet',
      });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/deal/register
 * 
 * Register a storage deal on-chain
 */
router.post('/deal/register', async (req, res) => {
  try {
    if (!RELAY_PRIVATE_KEY) {
      return res.status(400).json({
        success: false,
        error: 'RELAY_PRIVATE_KEY not configured',
      });
    }

    const { dealId, clientAddress, cid, sizeMB, priceUSDC, durationDays, clientStake } = req.body;

    if (!clientAddress || !cid || !sizeMB || !priceUSDC || !durationDays) {
      return res.status(400).json({
        success: false,
        error: 'clientAddress, cid, sizeMB, priceUSDC, durationDays are required',
      });
    }

    const client = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
    
    // Generate deal ID if not provided
    const finalDealId = dealId || generateDealId(cid, clientAddress);
    
    // Use provided clientStake or default to '0'
    const finalClientStake = clientStake || '0';
    
    const result = await client.registerDeal(
      finalDealId,
      clientAddress,
      cid,
      sizeMB,
      priceUSDC,
      durationDays,
      finalClientStake
    );

    res.json({
      success: true,
      message: 'Deal registered on-chain',
      dealId: finalDealId,
      ...result,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/deal/complete
 * 
 * Mark a deal as completed
 */
router.post('/deal/complete', async (req, res) => {
  try {
    if (!RELAY_PRIVATE_KEY) {
      return res.status(400).json({
        success: false,
        error: 'RELAY_PRIVATE_KEY not configured',
      });
    }

    const { dealId } = req.body;

    if (!dealId) {
      return res.status(400).json({
        success: false,
        error: 'dealId is required',
      });
    }

    const client = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
    const result = await client.completeDeal(dealId);

    res.json({
      success: true,
      message: 'Deal marked as completed',
      ...result,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/registry/deals
 * 
 * Get all deals for this relay
 */
router.get('/deals', async (req, res) => {
  try {
    if (!RELAY_PRIVATE_KEY) {
      return res.status(400).json({
        success: false,
        error: 'RELAY_PRIVATE_KEY not configured',
      });
    }

    const client = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
    const deals = await client.getRelayDeals(client.wallet.address);

    res.json({
      success: true,
      relayAddress: client.wallet.address,
      dealCount: deals.length,
      deals,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/registry/config
 * 
 * Get current registry configuration (addresses, chain info)
 */
router.get('/config', (req, res) => {
  res.json({
    success: true,
    chainId: REGISTRY_CHAIN_ID,
    chainName: REGISTRY_CHAIN_ID === 84532 ? 'Base Sepolia' : 
               REGISTRY_CHAIN_ID === 8453 ? 'Base Mainnet' : 'Unknown',
    registryAddress: REGISTRY_ADDRESSES[REGISTRY_CHAIN_ID],
    usdcAddress: USDC_ADDRESSES[REGISTRY_CHAIN_ID],
    configured: !!RELAY_PRIVATE_KEY,
    explorerUrl: REGISTRY_CHAIN_ID === 84532 
      ? 'https://sepolia.basescan.org' 
      : 'https://basescan.org',
  });
});

export default router;

