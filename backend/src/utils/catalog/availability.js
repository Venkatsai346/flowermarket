import { AVAILABILITY_STATUS } from '../../constants/enums.js';

/**
 * Stock-based availability derivation shared by inventory & listing services.
 */
export const LOW_STOCK_THRESHOLD = 10;

export function deriveAvailability(qty) {
  const n = Number(qty) || 0;
  if (n <= 0) return AVAILABILITY_STATUS.OUT_OF_STOCK;
  if (n <= LOW_STOCK_THRESHOLD) return AVAILABILITY_STATUS.LOW_STOCK;
  return AVAILABILITY_STATUS.IN_STOCK;
}

export default deriveAvailability;
