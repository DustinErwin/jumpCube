/*
 * Legacy in-memory card filtering helper.
 *
 * The current app mostly uses useCards() to query Supabase/Scryfall directly.
 * Keep this file around for tests or future offline filtering. If the active UI
 * search behavior changes, update useCards() first, then mirror compatible
 * behavior here only if a caller imports filterCards().
 */

const DEFAULT_SEARCH_SCOPES = {
  title: true,
  type: true,
  text: true,
};

const SEARCH_SCOPE_FIELDS = {
  title: "name",
  type: "type_line",
  text: "oracle_text",
};

function hasAnyLegalFormat(card) {
  return Object.values(card.legalities || {}).some(
    (legality) => legality === "legal",
  );
}

export function filterCards({
  cards,
  search,
  searchScopes = DEFAULT_SEARCH_SCOPES,
  manaValues,
  colors,
  colorMode,
  rarities,
  types,
  formats,
}) {
  /*
   * Arguments:
   * {
   *   cards: Array<card row>,
   *   search: string,
   *   searchScopes: { title: boolean, type: boolean, text: boolean },
   *   manaValues/colors/rarities/types/formats: string arrays,
   *   colorMode: "or" | "and" | "only"
   * }
   */
  const query = search.toLowerCase().trim();

  if (
    query === "" &&
    manaValues.length === 0 &&
    colors.length === 0 &&
    rarities.length === 0 &&
    types.length === 0 &&
    formats.length === 0
  ) {
    return [];
  }

  return cards
    .filter((card) => {
      return (
        hasAnyLegalFormat(card) &&
        matchesSearch(card, query, searchScopes) &&
        matchesManaValue(card, manaValues) &&
        matchesColor(card, colors, colorMode) &&
        matchesRarity(card, rarities) &&
        matchesType(card, types) &&
        matchesFormat(card, formats)
      );
    })
    .slice(0, 200);
}

function matchesFormat(card, formats) {
  // legalities is Scryfall's format map, e.g. { standard: "legal" }.
  if (formats.length === 0) return true;

  return formats.some((format) => {
    const key = format.toLowerCase();
    return card.legalities?.[key] === "legal";
  });
}

function matchesRarity(card, rarities) {
  if (rarities.length === 0) return true;

  return rarities.includes(card.rarity);
}

function matchesSearch(card, query, searchScopes) {
  // Case-insensitive substring match across the same fields as the card grid.
  if (query === "") return true;

  const activeFields = Object.entries(SEARCH_SCOPE_FIELDS)
    .filter(([scope]) => searchScopes[scope])
    .map(([, field]) => field);

  if (activeFields.length === 0) return false;

  return activeFields.some((field) =>
    String(card[field] || "").toLowerCase().includes(query),
  );
}

function matchesType(card, types) {
  if (types.length === 0) return true;

  const typeLine = card.type_line?.toLowerCase() || "";

  return types.every((type) => typeLine.includes(type.toLowerCase()));
}

function matchesManaValue(card, manaValues) {
  // UI value "7" represents "7+".
  if (manaValues.length === 0) return true;

  return manaValues.some((mv) =>
    mv === "7"
      ? Number(card.mana_value) >= 7
      : Number(card.mana_value) === Number(mv),
  );
}

function matchesColor(card, colors, colorMode) {
  // This helper uses card.colors, not color_identity. useCards() uses
  // color_identity because that is what the main UI filters by.
  if (colors.length === 0) return true;

  const cardColors = card.colors || [];
  const selectedColors = colors.filter((color) => color !== "C");

  if (colors.includes("C")) {
    if (colorMode === "only" && selectedColors.length > 0) {
      return false;
    }

    if (colorMode === "and") {
      return cardColors.every((color) => selectedColors.includes(color));
    }

    return (
      cardColors.length === 0 ||
      selectedColors.some((color) => cardColors.includes(color))
    );
  }

  if (colorMode === "only") {
    return (
      cardColors.length === selectedColors.length &&
      selectedColors.every((color) => cardColors.includes(color))
    );
  }

  if (colorMode === "and") {
    return (
      cardColors.length > 0 &&
      cardColors.every((color) => selectedColors.includes(color))
    );
  }

  return selectedColors.some((color) => cardColors.includes(color));
}
