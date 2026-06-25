import {
  DEFAULT_PACK_CARD_LIMIT,
  normalizePackCardLimit,
} from "./packFormats";

const LAND_SHARE = 0.4;
const BASIC_LAND_BY_COLOR = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
  C: "Wastes",
};
const COLOR_ORDER = ["W", "U", "B", "R", "G"];

export function normalizeDeckCardName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9{}+/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseArenaDeckList(deckText) {
  const entriesByName = new Map();
  let isSideboard = false;

  String(deckText || "")
    .split(/\r?\n/)
    .forEach((rawLine) => {
      const line = rawLine.trim();

      if (!line || /^deck$/i.test(line)) return;
      if (/^sideboard$/i.test(line)) {
        isSideboard = true;
        return;
      }
      if (isSideboard) return;

      const match = line.match(/^(\d+)\s+(.+)$/);

      if (!match) return;

      const quantity = Number(match[1]);
      const name = match[2]
        .replace(/\s+\([A-Z0-9]+\)\s+\S+\s*$/i, "")
        .trim();
      const normalizedName = normalizeDeckCardName(name);

      if (!quantity || !normalizedName) return;

      const existing = entriesByName.get(normalizedName);

      entriesByName.set(normalizedName, {
        name: existing?.name || name,
        normalizedName,
        quantity: (existing?.quantity || 0) + quantity,
      });
    });

  return [...entriesByName.values()];
}

function isLand(card) {
  return /\bland\b/i.test(card.type_line || "");
}

function getManaValue(card) {
  const manaValue = Number(card.mana_value);

  return Number.isFinite(manaValue) ? manaValue : 0;
}

function trimConvertedNonlands(convertedEntries, targetNonlandCount) {
  const entries = convertedEntries.map((entry) => ({ ...entry }));
  let total = entries.reduce((sum, entry) => sum + entry.quantity, 0);

  const duplicateCandidates = [...entries].sort(
    (entryA, entryB) =>
      getManaValue(entryB.card) - getManaValue(entryA.card) ||
      entryA.sourceQuantity - entryB.sourceQuantity ||
      entryA.card.name.localeCompare(entryB.card.name),
  );

  while (total > targetNonlandCount) {
    const duplicate = duplicateCandidates.find((entry) => entry.quantity > 1);

    if (!duplicate) break;

    duplicate.quantity -= 1;
    total -= 1;
  }

  if (total > targetNonlandCount) {
    const removalOrder = [...entries].sort(
      (entryA, entryB) =>
        entryA.sourceQuantity - entryB.sourceQuantity ||
        getManaValue(entryB.card) - getManaValue(entryA.card) ||
        entryA.card.name.localeCompare(entryB.card.name),
    );

    removalOrder.forEach((entry) => {
      if (total <= targetNonlandCount || entry.quantity === 0) return;

      total -= entry.quantity;
      entry.quantity = 0;
    });
  }

  return entries.filter((entry) => entry.quantity > 0);
}

function getCardManaCosts(card) {
  const faceCosts = (card.card_faces || [])
    .map((face) => face.mana_cost)
    .filter(Boolean);

  return [card.mana_cost, ...faceCosts].filter(Boolean).join("");
}

function getColorWeights(cards) {
  const weights = Object.fromEntries(COLOR_ORDER.map((color) => [color, 0]));

  cards.forEach(({ card, quantity }) => {
    const symbols = getCardManaCosts(card).match(/\{[^}]+\}/g) || [];

    symbols.forEach((symbol) => {
      const symbolColors = COLOR_ORDER.filter((color) =>
        symbol.toUpperCase().includes(color),
      );

      symbolColors.forEach((color) => {
        weights[color] += quantity / symbolColors.length;
      });
    });
  });

  if (Object.values(weights).some((weight) => weight > 0)) {
    return weights;
  }

  cards.forEach(({ card, quantity }) => {
    const identity = COLOR_ORDER.filter((color) =>
      (card.color_identity || []).includes(color),
    );

    identity.forEach((color) => {
      weights[color] += quantity / identity.length;
    });
  });

  return weights;
}

