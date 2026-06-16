import { useCallback, useEffect, useMemo, useState } from "react";
import { loadUserCollection } from "../services/collectionService";

export function useCollection(user) {
  const [collectionItems, setCollectionItems] = useState([]);
  const [loadingCollection, setLoadingCollection] = useState(Boolean(user));
  const [collectionError, setCollectionError] = useState(null);

  const refreshCollection = useCallback(async () => {
    if (!user) {
      setCollectionItems([]);
      setLoadingCollection(false);
      return;
    }

    setLoadingCollection(true);
    setCollectionError(null);

    try {
      setCollectionItems(await loadUserCollection());
    } catch (error) {
      console.error("Error loading collection:", error);
      setCollectionError(error);
    } finally {
      setLoadingCollection(false);
    }
  }, [user]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      refreshCollection();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [refreshCollection]);

  const quantitiesByCardSearchId = useMemo(
    () =>
      collectionItems.reduce((quantities, item) => {
        quantities.set(
          item.card_search_id,
          (quantities.get(item.card_search_id) || 0) + item.quantity,
        );
        return quantities;
      }, new Map()),
    [collectionItems],
  );

  return {
    collectionItems,
    loadingCollection,
    collectionError,
    hasCollection: collectionItems.length > 0,
    quantitiesByCardSearchId,
    refreshCollection,
  };
}
