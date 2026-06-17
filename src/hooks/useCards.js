import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../utils/supabase";

/*
 * useCards() owns the card search experience.
 *
 * Arguments:
 * {
 *   search: committed search string from SearchBox,
 *   manaValues/colors/rarities/types/formats/selectedSets: filter arrays,
 *   colorMode: "or" | "and",
 *   showAllPrintings: boolean,
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
 *   from card_search/card_variants.
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
const CARD_VARIANT_COLUMNS = `
  id,
  scryfall_id,
  oracle_id,
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
  games,
  nonfoil,
  is_token,
  is_funny,
  is_variant_printing,
  is_planechase,
  set_name,
  set_code,
  set_type,
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
const BASIC_LAND_TYPE_FILTER = "Basic Land";
const PLAYABLE_CARD_TYPE_FILTER = [
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
]
  .map((type) => `type_line.ilike.%${type}%`)
  .join(",");
const BASIC_LAND_NAMES = [
  "Plains",
  "Island",
  "Swamp",
  "Mountain",
  "Forest",
  "Wastes",
];
const BASIC_LAND_SET_CODES = {
  Plains: "bfz",
  Island: "bfz",
  Swamp: "bfz",
  Mountain: "bfz",
  Forest: "bfz",
  Wastes: "ogw",
};

function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getPreferredBasicLandScore(card) {
  // Basic lands prefer a coherent Zendikar-block look, but the imported
  // Scryfall "default cards" bulk file may not include every preferred print.
  if (card.set_code === BASIC_LAND_SET_CODES[card.name]) {
    return 0;
  }

  if (card.is_default_printing) {
    return 1;
  }

  return 2;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
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

function getCardUniqueKey(card, showAllPrintings) {
  if (showAllPrintings) {
    return String(card.scryfall_id || card.id);
  }

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
   * When showAllPrintings is false, multiple rows can represent the same card.
   * This chooses the version shown in the grid:
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

function mergeUniqueCards(cardGroups, showAllPrintings) {
  // Deduplicates hydrated card batches by oracle/name unless all printings are
  // requested. It also applies shouldReplaceCardVersion() per duplicate group.
  const cardsByKey = new Map();

  cardGroups.flat().forEach((card) => {
    const cardKey = getCardUniqueKey(card, showAllPrintings);
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

async function getCardSearchIdsByOracleId(oracleIds) {
  const rows = [];

  for (
    let index = 0;
    index < oracleIds.length;
    index += CARD_SEARCH_ID_BATCH_SIZE
  ) {
    const { data, error } = await supabase
      .from("card_search")
      .select("id, oracle_id")
      .in("oracle_id", oracleIds.slice(index, index + CARD_SEARCH_ID_BATCH_SIZE));

    if (error) throw error;

    rows.push(...(data || []));
  }

  return new Map(rows.map((row) => [row.oracle_id, row.id]));
}

async function normalizeCardRows(
  cards,
  showAllPrintings,
  usesVariantRows = showAllPrintings,
) {
  if (usesVariantRows) {
    const oracleIds = uniqueValues(cards.map((card) => card.oracle_id));
    const searchIdByOracleId = await getCardSearchIdsByOracleId(oracleIds);

    return (cards || [])
      .map((card) => {
        const cardSearchId = searchIdByOracleId.get(card.oracle_id);

        if (!cardSearchId) return null;

        return {
          ...card,
          card_search_id: cardSearchId,
          variant_id: card.id,
        };
      })
      .filter(Boolean);
  }

  return (cards || [])
    .map((card) => {
      if (!card.default_variant_id) {
        return null;
      }

      return {
        ...card,
        card_search_id: card.id,
        id: card.default_variant_id,
        variant_id: card.default_variant_id,
        scryfall_id:
          card.default_variant_scryfall_id || card.representative_scryfall_id,
        is_default_printing: true,
      };
    })
    .filter(Boolean);
}

export function useCards({
  search = "",
  manaValues = [],
  colors = [],
  colorMode = "or",
  rarities = [],
  types = [],
  formats = [],
  selectedSets = [],
  showAllPrintings = false,
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
      const searchesVariants = showAllPrintings || selectedSets.length > 0;
      const usesOwnershipView = ownershipMode === "owned" || ownershipMode === "unowned";
      const searchTable = usesOwnershipView
        ? searchesVariants
          ? "card_variants_with_ownership"
          : "card_search_with_ownership"
        : searchesVariants
          ? "card_variants"
          : "card_search";
      const searchColumns = searchesVariants ? CARD_VARIANT_COLUMNS : CARD_COLUMNS;
      let query = supabase
        .from(searchTable)
        .select(searchColumns)
        .contains("games", ["paper"])
        .lte("released_at", getTodayDateString())
        .eq("nonfoil", true)
        .eq("is_token", false)
        .eq("is_funny", false)
        .eq("is_planechase", false)
        .neq("layout", "art_series")
        .neq("layout", "scheme")
        .or(PLAYABLE_CARD_TYPE_FILTER);

      query = query.order("name", { ascending: true });

      query = query.range(start, end);

      if (searchesVariants) {
        query = query.eq("lang", "en").neq("set_type", "funny");
      }

      if (usesOwnershipView) {
        query = query.eq("is_owned", ownershipMode === "owned");
      }

      if (selectedSets.length > 0) {
        query = query.in("set_code", selectedSets);
      }

      if (!showAllPrintings && selectedSets.length > 0) {
        query = query.eq("is_variant_printing", false);
      }

      const trimmedSearch = search.trim();

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
              if (searchesVariants) {
                query = query.or(
                  `name.ilike.%${alias}%,type_line.ilike.%${alias}%,oracle_text.ilike.%${alias}%`,
                );
              } else {
                query = query.ilike(
                  "search_text",
                  `%${normalizeSearchText(alias)}%`,
                );
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
        if (types.includes(BASIC_LAND_TYPE_FILTER)) {
          query = query.in("name", BASIC_LAND_NAMES);
        }

        types.filter((type) => type !== BASIC_LAND_TYPE_FILTER).forEach((type) => {
          query = query.ilike("type_line", `%${type}%`);
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
        const selectedColors = colors.filter((color) => color !== "C");
        const includesColorless = colors.includes("C");

        if (includesColorless && selectedColors.length === 0) {
          // Colorless only
          query = query.filter("color_identity", "eq", "{}");
        } else if (includesColorless && selectedColors.length > 0) {
          if (colorMode === "and") {
            // A card cannot be both colorless and have colors
            query = query.filter("color_identity", "eq", "{}");
          } else {
            // Colorless OR any selected color
            query = query.or(
              `color_identity.eq.{},color_identity.ov.{${selectedColors.join(",")}}`,
            );
          }
        } else if (colorMode === "and") {
          // Must contain all selected colors
          query = query.contains("color_identity", selectedColors);
        } else {
          // Must contain any selected color
          query = query.overlaps("color_identity", selectedColors);
        }
      }

      return query;
    },
    [
      search,
      manaValues,
      colors,
      colorMode,
      rarities,
      types,
      formats,
      selectedSets,
      showAllPrintings,
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
      const hasBasicLandTypeFilter = types.includes(BASIC_LAND_TYPE_FILTER);
      let data;
      let error;

      if (hasBasicLandTypeFilter && !trimmedSearch && colors.length === 0) {
        // Special-case basics so the filter returns the six land names instead
        // of every basic land printing in the database.
        const basicLandResults = await Promise.all(
          BASIC_LAND_NAMES.map((basicLandName) =>
            buildCardsQuery(0, 24, {
              includeTextSearch: false,
            })
              .eq("name", basicLandName)
              .order("set_code", { ascending: true }),
          ),
        );
        const successfulResults = basicLandResults.filter(
          (result) => !result.error,
        );

        if (successfulResults.length === 0) {
          error = basicLandResults.find((result) => result.error)?.error;
        } else {
          data = BASIC_LAND_NAMES.map((basicLandName) => {
            const candidates = successfulResults
              .flatMap((result) => result.data || [])
              .filter((card) => card.name === basicLandName)
              .sort((cardA, cardB) => {
                const preferredComparison =
                  getPreferredBasicLandScore(cardA) -
                  getPreferredBasicLandScore(cardB);

                if (preferredComparison !== 0) {
                  return preferredComparison;
                }

                return compareCollectorNumbers(cardA, cardB);
              });

            return candidates[0];
          }).filter(Boolean);
        }

        nextRowStartRef.current = BASIC_LAND_NAMES.length;
      } else if (hasScryfallSyntax) {
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
            showAllPrintings,
          ).slice(0, TEXT_SEARCH_CANDIDATE_LIMIT);
        }
      } else {
        // Normal app search reads card_search; all-printing mode reads exact
        // card_variants rows and attaches card_search_id afterward.
        const result = await buildCardsQuery(0, limit - 1);
        const rowCount = result.data?.length || 0;

        data = mergeUniqueCards([result.data || []], showAllPrintings);
        error = result.error;
        nextRowStartRef.current = rowCount;
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

      const normalizedData = await normalizeCardRows(
        data || [],
        showAllPrintings,
        showAllPrintings || selectedSets.length > 0,
      );

      if (requestId !== requestIdRef.current) {
        return;
      }

      setCardList(normalizedData);
      setHasMoreCards(
        !hasScryfallSyntax && nextRowStartRef.current >= limit,
      );
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
    search,
    selectedSets,
    showAllPrintings,
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

    const normalizedData = await normalizeCardRows(
      data || [],
      showAllPrintings,
      showAllPrintings || selectedSets.length > 0,
    );

    if (requestId !== requestIdRef.current) {
      return;
    }

    setCardList((prev) => {
      const combined = [...prev, ...normalizedData];

      return mergeUniqueCards([combined], showAllPrintings);
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
    selectedSets.length,
    showAllPrintings,
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
