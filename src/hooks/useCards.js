import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../utils/supabase";

/*
 * useCards() owns the card search experience.
 *
 * Arguments:
 * {
 *   search: committed search string from SearchBox,
 *   manaValues/colors/rarities/types/formats/selectedSets: filter arrays,
 *   colorMode: "or" | "and" | "only",
 *   limit: page size for local Supabase pagination
 * }
 *
 * Returns:
 * { cardList, loadingCards, loadingMoreCards, cardsError,
 *   hasMoreCards, loadMoreCards }
 *
 * Search strategy:
 * - Normal text and UI filters use Supabase so indexed local fields stay
 *   authoritative.
 * - Scryfall syntax like "o:draw t:bird" is passed through raw, then hydrated
 *   from card_search.
 */

const CARD_COLUMNS = `
  id,
  oracle_id,
  representative_scryfall_id,
  default_variant_id,
  default_variant_scryfall_id,
  name,
  mana_value,
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
const TEXT_SEARCH_CANDIDATE_LIMIT = 700;
const SCRYFALL_SEARCH_PAGE_LIMIT = 5;
const EXACT_NAME_BATCH_SIZE = 50;
const CARD_SEARCH_ID_BATCH_SIZE = 50;
// Detects Scryfall syntax operators. Add aliases here only if the official
// syntax introduces a new operator shape not covered by key:value/key>=value.
const SCRYFALL_SYNTAX_PATTERN =
  /(?:^|[\s(])-?[a-z][a-z0-9_]*(?::|[<>=])/i;
const PLAYABLE_CARD_TYPES = [
  "Artifact",
  "Battle",
  "Creature",
  "Enchantment",
  "Instant",
  "Kindred",
  "Land",
  "Planeswalker",
  "Sorcery",
  "Tribal",
];
const NORMALIZED_PLAYABLE_CARD_TYPE_FILTER = PLAYABLE_CARD_TYPES
  .map((type) => `normalized_type_line.like.%${type.toLowerCase()}%`)
  .join(",");
const COLOR_IDENTITY_ORDER = ["W", "U", "B", "R", "G"];
const SEARCH_SCOPE_COLUMNS = {
  title: {
    defaultColumn: "name",
  },
  type: {
    defaultColumn: "normalized_type_line",
    normalizeSearch: true,
  },
  text: {
    defaultColumn: "oracle_text",
  },
};
const DEFAULT_SEARCH_SCOPES = {
  title: true,
  type: true,
  text: true,
};
function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function sortColorIdentity(colors) {
  return COLOR_IDENTITY_ORDER.filter((color) => colors.includes(color));
}

function getActiveSearchScopes(searchScopes = DEFAULT_SEARCH_SCOPES) {
  return Object.entries(SEARCH_SCOPE_COLUMNS)
    .filter(([scope]) => searchScopes[scope])
    .map(([scope, columns]) => ({
      scope,
      column: columns.defaultColumn,
      normalizeSearch: columns.normalizeSearch,
    }));
}

function usesAllSearchScopes(searchScopes = DEFAULT_SEARCH_SCOPES) {
  return getActiveSearchScopes(searchScopes).length ===
    Object.keys(SEARCH_SCOPE_COLUMNS).length;
}

function getScopedSearchFilter(alias, searchScopes) {
  const activeScopes = getActiveSearchScopes(searchScopes);

  if (activeScopes.length === 0) {
    return "name.eq.__NO_SEARCH_SCOPE_SELECTED__";
  }

  return activeScopes
    .map(({ column, normalizeSearch }) => {
      const pattern = normalizeSearch ? normalizeSearchText(alias) : alias;
      const operator = normalizeSearch ? "like" : "ilike";

      return `${column}.${operator}.%${pattern}%`;
    })
    .join(",");
}

function getBroadSearchFilter(alias) {
  const normalizedAlias = normalizeSearchText(alias);
  const scopedFilters = getScopedSearchFilter(alias, DEFAULT_SEARCH_SCOPES);

  return `search_text.ilike.%${normalizedAlias}%,${scopedFilters}`;
}

function getPlainSearchTerms(search) {
  /*
   * Plain search rules:
   * - unquoted words are separate required terms: draw bird
   * - quoted text remains one required phrase: "draw a card"
   * - all matching stays case-insensitive through ilike/Scryfall
   */
  const terms = [];
  let currentTerm = "";
  let isInQuote = false;

  [...search].forEach((character) => {
    if (character === '"') {
      if (isInQuote && currentTerm.trim()) {
        terms.push(currentTerm.trim());
        currentTerm = "";
      }

      isInQuote = !isInQuote;
      return;
    }

    if (!isInQuote && /\s/.test(character)) {
      if (currentTerm.trim()) {
        terms.push(currentTerm.trim());
        currentTerm = "";
      }

      return;
    }

    currentTerm += character;
  });

  if (currentTerm.trim()) {
    terms.push(currentTerm.trim());
  }

  const normalizedTerms = terms
    .map((term) => term.replaceAll(",", " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (normalizedTerms.join(" ").toLowerCase() === "enters the battlefield") {
    return ["enters the battlefield"];
  }

  return normalizedTerms;
}

function getSearchTermAliases(term) {
  /*
   * Scryfall uses current Oracle wording. Older/common player phrasing can
   * differ from current templates, so keep game-terminology aliases here.
   */
  const normalizedTerm = term.toLowerCase();

  if (normalizedTerm === "enters the battlefield") {
    // Modern Oracle text uses "enters" instead of the older full phrase.
    // Searching only the current template avoids an extra OR branch on a hot
    // path while still matching the cards players expect from ETB searches.
    return ["enters"];
  }

  return [normalizedTerm];
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9{}+/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function usesScryfallSyntax(search) {
  return SCRYFALL_SYNTAX_PATTERN.test(search);
}

async function getScryfallSearchCards(query) {
  // Returns Scryfall card objects. We hydrate from Supabase afterward so
  // added-to-pack cards use our database ids, prices, and normalized fields.
  const params = new URLSearchParams({
    q: query,
    unique: "cards",
    order: "name",
    include_extras: "false",
  });

  let nextPage = `https://api.scryfall.com/cards/search?${params}`;
  const cards = [];

  try {
    for (
      let pageCount = 0;
      nextPage && pageCount < SCRYFALL_SEARCH_PAGE_LIMIT;
      pageCount += 1
    ) {
      const response = await fetch(nextPage);

      if (!response.ok) {
        const payload = await response.json().catch(() => null);

        throw new Error(
          payload?.details ||
            payload?.message ||
            `Scryfall search failed for: ${query}`,
        );
      }

      const payload = await response.json();

      cards.push(...(payload.data || []));
      nextPage = payload.has_more ? payload.next_page : null;
    }
  } catch {
    return cards;
  }

  return cards.slice(0, TEXT_SEARCH_CANDIDATE_LIMIT);
}

