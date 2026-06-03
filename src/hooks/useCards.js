import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../utils/supabase";

const CARD_COLUMNS = `
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
  is_default_printing,
  is_variant_printing,
  is_planechase,
  set_name,
  set_code,
  collector_number,
  has_back_face
`;

const SCRYFALL_AUTOCOMPLETE_LIMIT = 20;
const TEXT_SEARCH_CANDIDATE_LIMIT = 200;
const SCRYFALL_SEARCH_PAGE_LIMIT = 2;
const EXACT_NAME_BATCH_SIZE = 50;
const SCRYFALL_FORMAT_ALIASES = {
  Standard: "standard",
  Pioneer: "pioneer",
  Modern: "modern",
  Legacy: "legacy",
  Vintage: "vintage",
  Commander: "commander",
};

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function quoteScryfallTerm(term) {
  return `"${term.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function getScryfallNameSuggestions(search) {
  const params = new URLSearchParams({
    q: search,
    include_extras: "false",
  });

  try {
    const response = await fetch(
      `https://api.scryfall.com/cards/autocomplete?${params}`,
    );

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();

    return (payload.data || []).slice(0, SCRYFALL_AUTOCOMPLETE_LIMIT);
  } catch {
    return [];
  }
}

function getScryfallFormatTerms(formats) {
  return formats
    .map((format) => SCRYFALL_FORMAT_ALIASES[format] || format.toLowerCase())
    .map((format) => `f:${format}`)
    .join(" ");
}

async function getScryfallTextSearchNames(search, formats) {
  const quotedSearch = quoteScryfallTerm(search);
  const formatTerms = getScryfallFormatTerms(formats);
  const params = new URLSearchParams({
    q: `(name:${quotedSearch} or type:${quotedSearch} or oracle:${quotedSearch}) ${formatTerms}`.trim(),
    unique: "cards",
    order: "name",
    include_extras: "false",
  });

  let nextPage = `https://api.scryfall.com/cards/search?${params}`;
  const names = [];

  try {
    for (
      let pageCount = 0;
      nextPage && pageCount < SCRYFALL_SEARCH_PAGE_LIMIT;
      pageCount += 1
    ) {
      const response = await fetch(nextPage);

      if (!response.ok) {
        return names;
      }

      const payload = await response.json();

      names.push(...(payload.data || []).map((card) => card.name));
      nextPage = payload.has_more ? payload.next_page : null;
    }
  } catch {
    return names;
  }

  return uniqueValues(names).slice(0, TEXT_SEARCH_CANDIDATE_LIMIT);
}

function sortCardsByName(cards) {
  return [...cards].sort((a, b) => a.name.localeCompare(b.name));
}

function getCardImageUrl(card) {
  return (
    card.image_url ||
    card.raw?.image_uris?.normal ||
    card.raw?.image_uris?.small ||
    card.raw?.small?.normal ||
    card.raw?.small?.small ||
    card.raw?.card_faces?.[0]?.image_uris?.normal ||
    card.raw?.card_faces?.[0]?.image_uris?.small ||
    card.raw?.card_faces?.[0]?.small?.normal ||
    card.raw?.card_faces?.[0]?.small?.small ||
    null
  );
}

function getCardUniqueKey(card, showAllPrintings) {
  if (showAllPrintings) {
    return String(card.scryfall_id || card.id);
  }

  return String(card.oracle_id || card.name || card.scryfall_id || card.id);
}

function shouldReplaceCardVersion(currentCard, candidateCard) {
  if (!getCardImageUrl(currentCard) && getCardImageUrl(candidateCard)) {
    return true;
  }

  if (currentCard.is_variant_printing && !candidateCard.is_variant_printing) {
    return true;
  }

  if (
    !currentCard.is_default_printing &&
    candidateCard.is_default_printing
  ) {
    return true;
  }

  return candidateCard.name.localeCompare(currentCard.name) < 0;
}

