import { ApiClient } from '../client';

export interface PendingWithdrawal {
  user: string;
  amount: string;
  nonce: string;
  timestamp: number;
  txHash?: string;
  debitHash?: string; // Hash of debit frozen entry (proof of balance deduction)
}

export interface BridgeState {
  currentStateRoot: string;
  currentBatchId: string;
  sequencer: string;
  contractBalance: string;
  contractBalanceEth: string;
}

export interface WithdrawalProof {
  proof: string[];
  batchId: string;
  root: string;
  withdrawal: {
    user: string;
    amount: string;
    nonce: string;
  };
}

export interface TransferResult {
  from: string;
  to: string;
  amount: string;
  txHash: string;
  fromBalance: string;
  toBalance: string;
}

export interface WithdrawalResult {
  user: string;
  amount: string;
  nonce: string;
  timestamp: number;
}

export interface BatchResult {
  batchId: string;
  root: string;
  withdrawalCount: number;
  verifiedCount?: number; // Number of verified withdrawals (security check passed)
  excludedCount?: number; // Number of excluded withdrawals (security check failed)
  txHash: string;
  blockNumber: number;
}

export class BridgeModule {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * Get user's L2 balance
   * @param userAddress User's Ethereum address
   * @returns Balance in wei and ETH
   */
  public async getBalance(userAddress: string): Promise<{
    success: boolean;
    user: string;
    balance: string;
    balanceEth: string;
  }> {
    return this.client.get(`/api/v1/bridge/balance/${userAddress}`);
  }

  /**
   * Get the next nonce for a user (for withdrawal requests)
   * This allows clients to include the nonce in their signed message
   * @param userAddress User's Ethereum address
   * @returns Last nonce and next nonce
   */
  public async getNonce(userAddress: string): Promise<{
    success: boolean;
    lastNonce: string;
    nextNonce: string;
  }> {
    return this.client.get(`/api/v1/bridge/nonce/${userAddress}`);
  }

  /**
   * Transfer balance from one user to another (L2 -> L2)
   * @param params Transfer parameters
   * @returns Transfer result
   */
  public async transfer(params: {
    from: string;
    to: string;
    amount: string;
    message: string;
    seaSignature: string;
    ethSignature: string;
    gunPubKey: string;
  }): Promise<{
    success: boolean;
    transfer: TransferResult;
  }> {
    return this.client.post('/api/v1/bridge/transfer', params);
  }

  /**
   * Request withdrawal from L2 (creates pending withdrawal)
   * @param params Withdrawal parameters
   * @returns Withdrawal result
   */
  public async withdraw(params: {
    user: string;
    amount: string;
    nonce: string;
    message: string;
    seaSignature: string;
    ethSignature: string;
    gunPubKey: string;
  }): Promise<{
    success: boolean;
    withdrawal: WithdrawalResult;
    message: string;
  }> {
    return this.client.post('/api/v1/bridge/withdraw', params);
  }

  /**
   * Get all pending withdrawals (waiting for batch submission)
   * @returns List of pending withdrawals
   */
  public async getPendingWithdrawals(): Promise<{
    success: boolean;
    withdrawals: PendingWithdrawal[];
    count: number;
  }> {
    return this.client.get('/api/v1/bridge/pending-withdrawals');
  }

  /**
   * Generate Merkle proof for a withdrawal
   * The withdrawal must be included in the latest batch
   * @param user User address
   * @param amount Withdrawal amount
   * @param nonce Withdrawal nonce
   * @returns Merkle proof
   */
  public async getProof(
    user: string,
    amount: string,
    nonce: string
  ): Promise<{
    success: boolean;
    proof: WithdrawalProof;
  }> {
    return this.client.get(`/api/v1/bridge/proof/${user}/${amount}/${nonce}`);
  }

  /**
   * Get current bridge state (root, batchId, contract balance, etc.)
   * @returns Bridge state
   */
  public async getState(): Promise<{
    success: boolean;
    state: BridgeState;
  }> {
    return this.client.get('/api/v1/bridge/state');
  }

