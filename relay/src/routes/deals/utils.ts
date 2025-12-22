import type { Deal } from "../../utils/storage-deals";

// In-memory cache for recently created deals (GunDB sync can be slow)
// Deals are cached for 10 minutes to allow time for payment
export const pendingDealsCache = new Map<string, { deal: Deal; cachedAt: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export function cacheDeal(deal: Deal) {
  pendingDealsCache.set(deal.id, {
    deal,
    cachedAt: Date.now(),
  });

  // Clean expired entries
  for (const [id, entry] of pendingDealsCache) {
    if (Date.now() - entry.cachedAt > CACHE_TTL) {
      pendingDealsCache.delete(id);
    }
  }
}

export function getCachedDeal(dealId: string): Deal | null {
  const entry = pendingDealsCache.get(dealId);
  if (entry && Date.now() - entry.cachedAt < CACHE_TTL) {
    return entry.deal;
  }
  pendingDealsCache.delete(dealId);
  return null;
}

export function removeCachedDeal(dealId: string) {
  pendingDealsCache.delete(dealId);
}