export function allocateBasicLands(convertedNonlands, targetLandCount) {
  const weights = getColorWeights(convertedNonlands);
  const activeColors = COLOR_ORDER.filter((color) => weights[color] > 0)
    .sort(
      (colorA, colorB) =>
        weights[colorB] - weights[colorA] ||
        COLOR_ORDER.indexOf(colorA) - COLOR_ORDER.indexOf(colorB),
    )
    .slice(0, targetLandCount);

  if (activeColors.length === 0) {
    return [{ name: BASIC_LAND_BY_COLOR.C, quantity: targetLandCount }];
  }

  const totalWeight = activeColors.reduce(
    (sum, color) => sum + weights[color],
    0,
  );
  const allocations = activeColors.map((color) => {
    const exactQuantity = (weights[color] / totalWeight) * targetLandCount;

    return {
      color,
      exactQuantity,
      quantity: Math.max(1, Math.floor(exactQuantity)),
    };
  });
  let allocated = allocations.reduce(
    (sum, allocation) => sum + allocation.quantity,
    0,
  );

  while (allocated < targetLandCount) {
    const nextAllocation = [...allocations].sort(
      (allocationA, allocationB) =>
        allocationB.exactQuantity -
          allocationB.quantity -
          (allocationA.exactQuantity - allocationA.quantity) ||
        COLOR_ORDER.indexOf(allocationA.color) -
          COLOR_ORDER.indexOf(allocationB.color),
    )[0];

    nextAllocation.quantity += 1;
    allocated += 1;
  }

  while (allocated > targetLandCount) {
    const nextAllocation = [...allocations]
      .filter((allocation) => allocation.quantity > 1)
      .sort(
        (allocationA, allocationB) =>
          allocationA.exactQuantity -
            allocationA.quantity -
            (allocationB.exactQuantity - allocationB.quantity),
      )[0];

    if (!nextAllocation) break;

    nextAllocation.quantity -= 1;
    allocated -= 1;
  }

  return allocations
    .sort(
      (allocationA, allocationB) =>
        COLOR_ORDER.indexOf(allocationA.color) -
        COLOR_ORDER.indexOf(allocationB.color),
    )
    .map((allocation) => ({
    name: BASIC_LAND_BY_COLOR[allocation.color],
    quantity: allocation.quantity,
    }));
}

export function getDeckConversionTargets(
  packCardLimit = DEFAULT_PACK_CARD_LIMIT,
) {
  const normalizedLimit = normalizePackCardLimit(packCardLimit);
  const lands = Math.max(1, Math.round(normalizedLimit * LAND_SHARE));

  return {
    lands,
    nonlands: normalizedLimit - lands,
  };
}

export function buildConvertedDeckPlan(
  parsedEntries,
  cardsByNormalizedName,
  packCardLimit = DEFAULT_PACK_CARD_LIMIT,
) {
  const targets = getDeckConversionTargets(packCardLimit);
  const missingNames = [];
  const importedLandNames = [];
  const convertedEntries = [];

  parsedEntries.forEach((entry) => {
    const card = cardsByNormalizedName.get(entry.normalizedName);

    if (!card) {
      missingNames.push(entry.name);
      return;
    }

    if (isLand(card)) {
      importedLandNames.push(card.name);
      return;
    }

    convertedEntries.push({
      card,
      sourceQuantity: entry.quantity,
      quantity: Math.ceil(entry.quantity * 0.3),
    });
  });

  const retainedBeforeTrim = convertedEntries.reduce(
    (sum, entry) => sum + entry.quantity,
    0,
  );
  const nonlands = trimConvertedNonlands(
    convertedEntries,
    targets.nonlands,
  );

  return {
    nonlands,
    basicLands: allocateBasicLands(nonlands, targets.lands),
    missingNames,
    importedLandNames,
    trimmedCount:
      retainedBeforeTrim -
      nonlands.reduce((sum, entry) => sum + entry.quantity, 0),
  };
}

export const DECK_CONVERSION_TARGETS = getDeckConversionTargets();
