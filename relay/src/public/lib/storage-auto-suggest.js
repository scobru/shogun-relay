/**
 * Storage Auto-Suggest Module
 * 
 * Provides intelligent recommendations for choosing between subscriptions and deals
 * based on file size, duration, and user's current subscription status.
 */

import { StorageState } from './storage-common.js';
import { MessageSystem } from './storage-common.js';

export class AutoSuggest {
  constructor(messageContainerId = 'globalMessage') {
    this.messageSystem = new MessageSystem(messageContainerId);
    this.currentRecommendation = null;
  }

  /**
   * Get recommendation for file storage
   * @param {number} fileSizeMB - File size in MB
   * @param {number} durationDays - Duration in days
   * @param {string} userAddress - Optional user address for subscription check
   * @returns {Promise<Object>} Recommendation object
   */
  async getRecommendation(fileSizeMB, durationDays, userAddress = null) {
    try {
      const params = new URLSearchParams({
        fileSizeMB: fileSizeMB.toString(),
        durationDays: durationDays.toString(),
      });

      if (userAddress || StorageState.connectedAddress) {
        params.append('userAddress', userAddress || StorageState.connectedAddress);
      }

      const response = await fetch(`/api/v1/x402/recommend?${params.toString()}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to get recommendation');
      }

      this.currentRecommendation = data.recommendation;
      return data.recommendation;
    } catch (error) {
      console.error('Auto-suggest error:', error);
      throw error;
    }
  }

  /**
   * Show recommendation banner in UI
   * @param {HTMLElement} container - Container element to show recommendation
   * @param {Object} recommendation - Recommendation object from getRecommendation
   */
  showRecommendationBanner(container, recommendation) {
    if (!container || !recommendation) return;

    const recommendedType = recommendation.recommended;
    const isRecommendedDeal = recommendedType === 'deal';
    
    container.innerHTML = `
      <div class="recommendation-banner ${isRecommendedDeal ? 'deal-recommended' : 'subscription-recommended'}">
        <div class="flex items-start gap-4">
          <div class="flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 ${isRecommendedDeal ? 'text-[#42A5F5]' : 'text-[#FF69B4]'}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-2">
              <span class="font-semibold text-[#FFFFFF]">
                Recommended: ${isRecommendedDeal ? 'Storage Deal' : 'Subscription'}
              </span>
              <span class="badge ${isRecommendedDeal ? 'bg-[#42A5F5]' : 'bg-[#FF69B4]'} text-white px-2 py-0.5 rounded text-xs">
                ${recommendation.recommended}
              </span>
            </div>
            <ul class="text-sm text-[#A0A0A0] space-y-1 mb-3">
              ${recommendation.reasons.map(reason => `<li>• ${reason}</li>`).join('')}
            </ul>
            ${recommendation.comparison && Object.keys(recommendation.comparison).length > 0 ? `
              <div class="mt-3 pt-3 border-t border-[#404040]">
                <p class="text-xs text-[#606060] mb-2">Cost Comparison:</p>
                <div class="grid grid-cols-2 gap-4 text-xs">
                  ${recommendation.comparison.subscription?.totalCostUSDC !== null ? `
                    <div>
                      <span class="text-[#A0A0A0]">Subscription:</span>
                      <span class="text-[#E0E0E0] ml-2">$${recommendation.comparison.subscription.totalCostUSDC?.toFixed(6) || 'N/A'}</span>
                    </div>
                  ` : ''}
                  <div>
                    <span class="text-[#A0A0A0]">Deal:</span>
                    <span class="text-[#E0E0E0] ml-2">$${recommendation.comparison.deal?.totalCostUSDC?.toFixed(6) || 'N/A'}</span>
                  </div>
                </div>
              </div>
            ` : ''}
            ${recommendation.alternatives && recommendation.alternatives.length > 0 ? `
              <div class="mt-3 pt-3 border-t border-[#404040]">
                <p class="text-xs text-[#606060] mb-2">Alternative:</p>
                <p class="text-xs text-[#A0A0A0]">${recommendation.alternatives[0].note}</p>
              </div>
            ` : ''}
          </div>
          <button class="flex-shrink-0 text-[#606060] hover:text-[#A0A0A0] transition-colors" onclick="this.parentElement.parentElement.remove()">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    `;

    container.style.display = 'block';
  }

  /**
   * Auto-suggest when file is selected
   * @param {File} file - Selected file
   * @param {number} durationDays - Proposed duration in days (default 30 for subscription, or from form)
   * @param {HTMLElement} container - Container to show recommendation
   */
  async suggestForFile(file, durationDays = 30, container = null) {
    if (!file) return null;

    const fileSizeMB = file.size / (1024 * 1024);
    
    try {
      const recommendation = await this.getRecommendation(
        fileSizeMB,
        durationDays,
        StorageState.connectedAddress
      );

      if (container) {
        this.showRecommendationBanner(container, recommendation);
      }

      return recommendation;
    } catch (error) {
      console.error('Auto-suggest for file failed:', error);
      return null;
    }
  }

  /**
   * Auto-suggest based on form inputs
   * @param {HTMLElement} form - Form element containing size and duration inputs
   * @param {HTMLElement} container - Container to show recommendation
   */
  async suggestFromForm(form, container = null) {
    if (!form) return null;

    const sizeMB = parseFloat(form.querySelector('[name="sizeMB"]')?.value || 0);
    const durationDays = parseInt(form.querySelector('[name="durationDays"]')?.value || 30);

    if (!sizeMB || sizeMB <= 0 || !durationDays || durationDays <= 0) {
      return null;
    }

    try {
      const recommendation = await this.getRecommendation(
        sizeMB,
        durationDays,
        StorageState.connectedAddress
      );

      if (container) {
        this.showRecommendationBanner(container, recommendation);
      }

      return recommendation;
    } catch (error) {
      console.error('Auto-suggest from form failed:', error);
      return null;
    }
  }

  /**
   * Get current recommendation
   */
  getCurrentRecommendation() {
    return this.currentRecommendation;
  }

  /**
   * Clear recommendation
   */
  clearRecommendation() {
    this.currentRecommendation = null;
  }
}

// Export singleton
export const autoSuggest = new AutoSuggest();

