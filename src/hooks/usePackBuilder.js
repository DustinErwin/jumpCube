import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../utils/supabase";

/*
 * usePackBuilder() owns the active pack editor.
 *
 * Arguments:
 * - user: Supabase auth user; user.id is written to packs.user_id.
 * - refreshPacks: optional async callback that reloads the pack library.
 * - callbacks: {
 *     onPackSaved(packSummary): called after a successful save/autosave,
 *     onPackDeleted(packId): called after delete so cubes can remove it
 *   }
 *
 * Selected card shape:
 * {
 *   ...card row from cards table,
 *   quantity: number,
 *   manualMechanicBucket?: string | null
 * }
 */

const PACK_TITLE_MAX_LENGTH = 40;
export const PACK_CARD_LIMIT = 20;
// Update this list when adding/removing archetype options in PackBox.
export const PACK_ARCHETYPE_TAGS = [
  "Aggro",
  "Midrange",
  "Control",
  "Tempo",
  "Combo",
  "Ramp",
];
const PACK_CARD_COLUMNS = `
  id,
  scryfall_id,
  oracle_id,
  name,
  mana_value,
  mana_cost,
  colors,
  color_identity,
  type_line,
  oracle_text,
  rarity,
  image_url,
  back_image_url,
  image_uris,
  card_faces,
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
  // Snapshot is compared before autosave to avoid writing the same pack in a
  // loop. Include any new saved pack field here if it should trigger autosave.
  return JSON.stringify({
    name: normalizePackName(name),
    description: description || "",
    archetypeTags: normalizeArchetypeTags(archetypeTags),
    visibility: normalizeVisibility(visibility),
    cards: cards.map((card) => ({
      id: card.id,
      quantity: card.quantity,
      manualMechanicBucket: card.manualMechanicBucket || null,
    })),
  });
}

function getPackCardCount(cards) {
  return cards.reduce((sum, card) => sum + card.quantity, 0);
}

export function usePackBuilder(user, refreshPacks, {
  onPackSaved,
  onPackDeleted,
} = {}) {
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
    // Adds one copy, up to PACK_CARD_LIMIT. Existing copies increment quantity
    // instead of duplicating rows in selectedCards.
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
    // Loads pack metadata first, then pack_cards with hydrated card rows. The
    // PACK_CARD_COLUMNS list should include every field the PackBox/CardModal
    // needs after opening a saved pack.
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
      manual_mechanic_bucket,
      cards (${PACK_CARD_COLUMNS})
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
      manualMechanicBucket: row.manual_mechanic_bucket || null,
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
    // Removes one copy and drops the card entirely when quantity reaches zero.
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
    // Resets local editor state only. It does not delete anything in Supabase.
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

  const finishSave = useCallback(async function finishSave(
    packId,
    cardsOverride = selectedCards,
  ) {
    /*
     * Persists pack metadata and card rows.
     *
     * packId: existing database id, or null to create.
     * cardsOverride: optional selectedCards replacement used by callers that
     * need to save a just-mutated card list before React state settles.
     *
     * Returns the saved pack id, or null on validation/save error.
     */
    if (!user?.id) {
      setSaveStatus("error");
      return null;
    }

    const cardsToSave = cardsOverride || selectedCards;

    const currentSnapshot = getPackSnapshot(
      packName,
      packDescription,
      packArchetypeTags,
      packVisibility,
      cardsToSave,
    );

    if (packId && currentSnapshot === lastSavedSnapshotRef.current) {
      return packId;
    }

    setSaveStatus("saving");

    let actualPackId = packId;

    if (!actualPackId) {
      // First save creates the packs row and stores user ownership for RLS.
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
      // Existing save updates metadata; pack_cards are replaced below.
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

    const packCards = cardsToSave.map((card) => ({
      // Database pack_cards rows are one row per card id, with quantity.
      pack_id: actualPackId,
      card_id: card.id,
      quantity: card.quantity,
      manual_mechanic_bucket: card.manualMechanicBucket || null,
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
    onPackSaved?.({
      id: actualPackId,
      name: normalizePackName(packName),
      description: packDescription,
      archetypeTags: normalizeArchetypeTags(packArchetypeTags),
      visibility: normalizeVisibility(packVisibility),
      cards: cardsToSave,
    });
    setSaveStatus("saved");

    setTimeout(() => setSaveStatus(""), 2000);

    return actualPackId;
  }, [
    packArchetypeTags,
    packDescription,
    packVisibility,
    packName,
    onPackSaved,
    refreshPacks,
    selectedCards,
    user,
  ]);

  async function duplicatePack(packId) {
    // Creates a new packs row and copies pack_cards. It does not load the copy
    // into the active editor; the library refresh lets the user open it.
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
      .select("card_id, quantity, manual_mechanic_bucket")
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
      manual_mechanic_bucket: card.manual_mechanic_bucket || null,
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
    // Deletes the packs row. Foreign keys/RLS should handle dependent rows;
    // the UI callback removes the pack from any currently open cube summary.
    if (!packId) return;

    const { error } = await supabase.from("packs").delete().eq("id", packId);

    if (error) {
      console.error("Error deleting pack:", error);
      return;
    }

    onPackDeleted?.(packId);
    await refreshPacks?.();
    newPack();
  }

  function moveCard(draggedCardId, targetCardId) {
    // Reorders cards in the normal PackBox stack.
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

  async function savePack({
    promptOnRename = true,
    cardsOverride = selectedCards,
  } = {}) {
    /*
     * Public save entry point.
     *
     * promptOnRename: if true, renaming an existing pack asks whether to update
     * the existing pack or save a new copy.
     * cardsOverride: optional card array for immediate save-after-drop flows.
     */
    const cardsToSave = cardsOverride || selectedCards;

    if (cardsToSave.length === 0) return null;

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
          return finishSave(savedPackId, cardsToSave);
        },

        saveAsNew: async () => {
          setShowRenameChoice(false);
          return finishSave(null, cardsToSave);
        },
      }));

      return null;
    }

    return finishSave(savedPackId, cardsToSave);
  }

  function moveCardToMechanicBucket(cardId, bucketId) {
    // Persists the PackBox stats-view manual column assignment via autosave.
    if (!cardId || !bucketId) return;

    setSelectedCards((prev) =>
      prev.map((card) =>
        card.id === cardId
          ? { ...card, manualMechanicBucket: bucketId }
          : card,
      ),
    );
  }

  useEffect(() => {
    // Debounced autosave after any meaningful pack edit. The snapshot guard in
    // finishSave prevents repeat writes once the database is current.
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
    moveCardToMechanicBucket,
  };
}
