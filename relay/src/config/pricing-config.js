/**
 * Pricing Configuration for Shogun Relay
 * 
 * Each relay can set its own pricing for deals and subscriptions.
 * Prices can be configured via environment variables or this config file.
 * 
 * Priority: Environment variables > This config file > Default values
 */

import dotenv from 'dotenv';
dotenv.config();

// ============================================================================
// STORAGE DEALS PRICING
// ============================================================================

/**
 * Get deal pricing configuration
 * Reads from environment variables or uses defaults
 */
export function getDealPricing() {
  return {
    standard: {
      pricePerMBMonth: parseFloat(process.env.DEAL_PRICE_STANDARD) || 0.0001,
      minSizeMB: parseFloat(process.env.DEAL_MIN_SIZE_MB) || 0.001,
      maxSizeMB: parseFloat(process.env.DEAL_MAX_SIZE_MB) || 1000,
      minDurationDays: parseInt(process.env.DEAL_MIN_DURATION_DAYS) || 7,
      maxDurationDays: parseInt(process.env.DEAL_MAX_DURATION_DAYS) || 365,
    },
    premium: {
      pricePerMBMonth: parseFloat(process.env.DEAL_PRICE_PREMIUM) || 0.0002,
      minSizeMB: parseFloat(process.env.DEAL_MIN_SIZE_MB) || 0.001,
      maxSizeMB: parseFloat(process.env.DEAL_MAX_SIZE_MB) || 10000,
      minDurationDays: parseInt(process.env.DEAL_MIN_DURATION_DAYS) || 7,
      maxDurationDays: parseInt(process.env.DEAL_MAX_DURATION_DAYS) || 730,
      includesErasureCoding: true,
      replicationFactor: parseInt(process.env.DEAL_PREMIUM_REPLICATION) || 3,
    },
    enterprise: {
      pricePerMBMonth: parseFloat(process.env.DEAL_PRICE_ENTERPRISE) || 0.0005,
      minSizeMB: parseFloat(process.env.DEAL_MIN_SIZE_MB) || 0.001,
      maxSizeMB: parseFloat(process.env.DEAL_MAX_SIZE_MB) || 100000,
      minDurationDays: parseInt(process.env.DEAL_MIN_DURATION_DAYS) || 7,
      maxDurationDays: parseInt(process.env.DEAL_MAX_DURATION_DAYS) || 1825,
      includesErasureCoding: true,
      replicationFactor: parseInt(process.env.DEAL_ENTERPRISE_REPLICATION) || 5,
      slaGuarantee: true,
    },
  };
}

// ============================================================================
// SUBSCRIPTION PRICING
// ============================================================================

/**
 * Get subscription pricing configuration
 * Reads from environment variables or uses defaults
 */
export function getSubscriptionPricing() {
  return {
    basic: {
      name: 'Basic',
      storageMB: parseInt(process.env.SUB_BASIC_STORAGE_MB) || 100,
      priceUSDC: parseFloat(process.env.SUB_BASIC_PRICE) || 0.001,
      durationDays: parseInt(process.env.SUB_DURATION_DAYS) || 30,
    },
    standard: {
      name: 'Standard',
      storageMB: parseInt(process.env.SUB_STANDARD_STORAGE_MB) || 500,
      priceUSDC: parseFloat(process.env.SUB_STANDARD_PRICE) || 0.004,
      durationDays: parseInt(process.env.SUB_DURATION_DAYS) || 30,
    },
    premium: {
      name: 'Premium',
      storageMB: parseInt(process.env.SUB_PREMIUM_STORAGE_MB) || 2000,
      priceUSDC: parseFloat(process.env.SUB_PREMIUM_PRICE) || 0.01,
      durationDays: parseInt(process.env.SUB_DURATION_DAYS) || 30,
    },
  };
}

// ============================================================================
// EXPORT CONFIGURATION
// ============================================================================

export const PRICING_CONFIG = {
  deals: getDealPricing(),
  subscriptions: getSubscriptionPricing(),
};
