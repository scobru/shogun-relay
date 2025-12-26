/**
 * Wallet utility functions for Shogun Relay SDK
 */

/**
 * Message that must be signed for wallet authentication
 */
export const WALLET_AUTH_MESSAGE = "I Love Shogun";

/**
 * Generate wallet signature for authentication
 * 
 * @param signer - Ethers.js Signer instance or similar that implements signMessage
 * @returns Promise<string> - EIP-191 signature of the auth message
 * 
 * @example
 * ```typescript
 * import { ethers } from 'ethers';
 * import { generateWalletSignature } from '@shogun/relay-sdk/utils/wallet';
 * 
 * const provider = new ethers.BrowserProvider(window.ethereum);
 * const signer = await provider.getSigner();
 * const signature = await generateWalletSignature(signer);
 * ```
 */
export async function generateWalletSignature(signer: {
  signMessage: (message: string) => Promise<string>;
}): Promise<string> {
  return await signer.signMessage(WALLET_AUTH_MESSAGE);
}

/**
 * Verify wallet signature
 * 
 * @param address - Ethereum wallet address
 * @param signature - EIP-191 signature
 * @returns Promise<boolean> - True if signature is valid for the address
 * 
 * @example
 * ```typescript
 * import { ethers } from 'ethers';
 * import { verifyWalletSignature } from '@shogun/relay-sdk/utils/wallet';
 * 
 * const isValid = await verifyWalletSignature(address, signature);
 * ```
 */
export async function verifyWalletSignature(
  address: string,
  signature: string
): Promise<boolean> {
  try {
    const { ethers } = await import("ethers");
    const recoveredAddress = ethers.verifyMessage(WALLET_AUTH_MESSAGE, signature);
    return recoveredAddress.toLowerCase() === address.toLowerCase();
  } catch (error) {
    return false;
  }
}

/**
 * Get wallet address from signature
 * 
 * @param signature - EIP-191 signature
 * @returns Promise<string | null> - Recovered wallet address or null if invalid
 * 
 * @example
 * ```typescript
 * import { getAddressFromSignature } from '@shogun/relay-sdk/utils/wallet';
 * 
 * const address = await getAddressFromSignature(signature);
 * ```
 */
export async function getAddressFromSignature(signature: string): Promise<string | null> {
  try {
    const { ethers } = await import("ethers");
    return ethers.verifyMessage(WALLET_AUTH_MESSAGE, signature);
  } catch (error) {
    return null;
  }
}

