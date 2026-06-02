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

function sortCardsByName(cards) {
  return [...cards].sort((a, b) => a.name.localeCompare(b.name));
}

function getCardUniqueKey(card, showAllPrintings) {
  if (showAllPrintings) {
    return String(card.scryfall_id || card.id);
  }

  return String(card.oracle_id || card.name || card.scryfall_id || card.id);
}

function shouldReplaceCardVersion(currentCard, candidateCard) {
  if (!currentCard.image_url && candidateCard.image_url) {
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
    (start, end, searchField = null) => {
      const hasSplitSearchField = Boolean(searchField);
      let query = supabase
        .from("cards")
        .select(CARD_COLUMNS)
        .contains("games", ["paper"])
        .eq("nonfoil", true)
        .eq("is_token", false)
        .eq("is_funny", false)
        .eq("is_planechase", false);

      if (!hasSplitSearchField) {
        query = query.order("name", { ascending: true });
      }

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

      if (trimmedSearch) {
        const safeSearch = trimmedSearch.replaceAll(",", " ");

        if (hasSplitSearchField) {
          query = query.ilike(searchField, `%${safeSearch}%`);
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
        const [nameResult, typeResult] = await Promise.all([
          buildCardsQuery(0, limit - 1, "name"),
          buildCardsQuery(0, limit - 1, "type_line"),
        ]);

        const successfulResults = [nameResult, typeResult].filter(
          (result) => !result.error,
        );

        if (successfulResults.length === 0) {
          error = nameResult.error || typeResult.error;
        } else {
          data = mergeUniqueCards(
            successfulResults.map((result) => result.data || []),
            showAllPrintings,
          ).slice(0, limit);
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
  }, [buildCardsQuery, hasActiveFilters, limit]);

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