function sortCardsByName(cards) {
  return [...cards].sort((a, b) => a.name.localeCompare(b.name));
}

function getCardImageUrl(card) {
  return (
    card.image_url ||
    card.image_uris?.normal ||
    card.image_uris?.small ||
    card.card_faces?.[0]?.image_uris?.normal ||
    card.card_faces?.[0]?.image_uris?.small ||
    card.card_faces?.[0]?.small?.normal ||
    card.card_faces?.[0]?.small?.small ||
    null
  );
}

function getCardUniqueKey(card) {
  return String(card.oracle_id || card.name || card.scryfall_id || card.id);
}

function getCollectorNumberParts(card) {
  const collectorNumber = String(card.collector_number || "");
  const numberMatch = collectorNumber.match(/\d+/);
  const numericPart = numberMatch ? Number(numberMatch[0]) : Number.MAX_SAFE_INTEGER;

  return {
    numericPart,
    textPart: collectorNumber.toLowerCase(),
  };
}

function compareCollectorNumbers(cardA, cardB) {
  const collectorA = getCollectorNumberParts(cardA);
  const collectorB = getCollectorNumberParts(cardB);

  if (collectorA.numericPart !== collectorB.numericPart) {
    return collectorA.numericPart - collectorB.numericPart;
  }

  return collectorA.textPart.localeCompare(collectorB.textPart);
}

