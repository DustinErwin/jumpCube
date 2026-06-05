import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../utils/supabase";

const PACK_TITLE_MAX_LENGTH = 40;
export const PACK_CARD_LIMIT = 20;
export const PACK_ARCHETYPE_TAGS = [
  "Aggro",
  "Midrange",
  "Control",
  "Tempo",
  "Combo",
  "Ramp",
];

function normalizePackName(name, fallback = "Unnamed Pack") {
  const trimmedName = (name || "").trim().slice(0, PACK_TITLE_MAX_LENGTH);

  return trimmedName || fallback;
}

function normalizeArchetypeTags(tags) {
  const incomingTags = Array.isArray(tags) ? tags : tags ? [tags] : [];

  return PACK_ARCHETYPE_TAGS.filter((tag) => incomingTags.includes(tag));
}

function normalizeVisibility(visibility) {
  return visibility === "public" ? "public" : "private";
}

function getPackSnapshot(name, description, archetypeTags, visibility, cards) {
  return JSON.stringify({
    name: normalizePackName(name),
    description: description || "",
    archetypeTags: normalizeArchetypeTags(archetypeTags),
    visibility: normalizeVisibility(visibility),
    cards: cards.map((card) => ({
      id: card.id,
      quantity: card.quantity,
    })),
  });
}

function getPackCardCount(cards) {
  return cards.reduce((sum, card) => sum + card.quantity, 0);
}

