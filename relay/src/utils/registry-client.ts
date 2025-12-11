/**
 * Registry Client - On-chain relay registry interaction using SDK
 *
 * This module uses the Shogun Contracts SDK (shogun-contracts-sdk) to interact
 * with smart contracts. It maintains backward compatibility with the previous
 * implementation while using the SDK under the hood.
 *
 * Provides utilities for:
 * - Querying registered relays from the smart contract
 * - Auto-registration of relays (optional)
 * - Storage deal registration on-chain
 *
 * All contract interactions now go through the ShogunSDK which provides:
 * - Type-safe contract interfaces
 * - Automatic ABI and address resolution
 * - Consistent error handling
 *
 * @version 2.0.0 - Refactored to use SDK
 */

import { ethers } from "ethers";
import { ShogunSDK, CONTRACTS_CONFIG, ERC20_ABI } from "shogun-contracts-sdk";
import { loggers } from "./logger";
const log = loggers.registry;

// Interfaces
interface NetworkConfig {
  chainId: number;
  relayRegistry?: string;
  storageDealRegistry?: string;
  usdc?: string;
  rpc?: string;
}

interface RelayInfo {
  owner: string;
  endpoint: string;
  pubkey: Uint8Array | string;
  epub: Uint8Array | string;
  stakedAmount: bigint;
  registeredAt: bigint;
  updatedAt: bigint;
  unstakeRequestedAt: bigint;
  status: number;
  totalSlashed: bigint;
  griefingRatio?: number;
}

interface FormattedRelayInfo {
  address: string;
  owner: string;
  endpoint: string;
  gunPubKey: string;
  epub: string;
  stakedAmount: string;
  stakedAmountRaw: string;
  registeredAt: string;
  updatedAt: string;
  unstakeRequestedAt: string | undefined;
  status: string;
  totalSlashed: string;
  griefingRatio: number | undefined;
}

interface RegistryParams {
  minStake: string;
  minStakeRaw: string;
  unstakingDelay: number;
  unstakingDelayDays: number;
}

interface GriefingCost {
  slashAmount: string;
  slashAmountRaw: string;
  cost: string;
  costRaw: string;
}

interface TransactionResult {
  success: boolean;
  txHash: string;
  blockNumber?: number;
  relayAddress?: string;
  dealIdBytes32?: string;
}

interface DealInfo {
  dealId: string;
  relay: string;
  client: string;
  cid: string;
  sizeMB: number;
  priceUSDC: string;
  createdAt: string;
  expiresAt: string;
  active: boolean;
  clientStake: string;
  clientStakeRaw: string;
  griefed: boolean;
}

// Generate contract address mappings from centralized config
// This maintains backward compatibility while using the centralized configuration
const generateAddressMappings = (): {
  registryAddresses: Record<number, string | undefined>;
  storageDealRegistryAddresses: Record<number, string | undefined>;
  usdcAddresses: Record<number, string | undefined>;
  rpcUrls: Record<number, string | undefined>;
} => {
  const registryAddresses: Record<number, string | undefined> = Object.create(null);
  const storageDealRegistryAddresses: Record<number, string | undefined> = Object.create(
    null
  );
  const usdcAddresses: Record<number, string | undefined> = Object.create(null);
  const rpcUrls: Record<number, string | undefined> = Object.create(null);

  // Iterate through all network configs
  for (const config of Object.values(CONTRACTS_CONFIG) as Array<NetworkConfig>) {
    if (config && config.chainId) {
      registryAddresses[config.chainId] = config.relayRegistry || undefined;
      storageDealRegistryAddresses[config.chainId] =
        config.storageDealRegistry || undefined;
      usdcAddresses[config.chainId] = config.usdc || undefined;
      rpcUrls[config.chainId] = config.rpc || undefined;
    }
  }

  return {
    registryAddresses,
    storageDealRegistryAddresses,
    usdcAddresses,
    rpcUrls,
  };
};

const {
  registryAddresses,
  storageDealRegistryAddresses,
  usdcAddresses,
  rpcUrls,
} = generateAddressMappings();

// Export for backward compatibility
export const REGISTRY_ADDRESSES = registryAddresses;
export const STORAGE_DEAL_REGISTRY_ADDRESSES = storageDealRegistryAddresses;
export const USDC_ADDRESSES = usdcAddresses;
export const RPC_URLS = rpcUrls;