function mergeUniqueCards(cardGroups, showAllPrintings) {
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
  limit = 50,
}) {
  const [cardList, setCardList] = useState([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [loadingMoreCards, setLoadingMoreCards] = useState(false);
  const [cardsError, setCardsError] = useState(null);
  const [hasMoreCards, setHasMoreCards] = useState(false);
  const requestIdRef = useRef(0);

  const hasActiveFilters =
    search.trim() !== "" ||
    manaValues.length > 0 ||
    colors.length > 0 ||
    rarities.length > 0 ||
    types.length > 0 ||
    formats.length > 0 ||
    selectedSets.length > 0;

  const buildCardsQuery = useCallback(
    (
      start,
      end,
      { includeTextSearch = true, searchField = null, searchPattern = null } = {},
    ) => {
      const hasSplitSearchField = Boolean(searchField);
      let query = supabase
        .from("cards")
        .select(CARD_COLUMNS)
        .contains("games", ["paper"])
        .eq("nonfoil", true)
        .eq("is_token", false)
        .eq("is_funny", false)
        .eq("is_planechase", false)
        .neq("layout", "art_series");

      query = query.order("name", { ascending: true });

      query = query.range(start, end);

      if (selectedSets.length > 0) {
        query = query.in("set_code", selectedSets);
      }

      const hasSelectedSets = selectedSets.length > 0;

      if (!showAllPrintings && hasSelectedSets) {
        query = query.eq("is_variant_printing", false);
      }

      if (!showAllPrintings && !hasSelectedSets) {
        query = query.eq("is_default_printing", true);
      }

      const trimmedSearch = search.trim();

      if (trimmedSearch && includeTextSearch) {
        const safeSearch = trimmedSearch.replaceAll(",", " ");

        if (hasSplitSearchField) {
          query = query.ilike(searchField, searchPattern || `%${safeSearch}%`);
        } else if (safeSearch.length < 3) {
          query = query.ilike("name", `%${safeSearch}%`);
        } else {
          query = query.or(
            `name.ilike.%${safeSearch}%,type_line.ilike.%${safeSearch}%,oracle_text.ilike.%${safeSearch}%`,
          );
        }
      }

      if (rarities.length > 0) {
        const normalizedRarities = rarities.map((rarity) =>
          rarity.toLowerCase(),
        );
        query = query.in("rarity", normalizedRarities);
      }
      if (manaValues.length > 0) {
        const exactManaValues = manaValues
          .filter((mv) => mv !== "7")
          .map(Number);

        if (exactManaValues.length > 0) {
          query = query.in("mana_value", exactManaValues);
        }

        if (manaValues.includes("7")) {
          query = query.gte("mana_value", 7);
        }
      }

      if (types.length > 0) {
        types.forEach((type) => {
          query = query.ilike("type_line", `%${type}%`);
        });
      }

      if (formats.length > 0) {
        formats.forEach((format) => {
          const normalizedFormat = format.toLowerCase();

          query = query.eq(`legalities->>${normalizedFormat}`, "legal");
        });
      }

      if (colors.length > 0) {
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
      showAllPrintings,
      selectedSets,
    ],
  );

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    async function getCards() {
      setLoadingCards(true);
      setLoadingMoreCards(false);
      setCardsError(null);
      setCardList([]);
      setHasMoreCards(false);

      if (!hasActiveFilters) {
        setLoadingCards(false);
        return;
      }

      const trimmedSearch = search.trim();
      let data;
      let error;

      if (trimmedSearch.length >= 3) {
        const safeSearch = trimmedSearch.replaceAll(",", " ");
        const [suggestedNames, scryfallSearchNames] = await Promise.all([
          getScryfallNameSuggestions(safeSearch),
          getScryfallTextSearchNames(safeSearch, formats),
        ]);
        const exactNames = uniqueValues([
          ...suggestedNames,
          ...scryfallSearchNames,
        ]);
        const nameBatches = [];

        for (
          let index = 0;
          index < exactNames.length;
          index += EXACT_NAME_BATCH_SIZE
        ) {
          nameBatches.push(exactNames.slice(index, index + EXACT_NAME_BATCH_SIZE));
        }

        const searchResults = await Promise.all(
          nameBatches.map((nameBatch) =>
            buildCardsQuery(0, TEXT_SEARCH_CANDIDATE_LIMIT - 1, {
              includeTextSearch: false,
            }).in("name", nameBatch),
          ),
        );
        const successfulResults = searchResults.filter((result) => !result.error);

        if (exactNames.length > 0 && successfulResults.length === 0) {
          error = searchResults.find((result) => result.error)?.error;
        } else {
          data = mergeUniqueCards(
            successfulResults.map((result) => result.data || []),
            showAllPrintings,
          ).slice(0, TEXT_SEARCH_CANDIDATE_LIMIT);
        }
      } else {
        const result = await buildCardsQuery(0, limit - 1);

        data = mergeUniqueCards([result.data || []], showAllPrintings);
        error = result.error;
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

      setCardList(data || []);
      setHasMoreCards(trimmedSearch.length < 3 && (data || []).length === limit);
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
    formats,
    hasActiveFilters,
    limit,
    search,
    showAllPrintings,
  ]);

  const loadMoreCards = useCallback(async () => {
    if (loadingCards || loadingMoreCards || !hasMoreCards) return;

    const requestId = requestIdRef.current;
    setLoadingMoreCards(true);

    const start = cardList.length;
    const end = start + limit - 1;

    const { data, error } = await buildCardsQuery(start, end);

    if (requestId !== requestIdRef.current) {
      return;
    }

    if (error) {
      console.error("Error loading more cards:", error);
      setCardsError(error);
      setLoadingMoreCards(false);
      return;
    }

    setCardList((prev) => {
      const combined = [...prev, ...(data || [])];

      return mergeUniqueCards([combined], showAllPrintings);
    });
    setHasMoreCards((data || []).length === limit);
    setLoadingMoreCards(false);
  }, [
    buildCardsQuery,
    cardList.length,
    hasMoreCards,
    limit,
    loadingCards,
    loadingMoreCards,
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
