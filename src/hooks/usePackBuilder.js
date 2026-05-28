import { useState } from "react";
import { supabase } from "../utils/supabase";

export function usePackBuilder(user, refreshPacks) {
  const [selectedCards, setSelectedCards] = useState([]);
  const [packName, setPackName] = useState("Current Pack");
  const [packDescription, setPackDescription] = useState("");
  const [savedPackId, setSavedPackId] = useState(null);
  const [savedPackName, setSavedPackName] = useState(null);
  const [saveStatus, setSaveStatus] = useState("");
  const [showRenameChoice, setShowRenameChoice] = useState(false);
  const [pendingSaveAction, setPendingSaveAction] = useState(null);

  function addCardToPack(card) {
    setSelectedCards((prev) => {
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

    setPackName(pack.name || "Current Pack");
    setPackDescription(pack.description || "");
    setSelectedCards(hydratedCards);
    setSavedPackId(pack.id);
    setSavedPackName(pack.name || null);
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
    setPackName("Current Pack");
    setPackDescription("");
    setSelectedCards([]);
    setSavedPackId(null);
    setSavedPackName(null);
    setShowRenameChoice(false);
    setPendingSaveAction(null);
    localStorage.removeItem("jumpCubeCurrentPack");
  }

  async function finishSave(packId) {
    setSaveStatus("saving");

    let actualPackId = packId;

    if (!actualPackId) {
      const { data: pack, error: packError } = await supabase
        .from("packs")
        .insert({
          name: packName,
          description: packDescription,
          user_id: user.id,
        })
        .select()
        .single();

      if (packError) {
        console.error("Error saving pack:", packError);
        setSaveStatus("error");
        return;
      }

      actualPackId = pack.id;
      setSavedPackId(pack.id);
    } else {
      const { error: updateError } = await supabase
        .from("packs")
        .update({
          name: packName,
          description: packDescription,
        })
        .eq("id", actualPackId);

      if (updateError) {
        console.error("Error updating pack:", updateError);
        setSaveStatus("error");
        return;
      }
    }

    const packCards = selectedCards.map((card) => ({
      pack_id: actualPackId,
      card_id: card.id,
      quantity: card.quantity,
    }));

    const { error: cardsError } = await supabase
      .from("pack_cards")
      .upsert(packCards, { onConflict: "pack_id,card_id" });

    if (cardsError) {
      console.error("Error saving pack cards:", cardsError);
      setSaveStatus("error");
      return;
    }

    setSavedPackName(packName);
    await refreshPacks?.();
    setSaveStatus("saved");

    setTimeout(() => setSaveStatus(""), 2000);
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

  async function savePack() {
    if (selectedCards.length === 0) return;

    if (
      savedPackId &&
      savedPackName &&
      packName.trim() !== savedPackName.trim()
    ) {
      setShowRenameChoice(true);

      setPendingSaveAction(() => ({
        renameExisting: async () => {
          setShowRenameChoice(false);
          await finishSave(savedPackId);
        },

        saveAsNew: async () => {
          setShowRenameChoice(false);
          await finishSave(null);
        },
      }));

      return;
    }

    await finishSave(savedPackId);
  }

  return {
    selectedCards,
    setSelectedCards,
    packName,
    setPackName,
    packDescription,
    setPackDescription,
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
  };
}