// Relay status enum
const RelayStatus: Record<number, string> = {
  0: "Inactive",
  1: "Active",
  2: "Unstaking",
  3: "Slashed",
};

/**
 * Helper to convert bytes to string
 */
function bytesToString(bytes: Uint8Array | string): string {
  if (!bytes || (Array.isArray(bytes) && bytes.length === 0)) return "";
  try {
    return ethers.toUtf8String(bytes as Uint8Array);
  } catch {
    return "";
  }
}

/**
 * Helper to format relay info from contract
 */
function formatRelayInfo(
  info: RelayInfo,
  relayAddress: string
): FormattedRelayInfo {
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
    unstakeRequestedAt:
      info.unstakeRequestedAt > 0n
        ? new Date(Number(info.unstakeRequestedAt) * 1000).toISOString()
        : undefined,
    status: RelayStatus[info.status] || "Unknown",
    totalSlashed: ethers.formatUnits(info.totalSlashed, 6),
    griefingRatio: info.griefingRatio ? Number(info.griefingRatio) : undefined,
  };
}

/**
 * Create a registry client instance using SDK
 * @param chainId - Chain ID (84532 for Base Sepolia, 8453 for Base)
 * @param rpcUrl - Optional custom RPC URL
 * @returns Registry client
 */
export function createRegistryClient(
  chainId: number = 84532,
  rpcUrl: string | undefined = undefined
): any {
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
     * @returns List of active relays
     */
    async getActiveRelays(): Promise<Array<FormattedRelayInfo>> {
      const addresses: Array<string> = await relayRegistry.getActiveRelays();
      const relays: Array<FormattedRelayInfo> = [];

      for (const addr of addresses) {
        try {
          const info: RelayInfo = await relayRegistry.getRelayInfo(addr);
          if (info.owner === ethers.ZeroAddress) continue;
          relays.push(formatRelayInfo(info, addr));
        } catch (e) {
          log.error({ err: e, addr }, `Error fetching relay info`);
        }
      }

      return relays;
    },

    /**
     * Get count of active relays
     * @returns Number of active relays
     */
    async getActiveRelayCount(): Promise<number> {
      const count = await relayRegistry.getContract().getActiveRelayCount();
      return Number(count);
    },

    /**
     * Get relay info by address
     * @param relayAddress - Relay address
     * @returns Relay info or undefined
     */
    async getRelayInfo(relayAddress: string): Promise<FormattedRelayInfo | undefined> {
      try {
        const info: RelayInfo = await relayRegistry.getRelayInfo(relayAddress);
        if (info.owner === ethers.ZeroAddress) {
          return undefined;
        }
        return formatRelayInfo(info, relayAddress);
      } catch (e) {
        log.error({ err: e }, `Error fetching relay info`);
        return undefined;
      }
    },

    /**
     * Check if address is an active relay
     * @param relayAddress - Relay address
     * @returns True if active
     */
    async isActiveRelay(relayAddress: string): Promise<boolean> {
      return await relayRegistry.isActiveRelay(relayAddress);
    },

    /**
     * Get deal info by ID (from StorageDealRegistry)
     * @param dealId - bytes32 deal ID
     * @returns Deal info or undefined
     */
    async getDeal(dealId: string): Promise<DealInfo | undefined> {
      // This method should use StorageDealRegistry, not RelayRegistry
      // Keeping for backward compatibility but delegating to StorageDealRegistry
      const storageDealClient = createStorageDealRegistryClient(this.chainId);
      return await storageDealClient.getDeal(dealId);
    },

    /**
     * Get all deals for a relay (from StorageDealRegistry)
     * @param relayAddress - Relay address
     * @returns Array of deals
     */
    async getRelayDeals(relayAddress: string): Promise<Array<DealInfo>> {
      const storageDealClient = createStorageDealRegistryClient(this.chainId);
      return await storageDealClient.getRelayDeals(relayAddress);
    },

    /**
     * Get all deals for a client (from StorageDealRegistry)
     * @param clientAddress - Client address
     * @returns Array of deals
     */
    async getClientDeals(clientAddress: string): Promise<Array<DealInfo>> {
      const storageDealClient = createStorageDealRegistryClient(this.chainId);
      return await storageDealClient.getClientDeals(clientAddress);
    },

    /**
     * Get registry parameters
     * @returns Registry params
     */
    async getRegistryParams(): Promise<RegistryParams> {
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
     * @param relayAddress - Relay address
     * @param slashBps - Slash percentage in basis points (100 = 1%, 1000 = 10%)
     * @param dealId - Deal ID (bytes32 or string to hash)
     * @returns Griefing cost info
     */
    async calculateGriefingCost(
      relayAddress: string,
      slashBps: number,
      dealId: string
    ): Promise<GriefingCost> {
      try {
        let dealIdBytes32: string;
        if (typeof dealId === "string") {
          dealIdBytes32 = dealId.startsWith("0x") ? dealId : ethers.id(dealId);
        } else {
          dealIdBytes32 = ethers.hexlify(dealId);
        }

        const contract = relayRegistry.getContract();
        // Check if method exists
        if (typeof contract.calculateGriefingCost === "function") {
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
          const relayInfo = await this.getRelayInfo(relayAddress);
          const stakedAmount = BigInt(relayInfo!.stakedAmountRaw);
          const slashAmount = (stakedAmount * BigInt(slashBps)) / BigInt(10000);
          // Default griefing ratio is 500 bps (5% cost per 1% slash)
          const griefingRatio = relayInfo!.griefingRatio || 500;
          const cost = (slashAmount * BigInt(griefingRatio)) / BigInt(10000);

          return {
            slashAmount: ethers.formatUnits(slashAmount, 6),
            slashAmountRaw: slashAmount.toString(),
            cost: ethers.formatUnits(cost, 6),
            costRaw: cost.toString(),
          };
        }
      } catch (error) {
        log.error({ err: error }, `Error calculating griefing cost`);
        throw error;
      }
    },
  };
}

