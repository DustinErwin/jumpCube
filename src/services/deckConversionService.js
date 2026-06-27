import { supabase } from "../utils/supabase";
import {
  buildCommanderDeckPlan,
  buildConvertedDeckPlan,
  COMMANDER_PACK_CARD_COUNT,
  normalizeDeckCardName,
  parseArenaDeckList,
  parseMtgoDek,
} from "../utils/arenaDeckConversion";
import { normalizePackCardLimit } from "../utils/packFormats";

const CONVERSION_CARD_COLUMNS = `
  id,
  oracle_id,
  representative_scryfall_id,
  default_variant_id,
  default_variant_scryfall_id,
  name,
  normalized_name,
  mana_value,
  edhrec_rank,
  colors,
  color_identity,
  type_line,
  oracle_text,
  rarity,
  image_url,
  back_image_url,
  legalities,
  price_usd,
  price_usd_foil,
  price_usd_etched,
  games,
  nonfoil,
  is_token,
  is_funny,
  is_variant_printing,
  is_planechase,
  set_name,
  set_code,
  collector_number,
  released_at,
  has_back_face,
  mana_cost,
  image_uris,
  card_faces
`;
const QUERY_BATCH_SIZE = 50;

function normalizeSearchCard(card, quantity) {
  return {
    ...card,
    card_search_id: card.id,
    id: card.default_variant_id,
    variant_id: card.default_variant_id,
    scryfall_id:
      card.default_variant_scryfall_id || card.representative_scryfall_id,
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

async function loadCardsByNormalizedName(normalizedNames) {
  const cards = [];

  for (
    let index = 0;
    index < normalizedNames.length;
    index += QUERY_BATCH_SIZE
  ) {
    const { data, error } = await supabase
      .from("card_search")
      .select(CONVERSION_CARD_COLUMNS)
      .in(
        "normalized_name",
        normalizedNames.slice(index, index + QUERY_BATCH_SIZE),
      )
      .eq("is_legal", true)
      .not("default_variant_id", "is", null);

    if (error) throw error;

    cards.push(...(data || []));
  }

  return new Map(
    cards.map((card) => [normalizeDeckCardName(card.name), card]),
  );
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
  const cardsByNormalizedName = await loadCardsByNormalizedName(
    parsedEntries.map((entry) => entry.normalizedName),
  );

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
  const basicCardsByNormalizedName = await loadCardsByNormalizedName(
    plan.basicLands.map((land) => normalizeDeckCardName(land.name)),
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
  const cardsByNormalizedName = await loadCardsByNormalizedName(
    parsedEntries.map((entry) => entry.normalizedName),
  );
  const plan = buildCommanderDeckPlan(parsedEntries, cardsByNormalizedName);
  const basicCardsByNormalizedName = await loadCardsByNormalizedName(
    plan.basicLands.map((land) => normalizeDeckCardName(land.name)),
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
    commanderCardId: plan.commander.default_variant_id,
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
