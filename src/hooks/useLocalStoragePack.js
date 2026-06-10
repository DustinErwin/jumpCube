import { useEffect, useRef } from "react";
import { sanitizeDescription, sanitizeTitle } from "../utils/userText";

const STORAGE_KEY = "jumpCubeCurrentPack";

/*
 * Legacy localStorage persistence for an active pack draft.
 *
 * The current app primarily uses Supabase autosave in usePackBuilder(). If this
 * hook is reintroduced, pass the active pack state/setters shown below and make
 * sure it does not conflict with autosave or savedPackId.
 */
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
  const hasLoadedPackRef = useRef(false);

  useEffect(() => {
    // Initial load: restore the saved draft into controlled pack state.
    const savedPack = localStorage.getItem(STORAGE_KEY);

    if (savedPack) {
      try {
        const parsedPack = JSON.parse(savedPack);

        setPackName(sanitizeTitle(parsedPack.packName, "Current Pack"));
        setPackDescription(sanitizeDescription(parsedPack.packDescription));
        setSelectedCards(parsedPack.selectedCards || []);
        setSavedPackId(parsedPack.savedPackId || null);
        setSavedPackName(parsedPack.savedPackName || null);
      } catch (error) {
        console.error("Error loading current pack:", error);
      }
    }

    hasLoadedPackRef.current = true;
  }, [
    setPackName,
    setPackDescription,
    setSelectedCards,
    setSavedPackId,
    setSavedPackName,
  ]);

  useEffect(() => {
    // Subsequent changes overwrite the draft after initial load completes.
    if (!hasLoadedPackRef.current) return;

    const packData = {
      packName,
      packDescription,
      selectedCards,
      savedPackId,
      savedPackName,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(packData));
  }, [
    packName,
    packDescription,
    selectedCards,
    savedPackId,
    savedPackName,
  ]);

  function clearStoredPack() {
    // Call this when starting a truly fresh local draft.
    localStorage.removeItem(STORAGE_KEY);
  }

  return {
    clearStoredPack,
  };
}