  /**
   * Submit a batch with Merkle root (sequencer only)
   * @returns Batch submission result
   */
  public async submitBatch(): Promise<{
    success: boolean;
    batch: BatchResult;
  }> {
    return this.client.post('/api/v1/bridge/submit-batch');
  }

  /**
   * Get deposit instructions (informational endpoint)
   * Note: Actual deposits should be done on-chain by calling the contract's deposit() function
   * @param amount Amount to deposit
   * @returns Deposit instructions
   */
  public async getDepositInstructions(amount: string): Promise<{
    success: boolean;
    message: string;
    contractAddress: string;
    amount: string;
    instructions: string;
  }> {
    return this.client.post('/api/v1/bridge/deposit', { amount });
  }

  /**
   * Retroactively sync missed deposits from a block range
   * Useful if the relay missed some deposits due to downtime or errors
   * @param params Sync parameters
   * @returns Sync results
   */
  public async syncDeposits(params?: {
    fromBlock?: number;
    toBlock?: number | 'latest';
    user?: string;
  }): Promise<{
    success: boolean;
    results: {
      total: number;
      processed: number;
      skipped: number;
      failed: number;
      errors: string[];
    };
  }> {
    return this.client.post('/api/v1/bridge/sync-deposits', params || {});
  }

  /**
   * Force process a specific deposit by transaction hash
   * Useful for manually recovering a missed deposit
   * @param txHash Transaction hash of the deposit
   * @returns Deposit processing result
   */
  public async processDeposit(txHash: string): Promise<{
    success: boolean;
    deposit?: {
      txHash: string;
      user: string;
      amount: string;
      amountEth: string;
      blockNumber: number;
    };
    balance?: {
      wei: string;
      eth: string;
    };
    message?: string;
    error?: string;
  }> {
    return this.client.post('/api/v1/bridge/process-deposit', { txHash });
  }

  /**
   * Reconcile user's L2 balance by recalculating from deposits, withdrawals, and L2 transfers
   * This fixes balance discrepancies caused by old transfer implementations
   * @param userAddress User's Ethereum address to reconcile
   * @returns Reconciliation result
   */
  public async reconcileBalance(userAddress: string): Promise<{
    success: boolean;
    user: string;
    currentBalance: string;
    calculatedBalance: string;
    corrected: boolean;
    message: string;
    error?: string;
  }> {
    return this.client.post('/api/v1/bridge/reconcile-balance', { user: userAddress });
  }

  /**
   * Get all transactions (deposits, withdrawals, transfers) for a user
   * Returns a unified list of all transaction types sorted by timestamp
   * @param userAddress User's Ethereum address
   * @returns Transaction history
   */
  public async getTransactions(userAddress: string): Promise<{
    success: boolean;
    user: string;
    transactions: Array<{
      type: 'deposit' | 'withdrawal' | 'transfer';
      txHash: string;
      from?: string;
      to?: string;
      amount: string;
      amountEth: string;
      timestamp: number;
      blockNumber?: number;
      nonce?: string;
      batchId?: string;
      status: 'pending' | 'completed' | 'batched';
    }>;
    count: number;
    summary: {
      deposits: number;
      withdrawals: number;
      transfers: number;
    };
  }> {
    return this.client.get(`/api/v1/bridge/transactions/${userAddress}`);
  }

  /**
   * Get detailed information about a specific transaction by hash
   * Searches across deposits, withdrawals, and transfers
   * @param txHash Transaction hash
   * @returns Transaction details
   */
  public async getTransaction(txHash: string): Promise<{
    success: boolean;
    transaction?: {
      type: 'deposit' | 'withdrawal' | 'transfer';
      txHash: string;
      from?: string;
      to?: string;
      amount: string;
      amountEth: string;
      timestamp: number;
      blockNumber?: number;
      nonce?: string;
      status: 'pending' | 'completed' | 'batched';
    };
    source?: 'deposit' | 'withdrawal' | 'transfer';
    error?: string;
  }> {
    return this.client.get(`/api/v1/bridge/transaction/${txHash}`);
  }
}

