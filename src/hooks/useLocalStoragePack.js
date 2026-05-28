import { useEffect, useState } from "react";

const STORAGE_KEY = "jumpCubeCurrentPack";

export function useLocalStoragePack({
  packName,
  setPackName,
  packDescription,
  setPackDescription,
  selectedCards,
  setSelectedCards,
  savedPackId,
  setSavedPackId,
  savedPackName,
  setSavedPackName,
}) {
  const [hasLoadedPack, setHasLoadedPack] = useState(false);

  useEffect(() => {
    const savedPack = localStorage.getItem(STORAGE_KEY);

    if (savedPack) {
      try {
        const parsedPack = JSON.parse(savedPack);

        setPackName(parsedPack.packName || "Current Pack");
        setPackDescription(parsedPack.packDescription || "");
        setSelectedCards(parsedPack.selectedCards || []);
        setSavedPackId(parsedPack.savedPackId || null);
        setSavedPackName(parsedPack.savedPackName || null);
      } catch (error) {
        console.error("Error loading current pack:", error);
      }
    }

    setHasLoadedPack(true);
  }, [
    setPackName,
    setPackDescription,
    setSelectedCards,
    setSavedPackId,
    setSavedPackName,
  ]);

  useEffect(() => {
    if (!hasLoadedPack) return;

    const packData = {
      packName,
      packDescription,
      selectedCards,
      savedPackId,
      savedPackName,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(packData));
  }, [
    hasLoadedPack,
    packName,
    packDescription,
    selectedCards,
    savedPackId,
    savedPackName,
  ]);

  function clearStoredPack() {
    localStorage.removeItem(STORAGE_KEY);
  }

  return {
    clearStoredPack,
  };
}