function shouldReplaceCardVersion(currentCard, candidateCard) {
  /*
   * If multiple rows represent the same oracle card, choose the version shown:
   * 1. prefer an image,
   * 2. prefer lowest collector number within the same set,
   * 3. prefer non-variant/default printings,
   * 4. fall back to stable name ordering.
   */
  if (!getCardImageUrl(currentCard) && getCardImageUrl(candidateCard)) {
    return true;
  }

  if (currentCard.set_code === candidateCard.set_code) {
    const collectorComparison = compareCollectorNumbers(
      candidateCard,
      currentCard,
    );

    if (collectorComparison !== 0) {
      return collectorComparison < 0;
    }
  }

  if (currentCard.is_variant_printing && !candidateCard.is_variant_printing) {
    return true;
  }

  return candidateCard.name.localeCompare(currentCard.name) < 0;
}

function mergeUniqueCards(cardGroups) {
  // Deduplicates hydrated card batches by oracle/name.
  const cardsByKey = new Map();

  cardGroups.flat().forEach((card) => {
    const cardKey = getCardUniqueKey(card);
    const existingCard = cardsByKey.get(cardKey);

    if (!existingCard || shouldReplaceCardVersion(existingCard, card)) {
      cardsByKey.set(cardKey, card);
    }
  });

  return sortCardsByName([...cardsByKey.values()]);
}

function getScryfallOracleIds(cards) {
  return uniqueValues(cards.map((card) => card.oracle_id));
}

async function getVariantPricesById(variantIds) {
  const rows = [];

  for (
    let index = 0;
    index < variantIds.length;
    index += CARD_SEARCH_ID_BATCH_SIZE
  ) {
    const { data, error } = await supabase
      .from("card_variants")
      .select("id, prices, price_usd, price_usd_foil, price_usd_etched")
      .in("id", variantIds.slice(index, index + CARD_SEARCH_ID_BATCH_SIZE));

    if (error) throw error;

    rows.push(...(data || []));
  }

  return new Map(rows.map((row) => [row.id, row]));
}

async function normalizeCardRows(cards) {
  const variantPricesById = await getVariantPricesById(
    uniqueValues(cards.map((card) => card.default_variant_id)),
  );

  return (cards || [])
    .map((card) => {
      if (!card.default_variant_id) {
        return null;
      }

      const variantPrices = variantPricesById.get(card.default_variant_id);
      const displayVariantId = variantPrices?.id || card.default_variant_id;

      return {
        ...card,
        card_search_id: card.id,
        id: displayVariantId,
        variant_id: displayVariantId,
        scryfall_id:
          card.default_variant_scryfall_id ||
          card.representative_scryfall_id,
        is_default_printing: true,
        prices: variantPrices?.prices ?? card.prices ?? null,
        price_usd: variantPrices?.price_usd ?? card.price_usd ?? null,
        price_usd_foil:
          variantPrices?.price_usd_foil ?? card.price_usd_foil ?? null,
        price_usd_etched:
          variantPrices?.price_usd_etched ?? card.price_usd_etched ?? null,
      };
    })
    .filter(Boolean);
}

