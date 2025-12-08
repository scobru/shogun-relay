/**
 * Registry Routes - On-chain relay management
 * 
 * API endpoints for:
 * - Relay registration on-chain
 * - Staking/unstaking USDC
 * - Deal registration
 * - Registry queries
 */

import express, { Request, Response, Router } from 'express';
import {
    createRegistryClient,
    createRegistryClientWithSigner,
    generateDealId,
    REGISTRY_ADDRESSES,
    USDC_ADDRESSES
} from '../utils/registry-client.js';
import { blockchainConfig } from '../config';
import { loggers } from '../utils/logger';

const router: Router = express.Router();

// Get chain configuration from environment
const REGISTRY_CHAIN_ID: num = blockchainConfig.registryChainId;
const RELAY_PRIVATE_KEY: mb<str> = blockchainConfig.relayPrivateKey;

/**
 * GET /api/v1/registry/status
 * 
 * Get this relay's on-chain registration status
 */
router.get('/status', async (req: Request, res: Response) => {
    try {
        const { getConfigByChainId } = await import('shogun-contracts-sdk');
        const config = getConfigByChainId(REGISTRY_CHAIN_ID);

        if (!RELAY_PRIVATE_KEY) {
            return res.json({
                success: true,
                registered: false,
                configured: false,
                message: 'RELAY_PRIVATE_KEY not configured - on-chain features disabled',
                chainId: REGISTRY_CHAIN_ID,
                registryAddress: config?.relayRegistry || null,
            });
        }

        const client = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
        const relayAddress: str = client.wallet.address;
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

        // Get total deals count from StorageDealRegistry
        let totalDeals: num = 0;
        try {
            const { createStorageDealRegistryClient } = await import('../utils/registry-client.js');
            const storageDealRegistryClient = createStorageDealRegistryClient(REGISTRY_CHAIN_ID);
            const deals = await storageDealRegistryClient.getRelayDeals(relayAddress);
            totalDeals = deals.length;
        } catch (error: any) {
            loggers.registry.warn({ err: error }, 'Could not fetch total deals count');
        }

        res.json({
            success: true,
            registered: true,
            configured: true,
            relayAddress,
            chainId: REGISTRY_CHAIN_ID,
            registryAddress: client.registryAddress,
            relay: {
                ...info,
                totalDeals,
            },
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/v1/registry/balance
 * 
 * Get wallet balances (ETH for gas, USDC for staking)
 */
router.get('/balance', async (req: Request, res: Response) => {
    try {
        if (!RELAY_PRIVATE_KEY) {
            return res.status(400).json({
                success: false,
                error: 'RELAY_PRIVATE_KEY not configured',
            });
        }

        const client = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
        const relayAddress: str = client.wallet.address;

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
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/v1/registry/params
 * 
 * Get registry parameters
 */
router.get('/params', async (req: Request, res: Response) => {
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
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/v1/registry/register
 * 
 * Register this relay on-chain
 * Requires: endpoint, gunPubKey, stakeAmount
 */
router.post('/register', async (req: Request, res: Response) => {
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
        const finalGriefingRatio: num = griefingRatio !== undefined ? parseInt(griefingRatio) : 0;

        loggers.registry.info({ endpoint }, 'Registering relay on-chain');
        const result = await client.registerRelay(endpoint, gunPubKey, stakeAmount, finalGriefingRatio);

        res.json({
            success: true,
            message: 'Relay registered successfully',
            ...result,
        });
    } catch (error: any) {
        loggers.registry.error({ err: error }, 'Registration error');
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/v1/registry/update
 * 
 * Update relay endpoint and/or pubkey
 */
router.post('/update', async (req: Request, res: Response) => {
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
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/v1/registry/stake/increase
 * 
 * Increase stake amount
 */
router.post('/stake/increase', async (req: Request, res: Response) => {
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
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/v1/registry/stake/unstake
 * 
 * Request to unstake (starts 7-day delay)
 */
router.post('/stake/unstake', async (req: Request, res: Response) => {
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
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/v1/registry/stake/withdraw
 * 
 * Withdraw stake after unstaking delay
 */
router.post('/stake/withdraw', async (req: Request, res: Response) => {
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
    } catch (error: any) {
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
router.post('/deal/register', async (req: Request, res: Response) => {
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
        const finalDealId: str = dealId || generateDealId(cid, clientAddress);

        // Use provided clientStake or default to '0'
        const finalClientStake: str = clientStake || '0';

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
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/v1/registry/deal/complete
 * 
 * Mark a deal as completed
 */
router.post('/deal/complete', async (req: Request, res: Response) => {
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
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/v1/registry/deals
 * 
 * Get all deals for this relay from StorageDealRegistry
 * Note: Payment is automatically transferred to relay when registerDeal() is called
 * The relay receives payment immediately upon deal registration (via safeTransferFrom in the contract)
 */
router.get('/deals', async (req: Request, res: Response) => {
    try {
        if (!RELAY_PRIVATE_KEY) {
            return res.status(400).json({
                success: false,
                error: 'RELAY_PRIVATE_KEY not configured',
            });
        }

        const { createStorageDealRegistryClient } = await import('../utils/registry-client.js');
        const storageDealRegistryClient = createStorageDealRegistryClient(REGISTRY_CHAIN_ID);
        const registryClient = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
        const relayAddress: str = registryClient.wallet.address;

        // Get deals from StorageDealRegistry (not from RelayRegistry)
        const deals = await storageDealRegistryClient.getRelayDeals(relayAddress);

        // Enrich deals with payment status
        // Payment is automatically received when registerDeal() is called (via safeTransferFrom)
        // Note: If deal.active is false, it means registerDeal() was called but the deal is not active
        // This could mean the deal expired, was terminated, or was never properly activated
        const enrichedDeals = deals.map((deal: any) => ({
            ...deal,
            paymentReceived: deal.active && deal.createdAt !== '1970-01-01T00:00:00.000Z', // Payment received when deal is active and created
            // If deal exists on-chain but is not active, payment status depends on whether registerDeal was called
            // If registerDeal was called, payment was received (even if deal is now inactive)
            // If registerDeal was NOT called, payment is still pending
            paymentStatus: deal.active ? 'paid' : (deal.createdAt && deal.createdAt !== '1970-01-01T00:00:00.000Z' ? 'paid' : 'pending'),
            canWithdraw: false, // Payment is already in relay wallet - no withdrawal needed
        }));

        res.json({
            success: true,
            relayAddress,
            dealCount: deals.length,
            deals: enrichedDeals,
            note: 'Payment is automatically transferred to relay wallet when registerDeal() is called. No manual withdrawal needed.',
        });
    } catch (error: any) {
        loggers.registry.error({ err: error }, 'Error fetching relay deals');
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/v1/registry/config
 * 
 * Get current registry configuration (addresses, chain info)
 */
router.get('/config', async (req: Request, res: Response) => {
    try {
        const { CONTRACTS_CONFIG, getConfigByChainId } = await import('shogun-contracts-sdk');
        const config = getConfigByChainId(REGISTRY_CHAIN_ID);

        if (!config) {
            return res.status(404).json({
                success: false,
                error: `No configuration found for chain ID ${REGISTRY_CHAIN_ID}`
            });
        }

        // Get network name
        const networkName: str = Object.keys(CONTRACTS_CONFIG).find(
            (key: str) => (CONTRACTS_CONFIG as any)[key].chainId === REGISTRY_CHAIN_ID
        ) || 'Unknown';

        res.json({
            success: true,
            chainId: REGISTRY_CHAIN_ID,
            chainName: networkName === 'baseSepolia' ? 'Base Sepolia' :
                networkName === 'base' ? 'Base Mainnet' : networkName,
            registryAddress: config.relayRegistry,
            usdcAddress: config.usdc,
            configured: !!RELAY_PRIVATE_KEY,
            explorerUrl: config.explorer,
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/v1/registry/grief/missed-proof
 * 
 * Report a missed proof
 */
router.post('/grief/missed-proof', async (req: Request, res: Response) => {
    try {
        if (!RELAY_PRIVATE_KEY) {
            return res.status(400).json({ success: false, error: 'RELAY_PRIVATE_KEY not configured' });
        }
        const { relayAddress, dealId, evidence } = req.body;
        if (!relayAddress || !dealId || !evidence) {
            return res.status(400).json({ success: false, error: 'relayAddress, dealId, and evidence are required' });
        }

        const client = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
        const result = await client.griefMissedProof(relayAddress, dealId, evidence);
        res.json({ success: true, message: 'Missed proof reported', ...result });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/v1/registry/grief/data-loss
 * 
 * Report data loss
 */
router.post('/grief/data-loss', async (req: Request, res: Response) => {
    try {
        if (!RELAY_PRIVATE_KEY) {
            return res.status(400).json({ success: false, error: 'RELAY_PRIVATE_KEY not configured' });
        }
        const { relayAddress, dealId, evidence } = req.body;
        if (!relayAddress || !dealId || !evidence) {
            return res.status(400).json({ success: false, error: 'relayAddress, dealId, and evidence are required' });
        }

        const client = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
        const result = await client.griefDataLoss(relayAddress, dealId, evidence);
        res.json({ success: true, message: 'Data loss reported', ...result });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/v1/registry/deal/grief
 * 
 * Grief a storage deal
 */
router.post('/deal/grief', async (req: Request, res: Response) => {
    try {
        if (!RELAY_PRIVATE_KEY) {
            return res.status(400).json({ success: false, error: 'RELAY_PRIVATE_KEY not configured' });
        }
        const { dealId, slashAmount, reason } = req.body;
        if (!dealId || !slashAmount || !reason) {
            return res.status(400).json({ success: false, error: 'dealId, slashAmount, and reason are required' });
        }

        const { createStorageDealRegistryClientWithSigner } = await import('../utils/registry-client.js');
        const client = createStorageDealRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
        const result = await client.grief(dealId, slashAmount, reason);
        res.json({ success: true, message: 'Deal griefed', ...result });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});


export default router;
