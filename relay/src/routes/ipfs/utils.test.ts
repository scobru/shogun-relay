import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { verifyWalletSignature } from './utils';

describe('verifyWalletSignature', () => {
  it('should verify a valid legacy signature', async () => {
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const message = "I Love Shogun";
    const signature = await wallet.signMessage(message);

    const isValid = await verifyWalletSignature(address, signature);
    expect(isValid).toBe(true);
  });

  it('should verify a valid signature with timestamp', async () => {
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const timestamp = Date.now();
    const message = `I Love Shogun - ${timestamp}`;
    const signature = await wallet.signMessage(message);

    const isValid = await verifyWalletSignature(address, signature, timestamp);
    expect(isValid).toBe(true);
  });

  it('should fail if timestamp is expired', async () => {
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const timestamp = Date.now() - (6 * 60 * 1000); // 6 minutes ago
    const message = `I Love Shogun - ${timestamp}`;
    const signature = await wallet.signMessage(message);

    const isValid = await verifyWalletSignature(address, signature, timestamp);
    expect(isValid).toBe(false);
  });

  it('should fail if timestamp is too far in future', async () => {
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const timestamp = Date.now() + (6 * 60 * 1000); // 6 minutes in future
    const message = `I Love Shogun - ${timestamp}`;
    const signature = await wallet.signMessage(message);

    const isValid = await verifyWalletSignature(address, signature, timestamp);
    expect(isValid).toBe(false);
  });

  it('should fail if signature does not match message with timestamp', async () => {
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const timestamp = Date.now();
    const message = "I Love Shogun"; // Legacy message
    const signature = await wallet.signMessage(message);

    // Provide timestamp but signature is for legacy message
    const isValid = await verifyWalletSignature(address, signature, timestamp);
    expect(isValid).toBe(false);
  });

  it('should fail if signature is invalid', async () => {
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address;
    const signature = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b"; // Random valid hex string but wrong signature

    const isValid = await verifyWalletSignature(address, signature);
    expect(isValid).toBe(false);
  });

  it('should fail if address does not match', async () => {
    const wallet = ethers.Wallet.createRandom();
    const otherWallet = ethers.Wallet.createRandom();
    const message = "I Love Shogun";
    const signature = await wallet.signMessage(message);

    const isValid = await verifyWalletSignature(otherWallet.address, signature);
    expect(isValid).toBe(false);
  });
});
