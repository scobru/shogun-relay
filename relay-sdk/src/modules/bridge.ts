import { ApiClient } from '../client';

export interface PendingWithdrawal {
  user: string;
  amount: string;
  nonce: string;
  timestamp: number;
  txHash?: string;
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
}