export function useCards({
  search = "",
  searchScopes = DEFAULT_SEARCH_SCOPES,
  manaValues = [],
  colors = [],
  colorMode = "or",
  rarities = [],
  types = [],
  formats = [],
  selectedSets = [],
  hasCollection = false,
  includeOwned = false,
  includeUnowned = true,
  limit = 50,
}) {
  const [cardList, setCardList] = useState([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [loadingMoreCards, setLoadingMoreCards] = useState(false);
  const [cardsError, setCardsError] = useState(null);
  const [hasMoreCards, setHasMoreCards] = useState(false);
  const requestIdRef = useRef(0);
  const nextRowStartRef = useRef(0);
  const ownershipMode = !hasCollection || (includeOwned && includeUnowned)
    ? "all"
    : includeOwned
      ? "owned"
      : includeUnowned
        ? "unowned"
        : "none";

  const hasActiveFilters =
    search.trim() !== "" ||
    manaValues.length > 0 ||
    colors.length > 0 ||
    rarities.length > 0 ||
    types.length > 0 ||
    formats.length > 0 ||
    selectedSets.length > 0 ||
    ownershipMode !== "all";
  const buildCardsQuery = useCallback(
    (
      start,
      end,
      {
        includeTextSearch = true,
        searchField = null,
        searchPattern = null,
        includeTypeFilters = true,
      } = {},
    ) => {
      /*
       * Builds the local Supabase query.
       *
       * Options:
       * - includeTextSearch: false when Scryfall already found exact names.
       * - searchField/searchPattern: escape hatch for future field-specific UI.
       * - includeTypeFilters: false during Scryfall hydration to avoid slow
       *   type_line ilike scans.
       */
      const hasSplitSearchField = Boolean(searchField);
      const trimmedSearch = search.trim();
      const usesOwnershipView = ownershipMode === "owned" || ownershipMode === "unowned";
      const searchTable = usesOwnershipView
        ? "card_search_with_ownership"
        : "card_search";
      let query = supabase
        .from(searchTable)
        .select(CARD_COLUMNS)
        .contains("games", ["paper"])
        .eq("is_legal", true)
        .eq("is_token", false)
        .eq("is_planechase", false)
        .neq("layout", "art_series")
        .neq("layout", "scheme")
        .or(NORMALIZED_PLAYABLE_CARD_TYPE_FILTER);

      query = query.order("name", { ascending: true });

      query = query.range(start, end);

      if (usesOwnershipView) {
        query = query.eq("is_owned", ownershipMode === "owned");
      }

      if (selectedSets.length > 0) {
        query = query.in("set_code", selectedSets);
      }

      if (trimmedSearch && includeTextSearch) {
        const searchTerms = getPlainSearchTerms(trimmedSearch);

        if (hasSplitSearchField) {
          query = query.ilike(
            searchField,
            searchPattern || `%${searchTerms.join(" ")}%`,
          );
        } else {
          searchTerms.forEach((term) => {
            getSearchTermAliases(term).forEach((alias) => {
              if (!usesAllSearchScopes(searchScopes)) {
                query = query.or(
                  getScopedSearchFilter(alias, searchScopes),
                );
              } else {
                query = query.or(getBroadSearchFilter(alias));
              }
            });
          });
        }
      }

      if (rarities.length > 0) {
        const normalizedRarities = rarities.map((rarity) =>
          rarity.toLowerCase(),
        );
        query = query.in("rarity", normalizedRarities);
      }
      if (manaValues.length > 0) {
        // Mana buckets are inclusive OR filters. Example: ["6", "7"] becomes
        // mana_value in (6) OR mana_value >= 7.
        const exactManaValues = manaValues
          .filter((mv) => mv !== "7")
          .map(Number);
        const manaFilters = [];

        if (exactManaValues.length > 0) {
          manaFilters.push(`mana_value.in.(${exactManaValues.join(",")})`);
        }

        if (manaValues.includes("7")) {
          manaFilters.push("mana_value.gte.7");
        }

        if (manaFilters.length > 0) {
          query = query.or(manaFilters.join(","));
        }
      }

      if (types.length > 0 && includeTypeFilters) {
        types.forEach((type) => {
          query = query.like(
            "normalized_type_line",
            `%${normalizeSearchText(type)}%`,
          );
        });
      }

      if (formats.length > 0) {
        formats.forEach((format) => {
          const normalizedFormat = format.toLowerCase();

          query = query.contains("legalities", {
            [normalizedFormat]: "legal",
          });
        });
      }

      if (colors.length > 0) {
        // Color filters read color identity, not casting cost. "C" means no
        // colored identity; in OR mode it can combine with colored selections.
        const selectedColors = sortColorIdentity(
          colors.filter((color) => color !== "C"),
        );
        const includesColorless = colors.includes("C");

        if (includesColorless && selectedColors.length === 0) {
          // Colorless only
          query = query.filter("color_identity", "eq", "{}");
        } else if (includesColorless && selectedColors.length > 0) {
          if (colorMode === "only") {
            // Exact identity cannot be both colorless and colored.
            query = query.eq("name", "__NO_COLOR_IDENTITY_MATCH__");
          } else if (colorMode === "and") {
            // Colorless plus every color identity subset within the selected colors.
            query = query.containedBy("color_identity", selectedColors);
          } else {
            // Colorless OR any selected color
            query = query.or(
              `color_identity.eq.{},color_identity.ov.{${selectedColors.join(",")}}`,
            );
          }
        } else if (colorMode === "only") {
          // Exact color identity match without depending on stored array order.
          query = query
            .contains("color_identity", selectedColors)
            .containedBy("color_identity", selectedColors);
        } else if (colorMode === "and") {
          // Any non-colorless identity subset within the selected colors.
          query = query
            .containedBy("color_identity", selectedColors)
            .overlaps("color_identity", selectedColors);
        } else {
          // Must contain any selected color
          query = query.overlaps("color_identity", selectedColors);
        }
      }

      return query;
    },
    [
      search,
      searchScopes,
      manaValues,
      colors,
      colorMode,
      rarities,
      types,
      formats,
      selectedSets,
      ownershipMode,
    ],
  );

  useEffect(() => {
    // requestIdRef invalidates late async results when filters change quickly.
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    async function getCards() {
      setLoadingCards(true);
      setLoadingMoreCards(false);
      setCardsError(null);
      setCardList([]);
      setHasMoreCards(false);
      nextRowStartRef.current = 0;

      if (ownershipMode === "none") {
        setLoadingCards(false);
        return;
      }

      if (!hasActiveFilters) {
        setLoadingCards(false);
        return;
      }

      const trimmedSearch = search.trim();
      const hasScryfallSyntax = usesScryfallSyntax(trimmedSearch);
      let data = [];
      let error = null;

      if (hasScryfallSyntax) {
        // Explicit Scryfall syntax goes raw, then hydrates local card rows by
        // oracle_id so pack actions still use our database ids.
        const exactOracleIds = getScryfallOracleIds(
          await getScryfallSearchCards(trimmedSearch),
        );
        const oracleIdBatches = [];

        for (
          let index = 0;
          index < exactOracleIds.length;
          index += EXACT_NAME_BATCH_SIZE
        ) {
          oracleIdBatches.push(
            exactOracleIds.slice(index, index + EXACT_NAME_BATCH_SIZE),
          );
        }

        const searchResults = await Promise.all(
          oracleIdBatches.map((oracleIdBatch) =>
            buildCardsQuery(0, TEXT_SEARCH_CANDIDATE_LIMIT - 1, {
              includeTextSearch: false,
              includeTypeFilters: false,
            }).in("oracle_id", oracleIdBatch),
          ),
        );
        const successfulResults = searchResults.filter((result) => !result.error);

        if (exactOracleIds.length > 0 && successfulResults.length === 0) {
          error = searchResults.find((result) => result.error)?.error;
        } else {
          data = mergeUniqueCards(
            successfulResults.map((result) => result.data || []),
          ).slice(0, TEXT_SEARCH_CANDIDATE_LIMIT);
        }
      } else {
        // Normal app search always reads the default printing in card_search.
        const result = await buildCardsQuery(0, limit - 1);
        const rowCount = result.data?.length || 0;

        data = mergeUniqueCards([result.data || []]);
        error = result.error;
        nextRowStartRef.current = rowCount;

        if (!error && trimmedSearch && data.length === 0) {
          const exactOracleIds = getScryfallOracleIds(
            await getScryfallSearchCards(trimmedSearch),
          );
          const oracleIdBatches = [];

          for (
            let index = 0;
            index < exactOracleIds.length;
            index += EXACT_NAME_BATCH_SIZE
          ) {
            oracleIdBatches.push(
              exactOracleIds.slice(index, index + EXACT_NAME_BATCH_SIZE),
            );
          }

          const fallbackResults = await Promise.all(
            oracleIdBatches.map((oracleIdBatch) =>
              buildCardsQuery(0, TEXT_SEARCH_CANDIDATE_LIMIT - 1, {
                includeTextSearch: false,
                includeTypeFilters: false,
              }).in("oracle_id", oracleIdBatch),
            ),
          );
          const successfulFallbackResults = fallbackResults.filter(
            (fallbackResult) => !fallbackResult.error,
          );

          if (exactOracleIds.length > 0 && successfulFallbackResults.length === 0) {
            error = fallbackResults.find(
              (fallbackResult) => fallbackResult.error,
            )?.error;
          } else {
            data = mergeUniqueCards(
              successfulFallbackResults.map(
                (fallbackResult) => fallbackResult.data || [],
              ),
            ).slice(0, TEXT_SEARCH_CANDIDATE_LIMIT);
            nextRowStartRef.current = data.length;
          }
        }
      }

      if (requestId !== requestIdRef.current) {
        return;
      }

      if (error) {
        console.error("Error loading cards:", error);
        setCardsError(error);
        setLoadingCards(false);
        return;
      }

      const normalizedData = await normalizeCardRows(data || []);

      if (requestId !== requestIdRef.current) {
        return;
      }

      setCardList(normalizedData);
      setHasMoreCards(!hasScryfallSyntax && nextRowStartRef.current >= limit);
      setLoadingCards(false);
    }

    getCards();

    return () => {
      if (requestId === requestIdRef.current) {
        requestIdRef.current += 1;
      }
    };
  }, [
    buildCardsQuery,
    colors.length,
    formats,
    hasActiveFilters,
    limit,
    manaValues,
    rarities,
    search,
    selectedSets,
    types,
    ownershipMode,
  ]);

  const loadMoreCards = useCallback(async () => {
    // Pagination is only for local broad searches. Scryfall-backed paths return
    // a bounded candidate list and set hasMoreCards false.
    if (loadingCards || loadingMoreCards || !hasMoreCards) return;

    const requestId = requestIdRef.current;
    setLoadingMoreCards(true);

    const start = nextRowStartRef.current;

    const { data, error } = await buildCardsQuery(start, start + limit - 1);
    const rowCount = data?.length || 0;

    if (requestId !== requestIdRef.current) {
      return;
    }

    if (error) {
      console.error("Error loading more cards:", error);
      setCardsError(error);
      setLoadingMoreCards(false);
      return;
    }

    const normalizedData = await normalizeCardRows(data || []);

    if (requestId !== requestIdRef.current) {
      return;
    }

    setCardList((prev) => {
      const combined = [...prev, ...normalizedData];

      return mergeUniqueCards([combined]);
    });
    nextRowStartRef.current = start + rowCount;
    setHasMoreCards(rowCount === limit);
    setLoadingMoreCards(false);
  }, [
    buildCardsQuery,
    hasMoreCards,
    limit,
    loadingCards,
    loadingMoreCards,
  ]);

  return {
    cardList,
    loadingCards,
    loadingMoreCards,
    cardsError,
    hasMoreCards,
    loadMoreCards,
  };
}

