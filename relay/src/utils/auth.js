import { ethers } from "ethers";

/**
 * Verifies a wallet signature to ensure the message was signed by the expected address.
 * @param {string} message The message that was signed.
 * @param {string} signature The signature to verify.
 * @param {string} expectedAddress The address that should have signed the message.
 * @returns {boolean} True if the signature is valid, false otherwise.
 */
export function verifyWalletSignature(message, signature, expectedAddress) {
  try {
    // Verify the signature against the message
    const signerAddress = ethers.verifyMessage(message, signature);

    // Compare the recovered address with the expected address
    const isSignatureValid = signerAddress.toLowerCase() === expectedAddress.toLowerCase();

    if (isSignatureValid) {
      console.log(`✅ Wallet signature verified for: ${expectedAddress}`);
    } else {
      console.warn(
        `⚠️ Wallet signature mismatch. Expected: ${expectedAddress}, Got: ${signerAddress}`
      );
    }

    return isSignatureValid;
  } catch (error) {
    console.error("❌ Error verifying wallet signature:", error.message);
    return false;
  }
}
