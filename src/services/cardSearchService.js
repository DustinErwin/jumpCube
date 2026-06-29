import { searchScryfallCards } from "./scryfallApi";
import { normalizeScryfallCards } from "./scryfallCardModel";

const COLOR_ORDER = ["W", "U", "B", "R", "G"];
const SCRYFALL_SYNTAX_PATTERN =
  /(?:^|[\s(])-?[a-z][a-z0-9_]*(?::|[<>=])/i;

function quoteScryfallValue(value) {
  return `"${String(value || "").replaceAll('"', '\\"')}"`;
}

function sortColors(colors) {
  return COLOR_ORDER.filter((color) => colors.includes(color));
}

function getSearchScopeQuery(search, searchScopes = {}) {
  const trimmedSearch = search.trim();

  if (!trimmedSearch) return "";
  if (SCRYFALL_SYNTAX_PATTERN.test(trimmedSearch)) return trimmedSearch;

  const scopes = Object.entries({
    title: "name",
    type: "type",
    text: "oracle",
  }).filter(([scope]) => searchScopes[scope] !== false);

  if (scopes.length === 0) return "!" + quoteScryfallValue("__NO_MATCH__");
  if (scopes.length === 3) return trimmedSearch;

  return `(${scopes
    .map(([, operator]) => `${operator}:${quoteScryfallValue(trimmedSearch)}`)
    .join(" or ")})`;
}

function getFilterQuery({
  manaValues = [],
  colors = [],
  colorMode = "or",
  rarities = [],
  types = [],
  formats = [],
  selectedSets = [],
} = {}) {
  const filters = [
    "game:paper",
    "-is:extra",
    "-is:funny",
    "-is:token",
    "-t:plane",
    "-t:scheme",
  ];

  if (manaValues.length > 0) {
    const manaFilters = manaValues.map((manaValue) =>
      manaValue === "7" ? "mv>=7" : `mv=${manaValue}`,
    );

    filters.push(`(${manaFilters.join(" or ")})`);
  }

  if (colors.length > 0) {
    const selectedColors = sortColors(colors.filter((color) => color !== "C"));
    const includesColorless = colors.includes("C");
    const colorString = selectedColors.join("");

    if (includesColorless && selectedColors.length === 0) {
      filters.push("id:c");
    } else if (colorMode === "only") {
      filters.push(
        includesColorless
          ? "!" + quoteScryfallValue("__NO_MATCH__")
          : `id=${colorString}`,
      );
    } else if (colorMode === "and") {
      filters.push(`id<=${colorString}`);
      selectedColors.forEach((color) => filters.push(`id>=${color}`));
    } else {
      const colorFilters = selectedColors.map((color) => `id>=${color}`);

      if (includesColorless) colorFilters.push("id:c");
      filters.push(`(${colorFilters.join(" or ")})`);
    }
  }

  if (rarities.length > 0) {
    const rarityFilters = rarities.map(
      (rarity) => `rarity:${rarity.toLowerCase()}`,
    );

    filters.push(`(${rarityFilters.join(" or ")})`);
  }

  types.forEach((type) => filters.push(`type:${quoteScryfallValue(type)}`));

  if (formats.length > 0) {
    const formatFilters = formats.map(
      (format) => `format:${format.toLowerCase()}`,
    );

    filters.push(`(${formatFilters.join(" or ")})`);
  }

  if (selectedSets.length > 0) {
    const setFilters = selectedSets.map(
      (setCode) => `set:${setCode.toLowerCase()}`,
    );

    filters.push(`(${setFilters.join(" or ")})`);
  }

  return filters.join(" ");
}

export async function searchCardsWithScryfall({
  search = "",
  searchScopes = {},
  manaValues = [],
  colors = [],
  colorMode = "or",
  rarities = [],
  types = [],
  formats = [],
  selectedSets = [],
  pageUrl = "",
} = {}) {
  const query = [
    getSearchScopeQuery(search, searchScopes),
    getFilterQuery({
      manaValues,
      colors,
      colorMode,
      rarities,
      types,
      formats,
      selectedSets,
    }),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  let payload;

  try {
    payload = await searchScryfallCards(query || "game:paper", {
      pageUrl,
      unique: "cards",
      order: "name",
    });
  } catch (error) {
    if (error.status === 404) {
      return {
        cards: [],
        hasMore: false,
        nextPage: "",
        warnings: [],
      };
    }

    throw error;
  }

  return {
    cards: normalizeScryfallCards(payload.data || []),
    hasMore: Boolean(payload.has_more && payload.next_page),
    nextPage: payload.next_page || "",
    warnings: payload.warnings || [],
  };
}
