/**
 * Pricing Configuration for Shogun Relay
 *
 * Each relay can set its own pricing for deals and subscriptions.
 * Prices can be configured via environment variables or this config file.
 *
 * Priority: Environment variables > This config file > Default values
 */

import dotenv from "dotenv";
import type { DealPricingTier, SubscriptionTier, PricingConfig } from "./pricing-config.d";
export type { DealPricingTier, SubscriptionTier, PricingConfig };

dotenv.config();

// ============================================================================
// STORAGE DEALS PRICING
// ============================================================================

// ============================================================================
// STORAGE DEALS PRICING
// ============================================================================

import { getConfigValue } from "../utils/runtime-config";

/**
 * Get deal pricing configuration
 * Reads from environment variables or uses defaults (via runtime-config lookups)
 */
export function getDealPricing(): Record<string, DealPricingTier> {
  return {
    standard: {
      pricePerMBMonth: parseFloat(getConfigValue("DEAL_PRICE_STANDARD") || "0.0001"),
      minSizeMB: parseFloat(getConfigValue("DEAL_MIN_SIZE_MB") || "0.001"),
      maxSizeMB: parseFloat(getConfigValue("DEAL_MAX_SIZE_MB") || "1000"),
      minDurationDays: parseInt(getConfigValue("DEAL_MIN_DURATION_DAYS") || "7"),
      maxDurationDays: parseInt(getConfigValue("DEAL_MAX_DURATION_DAYS") || "365"),
    },
    premium: {
      pricePerMBMonth: parseFloat(getConfigValue("DEAL_PRICE_PREMIUM") || "0.0002"),
      minSizeMB: parseFloat(getConfigValue("DEAL_MIN_SIZE_MB") || "0.001"),
      maxSizeMB: parseFloat(getConfigValue("DEAL_MAX_SIZE_MB") || "10000"),
      minDurationDays: parseInt(getConfigValue("DEAL_MIN_DURATION_DAYS") || "7"),
      maxDurationDays: parseInt(getConfigValue("DEAL_MAX_DURATION_DAYS") || "730"),
      includesErasureCoding: true,
      replicationFactor: parseInt(getConfigValue("DEAL_PREMIUM_REPLICATION") || "3"),
    },
    enterprise: {
      pricePerMBMonth: parseFloat(getConfigValue("DEAL_PRICE_ENTERPRISE") || "0.0005"),
      minSizeMB: parseFloat(getConfigValue("DEAL_MIN_SIZE_MB") || "0.001"),
      maxSizeMB: parseFloat(getConfigValue("DEAL_MAX_SIZE_MB") || "100000"),
      minDurationDays: parseInt(getConfigValue("DEAL_MIN_DURATION_DAYS") || "7"),
      maxDurationDays: parseInt(getConfigValue("DEAL_MAX_DURATION_DAYS") || "1825"),
      includesErasureCoding: true,
      replicationFactor: parseInt(getConfigValue("DEAL_ENTERPRISE_REPLICATION") || "5"),
      slaGuarantee: true,
    },
  };
}

// ============================================================================
// SUBSCRIPTION PRICING
// ============================================================================

/**
 * Get subscription pricing configuration
 * Reads from environment variables or uses defaults (via runtime-config lookups)
 */
export function getSubscriptionPricing(): Record<string, SubscriptionTier> {
  return {
    basic: {
      name: "Basic",
      storageMB: parseInt(getConfigValue("SUB_BASIC_STORAGE_MB") || "100"),
      priceUSDC: parseFloat(getConfigValue("SUB_BASIC_PRICE") || "0.001"),
      durationDays: parseInt(getConfigValue("SUB_DURATION_DAYS") || "30"),
    },
    standard: {
      name: "Standard",
      storageMB: parseInt(getConfigValue("SUB_STANDARD_STORAGE_MB") || "500"),
      priceUSDC: parseFloat(getConfigValue("SUB_STANDARD_PRICE") || "0.004"),
      durationDays: parseInt(getConfigValue("SUB_DURATION_DAYS") || "30"),
    },
    premium: {
      name: "Premium",
      storageMB: parseInt(getConfigValue("SUB_PREMIUM_STORAGE_MB") || "2000"),
      priceUSDC: parseFloat(getConfigValue("SUB_PREMIUM_PRICE") || "0.01"),
      durationDays: parseInt(getConfigValue("SUB_DURATION_DAYS") || "30"),
    },
  };
}

// ============================================================================
// EXPORT CONFIGURATION
// ============================================================================

// Export as a dynamic object using getters to ensure fresh values on every access
export const PRICING_CONFIG: PricingConfig = {
  get deals() {
    return getDealPricing();
  },
  get subscriptions() {
    return getSubscriptionPricing();
  },
};