export function usePackBuilder(user, refreshPacks) {
  const [selectedCards, setSelectedCards] = useState([]);
  const [packName, setPackName] = useState("Current Pack");
  const [packDescription, setPackDescription] = useState("");
  const [packArchetypeTags, setPackArchetypeTags] = useState([]);
  const [packVisibility, setPackVisibility] = useState("private");
  const [savedPackId, setSavedPackId] = useState(null);
  const [savedPackName, setSavedPackName] = useState(null);
  const [saveStatus, setSaveStatus] = useState("");
  const [showRenameChoice, setShowRenameChoice] = useState(false);
  const [pendingSaveAction, setPendingSaveAction] = useState(null);
  const lastSavedSnapshotRef = useRef(null);

  function addCardToPack(card) {
    setSelectedCards((prev) => {
      if (getPackCardCount(prev) >= PACK_CARD_LIMIT) {
        return prev;
      }

      const existingCard = prev.find((c) => c.id === card.id);

      if (existingCard) {
        return prev.map((c) =>
          c.id === card.id ? { ...c, quantity: c.quantity + 1 } : c,
        );
      }

      return [...prev, { ...card, quantity: 1 }];
    });
  }

  async function loadPack(packId) {
    const { data: pack, error: packError } = await supabase
      .from("packs")
      .select("*")
      .eq("id", packId)
      .single();

    if (packError) {
      console.error("Error loading pack:", packError);
      return;
    }

    const { data: packCards, error: cardsError } = await supabase
      .from("pack_cards")
      .select(
        `
      quantity,
      cards (*)
    `,
      )
      .eq("pack_id", packId);

    if (cardsError) {
      console.error("Error loading pack cards:", cardsError);
      return;
    }

    const hydratedCards = (packCards || []).map((row) => ({
      ...row.cards,
      quantity: row.quantity,
    }));

    setPackName(normalizePackName(pack.name, "Current Pack"));
    setPackDescription(pack.description || "");
    setPackArchetypeTags(
      normalizeArchetypeTags(pack.archetype_tags || pack.archetype_tag),
    );
    setPackVisibility(normalizeVisibility(pack.visibility));
    setSelectedCards(hydratedCards);
    setSavedPackId(pack.id);
    setSavedPackName(pack.name || null);
    lastSavedSnapshotRef.current = getPackSnapshot(
      pack.name || "Current Pack",
      pack.description || "",
      pack.archetype_tags || pack.archetype_tag,
      pack.visibility,
      hydratedCards,
    );
  }

  function decreaseCardQuantity(cardId) {
    setSelectedCards((prev) =>
      prev
        .map((card) =>
          card.id === cardId ? { ...card, quantity: card.quantity - 1 } : card,
        )
        .filter((card) => card.quantity > 0),
    );
  }

  function removeCardFromPack(cardId) {
    setSelectedCards((prev) => prev.filter((card) => card.id !== cardId));
  }

  function newPack() {
    setPackName("Unnamed Pack");
    setPackDescription("");
    setPackArchetypeTags([]);
    setPackVisibility("private");
    setSelectedCards([]);
    setSavedPackId(null);
    setSavedPackName(null);
    setShowRenameChoice(false);
    setPendingSaveAction(null);
    lastSavedSnapshotRef.current = null;
    localStorage.removeItem("jumpCubeCurrentPack");
  }

  const finishSave = useCallback(async function finishSave(packId) {
    if (!user?.id) {
      setSaveStatus("error");
      return null;
    }

    const currentSnapshot = getPackSnapshot(
      packName,
      packDescription,
      packArchetypeTags,
      packVisibility,
      selectedCards,
    );

    if (packId && currentSnapshot === lastSavedSnapshotRef.current) {
      return packId;
    }

    setSaveStatus("saving");

    let actualPackId = packId;

    if (!actualPackId) {
      const { data: pack, error: packError } = await supabase
        .from("packs")
        .insert({
          name: normalizePackName(packName),
          description: packDescription,
          archetype_tags: normalizeArchetypeTags(packArchetypeTags),
          visibility: normalizeVisibility(packVisibility),
          user_id: user.id,
        })
        .select()
        .single();

      if (packError) {
        console.error("Error saving pack:", packError);
        setSaveStatus("error");
        return null;
      }

      actualPackId = pack.id;
      setSavedPackId(pack.id);
    } else {
      const { error: updateError } = await supabase
        .from("packs")
        .update({
          name: normalizePackName(packName),
          description: packDescription,
          archetype_tags: normalizeArchetypeTags(packArchetypeTags),
          visibility: normalizeVisibility(packVisibility),
        })
        .eq("id", actualPackId);

      if (updateError) {
        console.error("Error updating pack:", updateError);
        setSaveStatus("error");
        return null;
      }
    }

    const packCards = selectedCards.map((card) => ({
      pack_id: actualPackId,
      card_id: card.id,
      quantity: card.quantity,
    }));

    const { error: deleteCardsError } = await supabase
      .from("pack_cards")
      .delete()
      .eq("pack_id", actualPackId);

    if (deleteCardsError) {
      console.error("Error clearing pack cards:", deleteCardsError);
      setSaveStatus("error");
      return null;
    }

    if (packCards.length > 0) {
      const { error: cardsError } = await supabase
        .from("pack_cards")
        .insert(packCards);

      if (cardsError) {
        console.error("Error saving pack cards:", cardsError);
        setSaveStatus("error");
        return null;
      }
    }

    setSavedPackName(normalizePackName(packName));
    lastSavedSnapshotRef.current = currentSnapshot;
    await refreshPacks?.();
    setSaveStatus("saved");

    setTimeout(() => setSaveStatus(""), 2000);

    return actualPackId;
  }, [
    packArchetypeTags,
    packDescription,
    packVisibility,
    packName,
    refreshPacks,
    selectedCards,
    user,
  ]);

  async function duplicatePack(packId) {
    if (!packId || !user) return;

    const { data: originalPack, error: packError } = await supabase
      .from("packs")
      .select("*")
      .eq("id", packId)
      .single();

    if (packError) {
      console.error("Error loading pack to duplicate:", packError);
      return;
    }

    const { data: originalCards, error: cardsError } = await supabase
      .from("pack_cards")
      .select("card_id, quantity")
      .eq("pack_id", packId);

    if (cardsError) {
      console.error("Error loading pack cards to duplicate:", cardsError);
      return;
    }

    const { data: newPack, error: newPackError } = await supabase
      .from("packs")
      .insert({
        name: normalizePackName(`${originalPack.name} Copy`),
        description: originalPack.description,
        archetype_tags: normalizeArchetypeTags(
          originalPack.archetype_tags || originalPack.archetype_tag,
        ),
        visibility: normalizeVisibility(originalPack.visibility),
        user_id: user.id,
      })
      .select()
      .single();

    if (newPackError) {
      console.error("Error creating duplicate pack:", newPackError);
      return;
    }

    const copiedCards = originalCards.map((card) => ({
      pack_id: newPack.id,
      card_id: card.card_id,
      quantity: card.quantity,
    }));

    if (copiedCards.length > 0) {
      const { error: insertCardsError } = await supabase
        .from("pack_cards")
        .insert(copiedCards);

      if (insertCardsError) {
        console.error("Error copying pack cards:", insertCardsError);
        return;
      }
    }

    await refreshPacks?.();
  }

  async function deletePack(packId) {
    if (!packId) return;

    const { error } = await supabase.from("packs").delete().eq("id", packId);

    if (error) {
      console.error("Error deleting pack:", error);
      return;
    }

    newPack();
  }

  function moveCard(draggedCardId, targetCardId) {
    if (!draggedCardId || draggedCardId === targetCardId) return;

    setSelectedCards((prev) => {
      const draggedIndex = prev.findIndex((card) => card.id === draggedCardId);
      const targetIndex = prev.findIndex((card) => card.id === targetCardId);

      if (draggedIndex === -1 || targetIndex === -1) return prev;

      const updated = [...prev];
      const [draggedCard] = updated.splice(draggedIndex, 1);

      updated.splice(targetIndex, 0, draggedCard);

      return updated;
    });
  }

  async function savePack({ promptOnRename = true } = {}) {
    if (selectedCards.length === 0) return null;

    if (
      promptOnRename &&
      savedPackId &&
      savedPackName &&
      normalizePackName(packName) !== normalizePackName(savedPackName)
    ) {
      setShowRenameChoice(true);

      setPendingSaveAction(() => ({
        renameExisting: async () => {
          setShowRenameChoice(false);
          return finishSave(savedPackId);
        },

        saveAsNew: async () => {
          setShowRenameChoice(false);
          return finishSave(null);
        },
      }));

      return null;
    }

    return finishSave(savedPackId);
  }

  useEffect(() => {
    if (!user?.id) return undefined;
    if (selectedCards.length === 0 && !savedPackId) return undefined;

    const currentSnapshot = getPackSnapshot(
      packName,
      packDescription,
      packArchetypeTags,
      packVisibility,
      selectedCards,
    );

    if (savedPackId && currentSnapshot === lastSavedSnapshotRef.current) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      finishSave(savedPackId);
    }, 800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    finishSave,
    packDescription,
    packArchetypeTags,
    packVisibility,
    packName,
    savedPackId,
    selectedCards,
    user,
  ]);

  return {
    selectedCards,
    isPackFull: getPackCardCount(selectedCards) >= PACK_CARD_LIMIT,
    setSelectedCards,
    packName,
    setPackName,
    packDescription,
    setPackDescription,
    packArchetypeTags,
    setPackArchetypeTags,
    packVisibility,
    setPackVisibility,
    savedPackId,
    setSavedPackId,
    savedPackName,
    setSavedPackName,
    saveStatus,
    showRenameChoice,
    pendingSaveAction,
    addCardToPack,
    decreaseCardQuantity,
    removeCardFromPack,
    newPack,
    savePack,
    loadPack,
    deletePack,
    duplicatePack,
    moveCard,
  };
}
