import { useCallback, useEffect, useRef, useState } from "react";
import { searchCardsWithScryfall } from "../services/cardSearchService";

/*
 * useCards() owns the active card search experience.
 *
 * Card search is now sourced from Scryfall. Supabase card_search/card_variants
 * are intentionally disconnected from active search; Supabase remains the
 * application's storage layer for packs, cubes, collection rows, and tags.
 */

const DEFAULT_SEARCH_SCOPES = {
  title: true,
  type: true,
  text: true,
};

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
  ownedCardKeys = new Map(),
} = {}) {
  const [cardList, setCardList] = useState([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [loadingMoreCards, setLoadingMoreCards] = useState(false);
  const [cardsError, setCardsError] = useState(null);
  const [hasMoreCards, setHasMoreCards] = useState(false);
  const requestIdRef = useRef(0);
  const nextPageRef = useRef("");

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

  const getSearchOptions = useCallback(
    (pageUrl = "") => ({
      search,
      searchScopes,
      manaValues,
      colors,
      colorMode,
      rarities,
      types,
      formats,
      selectedSets,
      pageUrl,
    }),
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
    ],
  );

  const filterCardsByOwnership = useCallback(
    (cards) => {
      if (ownershipMode === "all") return cards;

      return cards.filter((card) => {
        const isOwned = [
          card.card_search_id,
          card.scryfall_id,
          card.variation_id,
          card.oracle_id,
        ].some((cardKey) => cardKey && ownedCardKeys.has(cardKey));

        return ownershipMode === "owned" ? isOwned : !isOwned;
      });
    },
    [ownedCardKeys, ownershipMode],
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
      nextPageRef.current = "";

      if (ownershipMode === "none") {
        setLoadingCards(false);
        return;
      }

      if (!hasActiveFilters) {
        setLoadingCards(false);
        return;
      }

      try {
        const result = await searchCardsWithScryfall(getSearchOptions());

        if (requestId !== requestIdRef.current) return;

        setCardList(filterCardsByOwnership(result.cards));
        setHasMoreCards(result.hasMore);
        nextPageRef.current = result.nextPage;
      } catch (error) {
        if (requestId !== requestIdRef.current) return;

        console.error("Error loading Scryfall cards:", error);
        setCardsError(error);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoadingCards(false);
        }
      }
    }

    getCards();

    return () => {
      if (requestId === requestIdRef.current) {
        requestIdRef.current += 1;
      }
    };
  }, [
    filterCardsByOwnership,
    getSearchOptions,
    hasActiveFilters,
    ownershipMode,
  ]);

  const loadMoreCards = useCallback(async () => {
    if (loadingCards || loadingMoreCards || !hasMoreCards || !nextPageRef.current) {
      return;
    }

    const requestId = requestIdRef.current;
    setLoadingMoreCards(true);
    setCardsError(null);

    try {
      const result = await searchCardsWithScryfall(
        getSearchOptions(nextPageRef.current),
      );

      if (requestId !== requestIdRef.current) return;

      setCardList((currentCards) => [
        ...currentCards,
        ...filterCardsByOwnership(result.cards),
      ]);
      setHasMoreCards(result.hasMore);
      nextPageRef.current = result.nextPage;
    } catch (error) {
      if (requestId !== requestIdRef.current) return;

      console.error("Error loading more Scryfall cards:", error);
      setCardsError(error);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoadingMoreCards(false);
      }
    }
  }, [
    getSearchOptions,
    filterCardsByOwnership,
    hasMoreCards,
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
