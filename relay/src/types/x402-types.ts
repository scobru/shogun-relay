/**
 * x402 Official Types
 *
 * Types copied from the official x402 package (x402/typescript/packages/x402/src/types/verify/x402Specs.ts)
 * Simplified version without Zod validation - using pure TypeScript types only.
 */

// Network types (simplified from NetworkSchema)
export type Network =
  | "abstract"
  | "abstract-testnet"
  | "base-sepolia"
  | "base"
  | "avalanche-fuji"
  | "avalanche"
  | "iotex"
  | "solana-devnet"
  | "solana"
  | "sei"
  | "sei-testnet"
  | "polygon"
  | "polygon-amoy"
  | "peaq"
  | "story"
  | "educhain"
  | "skale-base-sepolia";

// Scheme types
export type Scheme = "exact";

// Error reasons
export type ErrorReason =
  | "insufficient_funds"
  | "invalid_exact_evm_payload_authorization_valid_after"
  | "invalid_exact_evm_payload_authorization_valid_before"
  | "invalid_exact_evm_payload_authorization_value"
  | "invalid_exact_evm_payload_signature"
  | "invalid_exact_evm_payload_undeployed_smart_wallet"
  | "invalid_exact_evm_payload_recipient_mismatch"
  | "invalid_exact_svm_payload_transaction"
  | "invalid_exact_svm_payload_transaction_amount_mismatch"
  | "invalid_exact_svm_payload_transaction_create_ata_instruction"
  | "invalid_exact_svm_payload_transaction_create_ata_instruction_incorrect_payee"
  | "invalid_exact_svm_payload_transaction_create_ata_instruction_incorrect_asset"
  | "invalid_exact_svm_payload_transaction_instructions"
  | "invalid_exact_svm_payload_transaction_instructions_length"
  | "invalid_exact_svm_payload_transaction_instructions_compute_limit_instruction"
  | "invalid_exact_svm_payload_transaction_instructions_compute_price_instruction"
  | "invalid_exact_svm_payload_transaction_instructions_compute_price_instruction_too_high"
  | "invalid_exact_svm_payload_transaction_instruction_not_spl_token_transfer_checked"
  | "invalid_exact_svm_payload_transaction_instruction_not_token_2022_transfer_checked"
  | "invalid_exact_svm_payload_transaction_fee_payer_included_in_instruction_accounts"
  | "invalid_exact_svm_payload_transaction_fee_payer_transferring_funds"
  | "invalid_exact_svm_payload_transaction_not_a_transfer_instruction"
  | "invalid_exact_svm_payload_transaction_receiver_ata_not_found"
  | "invalid_exact_svm_payload_transaction_sender_ata_not_found"
  | "invalid_exact_svm_payload_transaction_simulation_failed"
  | "invalid_exact_svm_payload_transaction_transfer_to_incorrect_ata"
  | "invalid_network"
  | "invalid_payload"
  | "invalid_payment_requirements"
  | "invalid_scheme"
  | "invalid_payment"
  | "payment_expired"
  | "unsupported_scheme"
  | "invalid_x402_version"
  | "invalid_transaction_state"
  | "settle_exact_svm_block_height_exceeded"
  | "settle_exact_svm_transaction_confirmation_timed_out"
  | "unexpected_settle_error"
  | "unexpected_verify_error";

/**
 * EIP-3009 Authorization structure for EVM
 */
export interface ExactEvmPayloadAuthorization {
  from: string; // EVM address (0x...)
  to: string; // EVM address (0x...)
  value: string; // Amount in atomic units (integer string)
  validAfter: string; // Unix timestamp (integer string)
  validBefore: string; // Unix timestamp (integer string)
  nonce: string; // 64-byte hex string (0x...)
}

/**
 * Exact EVM payment payload
 */
export interface ExactEvmPayload {
  signature: string; // Hex signature (0x...)
  authorization: ExactEvmPayloadAuthorization;
}

/**
 * Exact Solana payment payload
 */
export interface ExactSvmPayload {
  transaction: string; // Base64 encoded transaction
}

/**
 * Payment Requirements (x402 specification)
 */
export interface PaymentRequirements {
  scheme: Scheme;
  network: Network;
  maxAmountRequired: string; // Amount in atomic units (integer string)
  resource: string; // URL of the resource
  description: string;
  mimeType: string;
  outputSchema?: Record<string, any>;
  payTo: string; // EVM or Solana address
  maxTimeoutSeconds: number;
  asset: string; // Token contract address (EVM or Solana)
  extra?: Record<string, any>;
}

/**
 * Payment Payload (x402 specification)
 */
export interface PaymentPayload {
  x402Version: 1;
  scheme: Scheme;
  network: Network;
  payload: ExactEvmPayload | ExactSvmPayload;
}

/**
 * x402 Response (Payment Required Response)
 */
export interface X402Response {
  x402Version: 1;
  error?: ErrorReason;
  accepts?: PaymentRequirements[];
  payer?: string;
}

/**
 * Verify Response from facilitator
 */
export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: ErrorReason;
  payer?: string;
}

/**
 * Settle Response from facilitator
 */
export interface SettleResponse {
  success: boolean;
  errorReason?: ErrorReason;
  payer?: string;
  transaction: string; // Transaction hash/ID
  network: Network;
}
