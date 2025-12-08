/**
 * Type declarations for pricing configuration
 */

export interface DealPricingTier {
    pricePerMBMonth: number;
    minSizeMB: number;
    maxSizeMB: number;
    minDurationDays: number;
    maxDurationDays: number;
    includesErasureCoding?: boolean;
    replicationFactor?: number;
    slaGuarantee?: boolean;
}

export interface SubscriptionTier {
    name: string;
    storageMB: number;
    priceUSDC: number;
    durationDays: number;
}

export interface PricingConfig {
    deals: Record<string, DealPricingTier>;
    subscriptions: Record<string, SubscriptionTier>;
}

export declare function getDealPricing(): Record<string, DealPricingTier>;
export declare function getSubscriptionPricing(): Record<string, SubscriptionTier>;
export declare const PRICING_CONFIG: PricingConfig;