/**
 * Create a registry client with signer for state-changing operations
 * @param privateKey - Relay operator private key
 * @param chainId - Chain ID
 * @param rpcUrl - Optional custom RPC URL
 * @returns Registry client with signer
 */
export function createRegistryClientWithSigner(
  privateKey: string,
  chainId: number = 84532,
  rpcUrl: string | undefined = undefined
): any {
  const client = createRegistryClient(chainId, rpcUrl);
  const wallet = new ethers.Wallet(privateKey, client.provider);
  const sdkWithSigner = new ShogunSDK({
    provider: client.provider,
    signer: wallet,
    chainId,
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
     * @param endpoint - Relay endpoint URL
     * @param gunPubKey - GunDB public key (string, will be converted to bytes)
     * @param stakeAmount - Amount to stake in USDC (human readable, e.g., "100")
     * @param griefingRatio - Custom griefing ratio in basis points (0 = use default)
     * @param epub - Ephemeral encryption public key (optional, defaults to empty bytes)
     * @returns Transaction receipt
     */
    async registerRelay(
      endpoint: string,
      gunPubKey: string,
      stakeAmount: string,
      griefingRatio: number = 0,
      epub: string = ""
    ): Promise<TransactionResult> {
      const stakeWei = ethers.parseUnits(stakeAmount, 6);

      // Get the actual registry address from SDK to ensure we approve the correct contract
      const registryAddressFromSDK = relayRegistry.getAddress();
      const registryAddress = ethers.getAddress(registryAddressFromSDK); // Normalize address
      
      // Verify addresses match (safety check)
      if (ethers.getAddress(client.registryAddress) !== registryAddress) {
        log.warn(
          `Address mismatch: client.registryAddress=${client.registryAddress}, SDK address=${registryAddress}. Using SDK address.`
        );
      }

      // Check USDC balance
      const balance = await usdc.balanceOf(wallet.address);
      if (balance < stakeWei) {
        throw new Error(
          `Insufficient USDC balance. Have: ${ethers.formatUnits(balance, 6)}, Need: ${stakeAmount}`
        );
      }

      // Check/set allowance - use SDK address to ensure correctness
      // Some USDC tokens require resetting allowance to 0 before setting a new amount
      const allowance = await usdc.allowance(
        wallet.address,
        registryAddress
      );
      
      if (allowance < stakeWei) {
        log.info(
          `Current allowance: ${ethers.formatUnits(allowance, 6)} USDC, Need: ${ethers.formatUnits(stakeWei, 6)} USDC`
        );
        
        // If there's an existing non-zero allowance that's less than what we need,
        // reset it to 0 first (some tokens require this to prevent front-running)
        if (allowance > 0n) {
          log.info("Resetting existing allowance to 0...");
          const resetTx = await usdc.approve(registryAddress, 0n);
          log.info(`Reset transaction: ${resetTx.hash}`);
          await resetTx.wait();
          log.info("Allowance reset confirmed");
          
          // Wait a bit for the state to propagate
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        
        log.info("Approving USDC spend...");
        // Approve slightly more than needed (add 1% buffer) to account for any rounding issues
        // Some tokens/contracts have edge cases with exact amounts
        const approvalBuffer = (stakeWei * 101n) / 100n; // 1% buffer
        const approveTx = await usdc.approve(registryAddress, approvalBuffer);
        log.info(
          `Waiting for approve transaction confirmation: ${approveTx.hash} (approved ${ethers.formatUnits(approvalBuffer, 6)} USDC for ${ethers.formatUnits(stakeWei, 6)} USDC stake)`
        );
        // Wait for approval transaction with at least 1 confirmation
        const approveReceipt = await approveTx.wait(1);
        log.info(
          `Approve transaction confirmed in block ${approveReceipt.blockNumber}`
        );
        
        // Wait for multiple block confirmations to ensure state propagation across all RPC nodes
        // This is critical because estimateGas may use a different RPC node
        const approvalBlock = approveReceipt.blockNumber;
        const currentBlock = await client.provider.getBlockNumber();
        const blocksToWait = Math.max(3, currentBlock - approvalBlock + 2); // Wait at least 3 blocks after approval
        log.info(`Approval in block ${approvalBlock}, current block: ${currentBlock}, waiting for ${blocksToWait} more blocks for state propagation...`);
        
        let blocksWaited = 0;
        while (blocksWaited < blocksToWait) {
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Check every 2 seconds
          const newBlock = await client.provider.getBlockNumber();
          const newBlocksWaited = newBlock - approvalBlock;
          if (newBlocksWaited > blocksWaited) {
            blocksWaited = newBlocksWaited;
            log.info(`Block ${newBlock} mined, ${blocksToWait - blocksWaited} blocks remaining...`);
          }
        }
        log.info("State propagation wait complete");
        
        // Additional delay to ensure all RPC nodes have synced
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Verify allowance was updated with more retries and longer wait
        let retries = 10;
        let verified = false;
        while (retries > 0) {
          const newAllowance = await usdc.allowance(
            wallet.address,
            registryAddress
          );
          if (newAllowance >= stakeWei) {
            log.info(
              `USDC allowance confirmed: ${ethers.formatUnits(newAllowance, 6)} USDC`
            );
            verified = true;
            break;
          }
          log.info(
            `Waiting for allowance to update... Current: ${ethers.formatUnits(newAllowance, 6)}, Need: ${ethers.formatUnits(stakeWei, 6)} (${retries} retries left)`
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
          retries--;
        }

        if (!verified) {
          const finalAllowance = await usdc.allowance(
            wallet.address,
            registryAddress
          );
          throw new Error(
            `Allowance not updated after approval. Expected: ${ethers.formatUnits(stakeWei, 6)} USDC, Got: ${ethers.formatUnits(finalAllowance, 6)} USDC. Please try again.`
          );
        }
        
        // Double-check allowance one more time right before the contract call
        const finalCheck = await usdc.allowance(
          wallet.address,
          registryAddress
        );
        if (finalCheck < stakeWei) {
          throw new Error(
            `Allowance verification failed before contract call. Expected: ${ethers.formatUnits(stakeWei, 6)} USDC, Got: ${ethers.formatUnits(finalCheck, 6)} USDC`
          );
        }
        log.info(
          `Final allowance check passed: ${ethers.formatUnits(finalCheck, 6)} USDC`
        );
      } else {
        log.info(
          `Sufficient allowance already exists: ${ethers.formatUnits(allowance, 6)} USDC`
        );
      }

      // Convert pubkey and epub strings to bytes
      const pubkeyBytes = ethers.toUtf8Bytes(gunPubKey || "");
      const epubBytes = epub ? ethers.toUtf8Bytes(epub) : "0x";

      // Register using SDK
      log.info(
        `Registering relay: ${endpoint}${griefingRatio > 0 ? ` with griefing ratio ${griefingRatio} bps` : ""}`
      );
      
      // Final allowance check right before contract call
      const preCallAllowance = await usdc.allowance(
        wallet.address,
        registryAddress
      );
      log.info(
        `Pre-call allowance check: ${ethers.formatUnits(preCallAllowance, 6)} USDC (need ${ethers.formatUnits(stakeWei, 6)} USDC)`
      );
      
      if (preCallAllowance < stakeWei) {
        throw new Error(
          `Allowance insufficient right before contract call. Have: ${ethers.formatUnits(preCallAllowance, 6)} USDC, Need: ${ethers.formatUnits(stakeWei, 6)} USDC. Please try again.`
        );
      }
      
      // Use populateTransaction and manual gas estimation to have better control
      // This allows us to retry gas estimation if it fails due to state propagation issues
      const contract = relayRegistry.getContract();
      let tx;
      let registrationAttempts = 3;
      
      // Base gas limit for registerRelay (typical value is around 400k-500k)
      const BASE_GAS_LIMIT = 600000n; // Use a safe default with buffer
      
      while (registrationAttempts > 0) {
        try {
          // Final allowance check using the same provider that will send the transaction
          const finalAllowanceCheck = await usdc.allowance(
            wallet.address,
            registryAddress
          );
          log.info(
            `Final allowance check before transaction: ${ethers.formatUnits(finalAllowanceCheck, 6)} USDC (need ${ethers.formatUnits(stakeWei, 6)} USDC)`
          );
          
          if (finalAllowanceCheck < stakeWei) {
            throw new Error(
              `Allowance insufficient before transaction. Have: ${ethers.formatUnits(finalAllowanceCheck, 6)} USDC, Need: ${ethers.formatUnits(stakeWei, 6)} USDC`
            );
          }
          
          // First, try to populate the transaction (this doesn't call estimateGas)
          const populatedTx = await contract.registerRelay.populateTransaction(
            endpoint,
            ethers.hexlify(pubkeyBytes),
            typeof epubBytes === "string" ? epubBytes : ethers.hexlify(epubBytes),
            stakeWei,
            BigInt(griefingRatio)
          );
          
          // Try to estimate gas, but if it fails due to allowance, use a fixed gas limit
          let gasEstimate: bigint | null = null;
          let gasEstimateAttempts = 5;
          while (gasEstimateAttempts > 0) {
            try {
              gasEstimate = await client.provider.estimateGas({
                ...populatedTx,
                from: wallet.address,
              });
              log.info(`Gas estimate successful: ${gasEstimate.toString()}`);
              // Add 20% buffer to the gas estimate
              gasEstimate = (gasEstimate * 120n) / 100n;
              break;
            } catch (gasError: any) {
              gasEstimateAttempts--;
              const isAllowanceError = gasError.message && (
                gasError.message.includes("allowance") ||
                gasError.message.includes("ERC20: transfer amount exceeds allowance")
              );
              
              if (isAllowanceError) {
                log.warn(
                  `Gas estimation failed due to allowance (${gasEstimateAttempts} attempts left). This may be a state propagation issue. Will use fixed gas limit if all retries fail.`
                );
                if (gasEstimateAttempts > 0) {
                  // Wait a bit and check allowance again
                  await new Promise((resolve) => setTimeout(resolve, 3000));
                  const retryAllowance = await usdc.allowance(
                    wallet.address,
                    registryAddress
                  );
                  log.info(
                    `Retry allowance check: ${ethers.formatUnits(retryAllowance, 6)} USDC`
                  );
                  if (retryAllowance < stakeWei) {
                    throw new Error(
                      `Allowance lost during retry. Expected: ${ethers.formatUnits(stakeWei, 6)} USDC, Got: ${ethers.formatUnits(retryAllowance, 6)} USDC`
                    );
                  }
                  continue;
                } else {
                  // Last attempt failed, we'll use fixed gas limit
                  log.warn("Gas estimation failed after all retries. Using fixed gas limit.");
                  gasEstimate = null;
                  break;
                }
              } else {
                // Not an allowance error, throw it
                if (gasEstimateAttempts === 0) {
                  throw gasError;
                }
              }
            }
          }
          
          // Use estimated gas if available, otherwise use base gas limit
          const gasLimit = gasEstimate || BASE_GAS_LIMIT;
          log.info(`Using gas limit: ${gasLimit.toString()}`);
          
          // Send the transaction with the gas limit
          tx = await wallet.sendTransaction({
            ...populatedTx,
            gasLimit: gasLimit,
          });
          log.info(`Registration transaction sent: ${tx.hash}`);
          break; // Success, exit retry loop
        } catch (error: any) {
          registrationAttempts--;
          const isAllowanceError = error.message && (
            error.message.includes("allowance") ||
            error.message.includes("ERC20: transfer amount exceeds allowance")
          );
          
          if (isAllowanceError) {
            log.warn(
              `Registration attempt failed due to allowance (${registrationAttempts} attempts left)`
            );
            if (registrationAttempts > 0) {
              // Wait longer and verify allowance before retrying
              await new Promise((resolve) => setTimeout(resolve, 5000));
              const retryAllowance = await usdc.allowance(
                wallet.address,
                registryAddress
              );
              log.info(
                `Retry allowance check: ${ethers.formatUnits(retryAllowance, 6)} USDC`
              );
              if (retryAllowance < stakeWei) {
                throw new Error(
                  `Allowance lost during retry. Expected: ${ethers.formatUnits(stakeWei, 6)} USDC, Got: ${ethers.formatUnits(retryAllowance, 6)} USDC`
                );
              }
              // Wait for one more block before retrying
              const currentBlock = await client.provider.getBlockNumber();
              await new Promise((resolve) => setTimeout(resolve, 2000));
              const newBlock = await client.provider.getBlockNumber();
              if (newBlock === currentBlock) {
                // Block hasn't advanced, wait a bit more
                await new Promise((resolve) => setTimeout(resolve, 3000));
              }
              continue;
            }
          }
          // If it's not an allowance error or we're out of attempts, throw
          if (registrationAttempts === 0 || !isAllowanceError) {
            throw error;
          }
        }
      }
      
      if (!tx) {
        throw new Error("Failed to send registration transaction after all retry attempts");
      }
      
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
     * @param newEndpoint - New endpoint (empty to keep current)
     * @param newGunPubKey - New GunDB public key (empty to keep current)
     * @param newEpub - New epub (empty to keep current)
     * @returns Transaction result
     */
    async updateRelay(
      newEndpoint: string = "",
      newGunPubKey: string = "",
      newEpub: string = ""
    ): Promise<TransactionResult> {
      if (newEndpoint) {
        const tx = await relayRegistry.updateRelay(newEndpoint);
        const receipt = await tx.wait();
        return {
          success: true,
          txHash: receipt.hash,
        };
      }

      if (newGunPubKey || newEpub) {
        const pubkeyBytes = newGunPubKey
          ? ethers.toUtf8Bytes(newGunPubKey)
          : "0x";
        const epubBytes = newEpub ? ethers.toUtf8Bytes(newEpub) : "0x";
        const tx = await relayRegistry.updateRelayEncryptionKeys(
          typeof pubkeyBytes === "string"
            ? pubkeyBytes
            : ethers.hexlify(pubkeyBytes),
          typeof epubBytes === "string" ? epubBytes : ethers.hexlify(epubBytes)
        );
        const receipt = await tx.wait();
        return {
          success: true,
          txHash: receipt.hash,
        };
      }

      throw new Error(
        "At least one field (endpoint, gunPubKey, or epub) must be provided"
      );
    },

    /**
     * Increase stake
     * @param amount - Additional USDC to stake
     * @returns Transaction result
     */
    async increaseStake(amount: string): Promise<TransactionResult> {
      const amountWei = ethers.parseUnits(amount, 6);

      // Check/set allowance
      const allowance = await usdc.allowance(
        wallet.address,
        client.registryAddress
      );
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
     * @returns Transaction result
     */
    async requestUnstake(): Promise<TransactionResult> {
      const tx = await relayRegistry.requestUnstake();
      const receipt = await tx.wait();
      return {
        success: true,
        txHash: receipt.hash,
      };
    },

    /**
     * Withdraw stake after delay period
     * @returns Transaction result
     */
    async withdrawStake(): Promise<TransactionResult> {
      const tx = await relayRegistry.withdrawStake();
      const receipt = await tx.wait();
      return {
        success: true,
        txHash: receipt.hash,
      };
    },

    /**
     * Report missed proof (Griefing)
     * @param relayAddress - Address of the relay to slash
     * @param dealId - Deal ID associated with the failure
     * @param evidence - Evidence string (e.g. IPFS hash of log)
     * @returns Transaction result
     */
    async griefMissedProof(
      relayAddress: string,
      dealId: string,
      evidence: string
    ): Promise<TransactionResult> {
      // This should be handled by StorageDealRegistry
      const storageDealClient = createStorageDealRegistryClientWithSigner(
        privateKey,
        chainId,
        rpcUrl
      );
      const slashBps = 100; // 1%
      const relayInfo = await (this as any).getRelayInfo(relayAddress);
      const stakedAmount = BigInt(relayInfo!.stakedAmountRaw);
      const slashAmount = (stakedAmount * BigInt(slashBps)) / BigInt(10000);
      return await storageDealClient.grief(
        dealId,
        ethers.formatUnits(slashAmount, 6),
        evidence
      );
    },

    /**
     * Report data loss (Griefing)
     * @param relayAddress - Address of the relay to slash
     * @param dealId - Deal ID associated with the failure
     * @param evidence - Evidence string
     * @returns Transaction result
     */
    async griefDataLoss(
      relayAddress: string,
      dealId: string,
      evidence: string
    ): Promise<TransactionResult> {
      const storageDealClient = createStorageDealRegistryClientWithSigner(
        privateKey,
        chainId,
        rpcUrl
      );
      const slashBps = 1000; // 10%
      const relayInfo = await (this as any).getRelayInfo(relayAddress);
      const stakedAmount = BigInt(relayInfo!.stakedAmountRaw);
      const slashAmount = (stakedAmount * BigInt(slashBps)) / BigInt(10000);
      return await storageDealClient.grief(
        dealId,
        ethers.formatUnits(slashAmount, 6),
        evidence
      );
    },
  };
}

/**
 * Generate deal ID from parameters
 * @param cid - CID
 * @param clientAddress - Client address
 * @param timestamp - Timestamp
 * @returns Deal ID string
 */
export function generateDealId(
  cid: string,
  clientAddress: string,
  timestamp: number = Date.now()
): string {
  return `deal-${cid}-${clientAddress}-${timestamp}`;
}

/**
 * Convert deal ID string to bytes32
 * @param dealId - Deal ID
 * @returns bytes32 hash
 */
export function dealIdToBytes32(dealId: string): string {
  return ethers.id(dealId);
}

/**
 * Create a StorageDealRegistry client instance using SDK
 * @param chainId - Chain ID (84532 for Base Sepolia, 8453 for Base)
 * @param rpcUrl - Optional custom RPC URL
 * @returns StorageDealRegistry client
 */
export function createStorageDealRegistryClient(
  chainId: number = 84532,
  rpcUrl: string | undefined = undefined
): any {
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
     * @param dealId - bytes32 deal ID (or string to hash)
     * @returns Deal info or undefined
     */
    async getDeal(dealId: string): Promise<DealInfo | undefined> {
      try {
        let dealIdBytes32: string;
        if (typeof dealId === "string") {
          dealIdBytes32 =
            dealId.startsWith("0x") && dealId.length === 66
              ? dealId
              : ethers.id(dealId);
        } else {
          dealIdBytes32 = ethers.hexlify(dealId);
        }

        const deal = await storageDealRegistry.getDeal(dealIdBytes32);

        if (!deal || deal.createdAt === 0n || deal.createdAt === 0) {
          return undefined;
        }

        return {
          dealId:
            typeof deal.dealId === "string"
              ? deal.dealId
              : ethers.hexlify(deal.dealId),
          relay:
            typeof deal.relay === "string"
              ? deal.relay
              : deal.relay.toLowerCase(),
          client:
            typeof deal.client === "string"
              ? deal.client
              : deal.client.toLowerCase(),
          cid: deal.cid,
          sizeMB: Number(deal.sizeMB),
          priceUSDC: ethers.formatUnits(deal.priceUSDC, 6),
          createdAt: new Date(Number(deal.createdAt) * 1000).toISOString(),
          expiresAt: new Date(Number(deal.expiresAt) * 1000).toISOString(),
          active: deal.active,
          clientStake: deal.clientStake
            ? ethers.formatUnits(deal.clientStake, 6)
            : "0",
          clientStakeRaw: deal.clientStake ? deal.clientStake.toString() : "0",
          griefed: deal.griefed || false,
        };
      } catch (e) {
        if (
          !(e as Error).message.includes("could not decode") &&
          !(e as Error).message.includes("execution reverted")
        ) {
          log.error({ error: e, dealId }, `Error fetching deal`);
        }
        return undefined;
      }
    },

    /**
     * Get all deals for a client
     * @param clientAddress - Client address
     * @returns Array of deals
     */
    async getClientDeals(clientAddress: string): Promise<Array<DealInfo>> {
      try {
        const normalizedAddress = ethers.getAddress(clientAddress);
        const dealIds: Array<string> =
          await storageDealRegistry.getClientDeals(normalizedAddress);

        if (!dealIds || dealIds.length === 0) {
          return [];
        }

        const deals: Array<DealInfo> = [];
        for (const id of dealIds) {
          try {
            let dealIdBytes32: string;
            if (typeof id === "string") {
              dealIdBytes32 = id.startsWith("0x") ? id : ethers.id(id);
            } else {
              dealIdBytes32 = ethers.hexlify(id);
            }

            const deal = await (this as any).getDeal(dealIdBytes32);
            if (deal) {
              deals.push(deal);
            }
          } catch (dealError) {
            if (!(dealError as Error).message.includes("could not decode")) {
              log.warn({ dealError }, `Error fetching deal`);
            }
          }
        }
        return deals;
      } catch (error) {
        log.error({ error, clientAddress }, `Error fetching client deals`);
        return [];
      }
    },

    /**
     * Get all deals for a relay
     * @param relayAddress - Relay address
     * @returns Array of deals
     */
    async getRelayDeals(relayAddress: string): Promise<Array<DealInfo>> {
      try {
        const normalizedAddress = ethers.getAddress(relayAddress);
        const dealIds: Array<string> =
          await storageDealRegistry.getRelayDeals(normalizedAddress);

        const deals: Array<DealInfo> = [];
        for (const id of dealIds) {
          const deal = await (this as any).getDeal(id);
          if (deal) deals.push(deal);
        }
        return deals;
      } catch (error) {
        log.error({ error, relayAddress }, `Error fetching relay deals`);
        return [];
      }
    },
  };
}

/**
 * Create a StorageDealRegistry client with signer for state-changing operations
 * @param privateKey - Relay operator private key
 * @param chainId - Chain ID
 * @param rpcUrl - Optional custom RPC URL
 * @returns StorageDealRegistry client with signer
 */
export function createStorageDealRegistryClientWithSigner(
  privateKey: string,
  chainId: number = 84532,
  rpcUrl: string | undefined = undefined
): any {
  const client = createStorageDealRegistryClient(chainId, rpcUrl);
  const wallet = new ethers.Wallet(privateKey, client.provider);
  const sdkWithSigner = new ShogunSDK({
    provider: client.provider,
    signer: wallet,
    chainId,
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
     * @param dealId - Unique deal ID (will be hashed to bytes32)
     * @param clientAddress - Client address
     * @param cid - IPFS CID
     * @param sizeMB - Size in MB
     * @param priceUSDC - Price in USDC (human readable)
     * @param durationDays - Duration in days
     * @param clientStake - Optional client stake in USDC (human readable, e.g., "10")
     * @returns Transaction result
     */
    async registerDeal(
      dealId: string,
      clientAddress: string,
      cid: string,
      sizeMB: number,
      priceUSDC: string,
      durationDays: number,
      clientStake: string = "0"
    ): Promise<TransactionResult> {
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
     * @param dealId - Deal ID (string, will be hashed)
     * @returns Transaction result
     */
    async completeDeal(dealId: string): Promise<TransactionResult> {
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
     * @param dealId - Deal ID
     * @param slashAmount - Amount to slash in USDC
     * @param reason - Reason for griefing
     * @returns Transaction result
     */
    async grief(
      dealId: string,
      slashAmount: string,
      reason: string
    ): Promise<TransactionResult> {
      const dealIdBytes32 = ethers.id(dealId);
      const slashAmountWei = ethers.parseUnits(slashAmount, 6);
      const tx = await storageDealRegistry.grief(
        dealIdBytes32,
        slashAmountWei,
        reason
      );
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
