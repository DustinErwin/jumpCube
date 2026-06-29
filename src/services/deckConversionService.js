import {
  buildCommanderDeckPlan,
  buildConvertedDeckPlan,
  COMMANDER_PACK_CARD_COUNT,
  normalizeDeckCardName,
  parseArenaDeckList,
  parseMtgoDek,
} from "../utils/arenaDeckConversion";
import { getScryfallCardByName } from "./scryfallApi";
import { normalizeScryfallCard } from "./scryfallCardModel";
import { normalizePackCardLimit } from "../utils/packFormats";

function normalizeSearchCard(card, quantity) {
  return {
    ...card,
    card_search_id: card.scryfall_id,
    id: card.scryfall_id,
    variant_id: card.scryfall_id,
    variation_id: card.scryfall_id,
    is_default_printing: true,
    quantity,
  };
}

function normalizeRemovedPlanEntry(entry) {
  return {
    ...normalizeSearchCard(entry.card, entry.quantity),
    removalReason: entry.reason || "Removed",
    sourceQuantity: entry.sourceQuantity || entry.quantity,
  };
}

function normalizeRolePlanEntry(entry) {
  return {
    ...normalizeSearchCard(entry.card, entry.quantity),
    importRole: entry.role || null,
  };
}

async function resolveDeckCardByName(name) {
  try {
    return normalizeScryfallCard(await getScryfallCardByName(name));
  } catch {
    try {
      return normalizeScryfallCard(
        await getScryfallCardByName(name, { fuzzy: true }),
      );
    } catch {
      return null;
    }
  }
}

async function loadCardsByDeckEntries(parsedEntries) {
  const cardsByNormalizedName = new Map();

  await Promise.all(
    parsedEntries.map(async (entry) => {
      if (cardsByNormalizedName.has(entry.normalizedName)) return;

      const card = await resolveDeckCardByName(entry.name);

      if (card) {
        cardsByNormalizedName.set(entry.normalizedName, card);
      }
    }),
  );

  return cardsByNormalizedName;
}

async function loadCardsByNames(names) {
  const cardsByNormalizedName = new Map();

  await Promise.all(
    [...new Set(names || [])].map(async (name) => {
      const card = await resolveDeckCardByName(name);

      if (card) {
        cardsByNormalizedName.set(normalizeDeckCardName(name), card);
      }
    }),
  );

  return cardsByNormalizedName;
}

async function convertDeckEntriesToPack(parsedEntries, packCardLimit) {
  if (parsedEntries.length === 0) {
    throw new Error("No main-deck card entries were found.");
  }

  const normalizedPackCardLimit = normalizePackCardLimit(packCardLimit);
  const parsedCardCount = parsedEntries.reduce(
    (sum, entry) => sum + entry.quantity,
    0,
  );
  const cardsByNormalizedName = await loadCardsByDeckEntries(parsedEntries);

  if (parsedCardCount <= normalizedPackCardLimit) {
    const missingNames = [];
    const cards = parsedEntries
      .map((entry) => {
        const card = cardsByNormalizedName.get(entry.normalizedName);

        if (!card) {
          missingNames.push(entry.name);
          return null;
        }

        return normalizeSearchCard(card, entry.quantity);
      })
      .filter(Boolean);

    if (cards.length === 0) {
      throw new Error("No supported cards were found in the main deck.");
    }

    return {
      mode: "direct",
      cards,
      parsedCardCount,
      packCardCount: cards.reduce(
        (sum, card) => sum + card.quantity,
        0,
      ),
      missingNames,
      importedLandNames: [],
      trimmedCount: 0,
      basicLands: [],
      nonlands: [],
      removedCards: [],
    };
  }

  const plan = buildConvertedDeckPlan(
    parsedEntries,
    cardsByNormalizedName,
    normalizedPackCardLimit,
  );
  const basicCardsByNormalizedName = await loadCardsByNames(
    plan.basicLands.map((land) => land.name),
  );
  const cards = [
    ...plan.nonlands.map((entry) =>
      normalizeSearchCard(entry.card, entry.quantity),
    ),
    ...plan.basicLands
      .map((land) => {
        const card = basicCardsByNormalizedName.get(
          normalizeDeckCardName(land.name),
        );

        return card ? normalizeSearchCard(card, land.quantity) : null;
      })
      .filter(Boolean),
  ];

  if (plan.nonlands.length === 0) {
    throw new Error("No supported nonland cards were found in the main deck.");
  }

  return {
    ...plan,
    mode: "converted",
    cards,
    removedCards: [
      ...(plan.importedLands || []).map(normalizeRemovedPlanEntry),
      ...(plan.trimmedCards || []).map(normalizeRemovedPlanEntry),
    ],
    parsedCardCount,
    packCardCount: cards.reduce((sum, card) => sum + card.quantity, 0),
  };
}

async function convertCommanderDeckEntriesToPack(parsedEntries) {
  if (parsedEntries.length === 0) {
    throw new Error("No main-deck card entries were found.");
  }

  const parsedCardCount = parsedEntries.reduce(
    (sum, entry) => sum + entry.quantity,
    0,
  );
  const cardsByNormalizedName = await loadCardsByDeckEntries(parsedEntries);
  const plan = buildCommanderDeckPlan(parsedEntries, cardsByNormalizedName);
  const basicCardsByNormalizedName = await loadCardsByNames(
    plan.basicLands.map((land) => land.name),
  );
  const cards = [
    ...plan.nonlands.map(normalizeRolePlanEntry),
    ...plan.basicLands
      .map((land) => {
        const card = basicCardsByNormalizedName.get(
          normalizeDeckCardName(land.name),
        );

        return card ? normalizeSearchCard(card, land.quantity) : null;
      })
      .filter(Boolean),
  ];
  const packCardCount = cards.reduce((sum, card) => sum + card.quantity, 0);

  if (packCardCount !== COMMANDER_PACK_CARD_COUNT) {
    throw new Error(
      `Commander import produced ${packCardCount} cards instead of ${COMMANDER_PACK_CARD_COUNT}. Check that the required basic lands exist in card search.`,
    );
  }

  return {
    ...plan,
    mode: "commander",
    cards,
    commanderCardId: plan.commander.scryfall_id,
    commanderName: plan.commander.name,
    removedCards: [
      ...(plan.importedLands || []).map(normalizeRemovedPlanEntry),
      ...(plan.trimmedCards || []).map(normalizeRemovedPlanEntry),
    ],
    parsedCardCount,
    packCardCount,
  };
}

export async function convertArenaDeckToPack(deckText, packCardLimit) {
  return convertDeckEntriesToPack(parseArenaDeckList(deckText), packCardLimit);
}

export async function convertMtgoDekToPack(deckXml, packCardLimit) {
  return convertDeckEntriesToPack(parseMtgoDek(deckXml), packCardLimit);
}

export async function convertArenaCommanderDeckToPack(deckText) {
  return convertCommanderDeckEntriesToPack(parseArenaDeckList(deckText));
}

export async function convertMtgoCommanderDeckToPack(deckXml) {
  return convertCommanderDeckEntriesToPack(parseMtgoDek(deckXml));
}
