export const DEFAULT_PACK_CARD_LIMIT = 20;

export function normalizePackCardLimit(value) {
  const numericValue = Number(value);

  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : DEFAULT_PACK_CARD_LIMIT;
}
