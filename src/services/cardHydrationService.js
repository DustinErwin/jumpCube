import {
  getScryfallCardByName,
  getScryfallCardCollection,
} from "./scryfallApi";
import { normalizeScryfallCard } from "./scryfallCardModel";

function getIdentifiersFromRow(row) {
  const identifiers = [];
  const scryfallId = row.variation_id || row.scryfall_id || null;

  if (scryfallId) identifiers.push({ id: scryfallId });
  if (row.oracle_id) identifiers.push({ oracle_id: row.oracle_id });
  if (row.name) identifiers.push({ name: row.name });

  return identifiers;
}

function getHydratedCardKey(card) {
  return card.scryfall_id || card.id || card.oracle_id || card.name;
}

export async function hydrateSavedCardRows(rows, {
  includeManualMechanicBucket = false,
} = {}) {
  const identifiers = (rows || []).flatMap(getIdentifiersFromRow);

  if (identifiers.length === 0) {
    return [];
  }

  const { cards } = await getScryfallCardCollection(identifiers);
  const hydratedByScryfallId = new Map(
    cards.map((card) => [card.id, normalizeScryfallCard(card)]),
  );
  const hydratedByOracleId = new Map(
    cards
      .filter((card) => card.oracle_id)
      .map((card) => [card.oracle_id, normalizeScryfallCard(card)]),
  );

  return (rows || [])
    .map((row) => {
      const normalizedCard =
        hydratedByScryfallId.get(row.variation_id || row.scryfall_id) ||
        hydratedByOracleId.get(row.oracle_id);

      if (!normalizedCard) return null;

      return {
        ...normalizedCard,
        quantity: row.quantity,
        card_search_id: normalizedCard.scryfall_id,
        variant_id: normalizedCard.scryfall_id,
        variation_id: normalizedCard.scryfall_id,
        manualMechanicBucket: includeManualMechanicBucket
          ? row.manual_mechanic_bucket || null
          : undefined,
      };
    })
    .filter(Boolean);
}

export async function loadCardsByNames(names) {
  const cards = await Promise.all(
    [...new Set((names || []).filter(Boolean))].map(async (name) => {
      try {
        return await getScryfallCardByName(name, { fuzzy: false });
      } catch {
        try {
          return await getScryfallCardByName(name, { fuzzy: true });
        } catch {
          return null;
        }
      }
    }),
  );

  return new Map(
    cards
      .filter(Boolean)
      .map((card) => {
        const normalizedCard = normalizeScryfallCard(card);

        return [card.name.toLowerCase(), normalizedCard];
      }),
  );
}

export function getCardHydrationKey(card) {
  return getHydratedCardKey(card);
}
