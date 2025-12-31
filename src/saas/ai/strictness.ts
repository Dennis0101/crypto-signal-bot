import type { Tier } from '../tier/tier.js';

export function confidenceThresholdForTier(tier: Tier): number {
  // Higher threshold => stricter => fewer trades (more avoidance)
  switch (tier) {
    case 'BASIC':
      return 90;
    case 'PRO':
      return 82;
    case 'VIP':
      return 74;
    default:
      return 90;
  }
}

