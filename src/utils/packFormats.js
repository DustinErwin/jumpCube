export const PACK_FORMATS = {
  jumpstart: {
    id: "jumpstart",
    name: "Jump Pack",
    cardLimit: 20,
    singleton: false,
    commanderSlot: false,
  },
  commander: {
    id: "commander",
    name: "Commander Pack",
    cardLimit: 30,
    singleton: true,
    commanderSlot: true,
  },
};

export const DEFAULT_PACK_FORMAT_ID = PACK_FORMATS.jumpstart.id;
export const DEFAULT_PACK_CARD_LIMIT = PACK_FORMATS.jumpstart.cardLimit;
export const COMMANDER_PACK_CARD_LIMIT = PACK_FORMATS.commander.cardLimit;

export function getPackFormat(formatId) {
  return PACK_FORMATS[formatId] || PACK_FORMATS[DEFAULT_PACK_FORMAT_ID];
}

export function normalizePackCardLimit(value) {
  const numericValue = Number(value);

  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : DEFAULT_PACK_CARD_LIMIT;
}
