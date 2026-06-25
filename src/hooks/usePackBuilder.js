import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../utils/supabase";
import {
  sanitizeDescription,
  sanitizeTitle,
} from "../utils/userText";
import {
  formatPackTagName,
  normalizePackTagName,
  normalizePackTags,
  PACK_TAG_LIMIT,
} from "../utils/packTags";
import { hasBlockedContentInFields } from "../utils/contentModeration";
import { DEFAULT_PACK_CARD_LIMIT } from "../utils/packFormats";

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

export const PACK_CARD_LIMIT = DEFAULT_PACK_CARD_LIMIT;
export const DRAFT_PACK_NAME = "Draft Pack";
// Update this list when adding/removing archetype options in PackBox.
export const PACK_ARCHETYPE_TAGS = [
  "Aggro",
  "Midrange",
  "Control",
  "Tempo",
  "Combo",
  "Ramp",
];
const PACK_CARD_SEARCH_COLUMNS = `
  id,
  oracle_id,
  default_variant_id,
  default_variant_scryfall_id,
  name,
  mana_value,
  mana_cost,
  colors,
  color_identity,
  type_line,
  oracle_text,
  legalities,
  games,
  nonfoil,
  is_token,
  is_funny,
  is_variant_printing,
  is_planechase,
  image_url,
  back_image_url,
  image_uris,
  card_faces,
  price_usd,
  price_usd_foil,
  price_usd_etched,
  has_back_face
`;
const PACK_CARD_VARIANT_COLUMNS = `
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
  prices,
  price_usd,
  price_usd_foil,
  price_usd_etched,
  games,
  nonfoil,
  is_token,
  is_funny,
  is_variant_printing,
  is_planechase,
  set_name,
  set_code,
  collector_number,
  has_back_face
`;

function normalizePackName(name, fallback = "Unnamed Pack") {
  return sanitizeTitle(name, fallback);
}

function normalizeArchetypeTags(tags) {
  return normalizePackTags(tags);
}

function getLegacyArchetypeTagNames(tags) {
  return normalizeArchetypeTags(tags)
    .map((tag) => tag.name)
    .filter((name) => PACK_ARCHETYPE_TAGS.includes(name));
}

const FALLBACK_PACK_TAGS = normalizePackTags(PACK_ARCHETYPE_TAGS, Infinity);

async function loadPackTagAssignments(packId) {
  const { data, error } = await supabase
    .from("pack_tags")
    .select("tag:tags(id, name, normalized_name, color)")
    .eq("pack_id", packId);

  if (error) return null;

  return normalizePackTags((data || []).map((row) => row.tag));
}

async function savePackTagAssignments(packId, tags) {
  const selectedTags = normalizePackTags(tags).filter((tag) => tag.id);
  const { error: deleteError } = await supabase
    .from("pack_tags")
    .delete()
    .eq("pack_id", packId);

  if (deleteError) throw deleteError;
  if (selectedTags.length === 0) return;

  const { error: insertError } = await supabase.from("pack_tags").insert(
    selectedTags.map((tag) => ({ pack_id: packId, tag_id: tag.id })),
  );

  if (insertError) throw insertError;
}

function normalizeVisibility(visibility) {
  return visibility === "public" ? "public" : "private";
}

function getPackSnapshot(name, description, archetypeTags, visibility, cards) {
  // Snapshot is compared before autosave to avoid writing the same pack in a
  // loop. Include any new saved pack field here if it should trigger autosave.
  return JSON.stringify({
    name: normalizePackName(name),
    description: sanitizeDescription(description),
    archetypeTags: normalizeArchetypeTags(archetypeTags).map((tag) => ({
      name: tag.normalizedName,
      color: tag.color,
    })),
    visibility: normalizeVisibility(visibility),
    cards: cards.map((card) => ({
      id: card.id,
      oracleId: card.oracle_id || null,
      variationId: card.variation_id || card.scryfall_id || null,
      quantity: card.quantity,
      manualMechanicBucket: card.manualMechanicBucket || null,
    })),
  });
}

function getPackCardCount(cards) {
  return cards.reduce((sum, card) => sum + card.quantity, 0);
}

function getPackCardIdentity(card) {
  return String(
    card?.oracle_id ||
      card?.card_search_id ||
      card?.name ||
      card?.variant_id ||
      card?.id ||
      "",
  );
}

function getPackCoverImage(cards) {
  const topCard = cards[cards.length - 1];

  return (
    topCard?.image_url ||
    topCard?.image_uris?.art_crop ||
    topCard?.image_uris?.normal ||
    null
  );
}

function mergeHydratedCard(searchCard, variantCard) {
  return {
    ...(searchCard || {}),
    ...(variantCard || {}),
    price_usd: variantCard?.price_usd ?? searchCard?.price_usd ?? null,
    price_usd_foil:
      variantCard?.price_usd_foil ?? searchCard?.price_usd_foil ?? null,
    price_usd_etched:
      variantCard?.price_usd_etched ?? searchCard?.price_usd_etched ?? null,
  };
}

async function hydratePackCardRows(packCards) {
  const getCardSearchId = (row) => row.card_search_id || row.card_id || null;
  const cardSearchIds = [
    ...new Set(packCards.map(getCardSearchId).filter(Boolean)),
  ];
  const variantIds = [
    ...new Set(packCards.map((row) => row.variant_id).filter(Boolean)),
  ];
  const variantScryfallIds = [
    ...new Set(
      packCards
        .filter((row) => !row.variant_id)
        .map((row) => row.variation_id)
        .filter(Boolean),
    ),
  ];

  const [searchResult, variantResult, variantByScryfallResult] = await Promise.all([
    cardSearchIds.length > 0
      ? supabase
          .from("card_search")
          .select(PACK_CARD_SEARCH_COLUMNS)
          .in("id", cardSearchIds)
      : Promise.resolve({ data: [], error: null }),
    variantIds.length > 0
      ? supabase
          .from("card_variants")
          .select(PACK_CARD_VARIANT_COLUMNS)
          .in("id", variantIds)
      : Promise.resolve({ data: [], error: null }),
    variantScryfallIds.length > 0
      ? supabase
          .from("card_variants")
          .select(PACK_CARD_VARIANT_COLUMNS)
          .in("scryfall_id", variantScryfallIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (searchResult.error) {
    throw searchResult.error;
  }

  if (variantResult.error) {
    throw variantResult.error;
  }

  if (variantByScryfallResult.error) {
    throw variantByScryfallResult.error;
  }

  const searchById = new Map((searchResult.data || []).map((card) => [card.id, card]));
  const variantById = new Map(
    (variantResult.data || []).map((variant) => [variant.id, variant]),
  );
  const variantByScryfallId = new Map(
    (variantByScryfallResult.data || []).map((variant) => [
      variant.scryfall_id,
      variant,
    ]),
  );
  (variantByScryfallResult.data || []).forEach((variant) => {
    variantById.set(variant.id, variant);
  });
  const fallbackVariantIds = [
    ...new Set(
      (packCards || [])
        .filter((row) => !row.variant_id)
        .map((row) => searchById.get(getCardSearchId(row))?.default_variant_id)
        .filter(Boolean),
    ),
  ];

  if (fallbackVariantIds.length > 0) {
    const { data, error } = await supabase
      .from("card_variants")
      .select(PACK_CARD_VARIANT_COLUMNS)
      .in("id", fallbackVariantIds);

    if (error) throw error;

    (data || []).forEach((variant) => {
      variantById.set(variant.id, variant);
    });
  }

  return (packCards || []).map((row) => {
    const cardSearchId = getCardSearchId(row);
    const searchCard = searchById.get(cardSearchId);
    const fallbackVariantId = searchCard?.default_variant_id || null;
    const variantCard =
      variantById.get(row.variant_id) ||
      variantByScryfallId.get(row.variation_id) ||
      variantById.get(fallbackVariantId);
    return {
      ...mergeHydratedCard(searchCard, variantCard),
      id: row.variant_id || variantCard?.id || searchCard?.id,
      card_search_id: cardSearchId || searchCard?.id || null,
      variant_id: row.variant_id || variantCard?.id || fallbackVariantId,
      oracle_id: row.oracle_id || searchCard?.oracle_id || variantCard?.oracle_id || null,
      variation_id: row.variation_id || variantCard?.scryfall_id || null,
      scryfall_id:
        variantCard?.scryfall_id ||
        searchCard?.default_variant_scryfall_id ||
        null,
      quantity: row.quantity,
      manualMechanicBucket: row.manual_mechanic_bucket || null,
    };
  });
}

export function usePackBuilder(user, refreshPacks, {
  onPackSaved,
  onPackDeleted,
} = {}) {
  const [selectedCards, setSelectedCards] = useState([]);
  const [isPackActive, setIsPackActive] = useState(false);
  const [packName, setPackName] = useState(DRAFT_PACK_NAME);
  const [packDescription, setPackDescription] = useState("");
  const [packArchetypeTags, setPackArchetypeTags] = useState([]);
  const [availablePackTags, setAvailablePackTags] = useState(FALLBACK_PACK_TAGS);
  const [packVisibility, setPackVisibility] = useState("private");
  const [savedPackId, setSavedPackId] = useState(null);
  const [savedPackName, setSavedPackName] = useState(null);
  const [saveStatus, setSaveStatus] = useState("");
  const [saveErrorMessage, setSaveErrorMessage] = useState("");
  const [showRenameChoice, setShowRenameChoice] = useState(false);
  const [pendingSaveAction, setPendingSaveAction] = useState(null);
  const [isEditingText, setIsEditingText] = useState(false);
  const lastSavedSnapshotRef = useRef(null);

  const loadAvailablePackTags = useCallback(async function loadAvailablePackTags() {
    const { data, error } = await supabase
      .from("tags")
      .select("id, name, normalized_name, color, usage_count")
      .order("usage_count", { ascending: false })
      .order("name", { ascending: true });

    if (error) {
      setAvailablePackTags(FALLBACK_PACK_TAGS);
      return FALLBACK_PACK_TAGS;
    }

    const normalizedTags = normalizePackTags(
      [...(data || []), ...FALLBACK_PACK_TAGS],
      Infinity,
    );
    setAvailablePackTags(normalizedTags);
    return normalizedTags;
  }, []);

  const createPackTag = useCallback(async function createPackTag(name, color) {
    if (!user?.id) return null;

    const formattedName = formatPackTagName(name);
    const normalizedName = normalizePackTagName(formattedName);
    const existingTag = availablePackTags.find(
      (tag) => tag.normalizedName === normalizedName,
    );

    if (existingTag) return existingTag;

    const { data, error } = await supabase
      .from("tags")
      .insert({
        name: formattedName,
        normalized_name: normalizedName,
        color,
        created_by: user.id,
      })
      .select("id, name, normalized_name, color, usage_count")
      .single();

    if (error) {
      if (error.code === "23505") {
        const { data: existingData, error: existingError } = await supabase
          .from("tags")
          .select("id, name, normalized_name, color, usage_count")
          .eq("normalized_name", normalizedName)
          .single();

        if (!existingError && existingData) {
          const [existingDatabaseTag] = normalizePackTags([existingData]);
          setAvailablePackTags((currentTags) =>
            normalizePackTags(
              [existingDatabaseTag, ...currentTags],
              Infinity,
            ),
          );
          return existingDatabaseTag;
        }
      }

      console.error("Error creating tag:", error);
      return {
        error:
          error.code === "42P01"
            ? "Tag storage is not configured yet. Apply the tag migration."
            : "Tag could not be created. Please try again.",
      };
    }

    const [createdTag] = normalizePackTags([data]);
    setAvailablePackTags((currentTags) =>
      normalizePackTags([createdTag, ...currentTags], Infinity),
    );
    return createdTag;
  }, [availablePackTags, user]);

  function addCardToPack(card) {
    // Adds one copy, up to PACK_CARD_LIMIT. Existing copies increment quantity
    // instead of duplicating rows in selectedCards.
    if (!isPackActive) return;

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

  const loadPack = useCallback(async function loadPack(packId) {
    // Loads pack metadata first, then hydrates pack_cards through v2 card
    // identity/variant relationships.
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
      card_id,
      card_search_id,
      variant_id,
      quantity,
      oracle_id,
      variation_id,
      manual_mechanic_bucket
    `,
      )
      .eq("pack_id", packId);

    if (cardsError) {
      console.error("Error loading pack cards:", cardsError);
      return;
    }

    let hydratedCards;

    try {
      hydratedCards = await hydratePackCardRows(packCards || []);
    } catch (hydrateError) {
      console.error("Error hydrating v2 pack cards:", hydrateError);
      return;
    }

    setIsPackActive(true);
    setPackName(normalizePackName(pack.name, DRAFT_PACK_NAME));
    setPackDescription(sanitizeDescription(pack.description));
    const relationalTags = await loadPackTagAssignments(pack.id);
    const loadedTags = relationalTags?.length
      ? relationalTags
      : pack.archetype_tags || pack.archetype_tag;

    setPackArchetypeTags(normalizeArchetypeTags(loadedTags));
    setPackVisibility(normalizeVisibility(pack.visibility));
    setSelectedCards(hydratedCards);
    setSavedPackId(pack.id);
    setSavedPackName(pack.name || null);
    setIsEditingText(false);
    lastSavedSnapshotRef.current = getPackSnapshot(
      pack.name || DRAFT_PACK_NAME,
      sanitizeDescription(pack.description),
      loadedTags,
      pack.visibility,
      hydratedCards,
    );
  }, []);

  function decreaseCardQuantity(cardId) {
    // Removes one copy and drops the card entirely when quantity reaches zero.
    setSelectedCards((prev) => {
      const targetCard =
        prev.find((card) => card.id === cardId) ||
        prev.find((card) => getPackCardIdentity(card) === String(cardId));

      if (!targetCard) return prev;

      return prev
        .map((card) =>
          card.id === targetCard.id
            ? { ...card, quantity: card.quantity - 1 }
            : card,
        )
        .filter((card) => card.quantity > 0);
    });
  }

  function removeCardFromPack(cardId) {
    setSelectedCards((prev) => prev.filter((card) => card.id !== cardId));
  }

  function newPack() {
    // Resets local editor state only. It does not delete anything in Supabase.
    setIsPackActive(true);
    setPackName(DRAFT_PACK_NAME);
    setPackDescription("");
    setPackArchetypeTags([]);
    setPackVisibility("private");
    setSelectedCards([]);
    setSavedPackId(null);
    setSavedPackName(null);
    setShowRenameChoice(false);
    setPendingSaveAction(null);
    setIsEditingText(false);
    lastSavedSnapshotRef.current = null;
    localStorage.removeItem("jumpCubeCurrentPack");
  }

  const clearActivePack = useCallback(function clearActivePack() {
    setIsPackActive(false);
    setPackName(DRAFT_PACK_NAME);
    setPackDescription("");
    setPackArchetypeTags([]);
    setPackVisibility("private");
    setSelectedCards([]);
    setSavedPackId(null);
    setSavedPackName(null);
    setSaveStatus("");
    setSaveErrorMessage("");
    setShowRenameChoice(false);
    setPendingSaveAction(null);
    setIsEditingText(false);
    lastSavedSnapshotRef.current = null;
    localStorage.removeItem("jumpCubeCurrentPack");
  }, []);

  function startPackFromCards(cards, name = DRAFT_PACK_NAME) {
    setIsPackActive(true);
    setPackName(normalizePackName(name, DRAFT_PACK_NAME));
    setPackDescription("");
    setPackArchetypeTags([]);
    setPackVisibility("private");
    setSelectedCards(cards || []);
    setSavedPackId(null);
    setSavedPackName(null);
    setShowRenameChoice(false);
    setPendingSaveAction(null);
    setIsEditingText(false);
    lastSavedSnapshotRef.current = null;
    localStorage.removeItem("jumpCubeCurrentPack");
  }

  const finishSave = useCallback(async function finishSave(
    packId,
    cardsOverride = selectedCards,
    { nameOverride = null } = {},
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
      setSaveErrorMessage("Sign in before saving this pack.");
      setSaveStatus("error");
      return null;
    }

    const effectivePackName = nameOverride || packName;

    if (hasBlockedContentInFields(effectivePackName, packDescription)) {
      setSaveErrorMessage("");
      setSaveStatus("blocked");
      return null;
    }

    const cardsToSave = cardsOverride || selectedCards;
    const tagsToSave = normalizeArchetypeTags(packArchetypeTags).map(
      (tag) =>
        availablePackTags.find(
          (availableTag) =>
            availableTag.normalizedName === tag.normalizedName && availableTag.id,
        ) || tag,
    );

    const currentSnapshot = getPackSnapshot(
      effectivePackName,
      packDescription,
      packArchetypeTags,
      packVisibility,
      cardsToSave,
    );

    if (packId && currentSnapshot === lastSavedSnapshotRef.current) {
      try {
        await savePackTagAssignments(packId, tagsToSave);
      } catch (tagError) {
        console.error("Error saving pack tags:", tagError);
        setSaveErrorMessage("Pack saved, but its tags could not be updated.");
        setSaveStatus("error");
      }
      return packId;
    }

    setSaveStatus("saving");
    setSaveErrorMessage("");

    let actualPackId = packId;

    if (!actualPackId) {
      // First save creates the packs row and stores user ownership for RLS.
      const { data: pack, error: packError } = await supabase
        .from("packs")
        .insert({
          name: normalizePackName(effectivePackName),
          description: sanitizeDescription(packDescription),
          archetype_tags: getLegacyArchetypeTagNames(tagsToSave),
          cover_image_url: getPackCoverImage(cardsToSave),
          visibility: normalizeVisibility(packVisibility),
          user_id: user.id,
        })
        .select()
        .single();

      if (packError) {
        console.error("Error saving pack:", packError);
        setSaveErrorMessage(packError.message || "Pack could not be saved.");
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
          name: normalizePackName(effectivePackName),
          description: sanitizeDescription(packDescription),
          archetype_tags: getLegacyArchetypeTagNames(tagsToSave),
          cover_image_url: getPackCoverImage(cardsToSave),
          visibility: normalizeVisibility(packVisibility),
        })
        .eq("id", actualPackId);

      if (updateError) {
        console.error("Error updating pack:", updateError);
        setSaveErrorMessage(updateError.message || "Pack could not be updated.");
        setSaveStatus("error");
        return null;
      }
    }

    const packCards = cardsToSave.map((card) => ({
      pack_id: actualPackId,
      card_id: null,
      card_search_id: card.card_search_id || null,
      variant_id: card.variant_id || null,
      oracle_id: card.oracle_id || null,
      variation_id: card.variation_id || card.scryfall_id || null,
      quantity: card.quantity,
      manual_mechanic_bucket: card.manualMechanicBucket || null,
    }));

    const { error: deleteCardsError } = await supabase
      .from("pack_cards")
      .delete()
      .eq("pack_id", actualPackId);

    if (deleteCardsError) {
      console.error("Error clearing pack cards:", deleteCardsError);
      setSaveErrorMessage("Pack cards could not be updated.");
      setSaveStatus("error");
      return null;
    }

    if (packCards.length > 0) {
      const { error: cardsError } = await supabase
        .from("pack_cards")
        .insert(packCards);

      if (cardsError) {
        console.error("Error saving pack cards:", cardsError);
        setSaveErrorMessage("Pack cards could not be saved.");
        setSaveStatus("error");
        return null;
      }
    }

    try {
      await savePackTagAssignments(actualPackId, tagsToSave);
    } catch (tagError) {
      console.error("Error saving pack tags:", tagError);
      setSaveErrorMessage("Pack saved, but its tags could not be updated.");
      setSaveStatus("error");
      return null;
    }

    setPackName(normalizePackName(effectivePackName));
    setSavedPackName(normalizePackName(effectivePackName));
    lastSavedSnapshotRef.current = currentSnapshot;
    await refreshPacks?.();
    onPackSaved?.({
      id: actualPackId,
      name: normalizePackName(effectivePackName),
      description: sanitizeDescription(packDescription),
      archetypeTags: tagsToSave,
      coverImageUrl: getPackCoverImage(cardsToSave),
      visibility: normalizeVisibility(packVisibility),
      cards: cardsToSave,
    });
    setSaveStatus("saved");

    setTimeout(() => setSaveStatus(""), 2000);

    return actualPackId;
  }, [
    packArchetypeTags,
    availablePackTags,
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
      .select(
        "card_search_id, variant_id, oracle_id, variation_id, quantity, manual_mechanic_bucket",
      )
      .eq("pack_id", packId);

    if (cardsError) {
      console.error("Error loading pack cards to duplicate:", cardsError);
      return;
    }

    const { data: newPack, error: newPackError } = await supabase
      .from("packs")
      .insert({
        name: normalizePackName(`${originalPack.name} Copy`),
        description: sanitizeDescription(originalPack.description),
        archetype_tags: normalizeArchetypeTags(
          originalPack.archetype_tags || originalPack.archetype_tag,
        )
          .map((tag) => tag.name)
          .filter((name) => PACK_ARCHETYPE_TAGS.includes(name)),
        visibility: normalizeVisibility(originalPack.visibility),
        cover_image_url: originalPack.cover_image_url || null,
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
      card_id: null,
      card_search_id: card.card_search_id || null,
      variant_id: card.variant_id || null,
      oracle_id: card.oracle_id || null,
      variation_id: card.variation_id || null,
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

    const originalTags = await loadPackTagAssignments(packId);
    try {
      await savePackTagAssignments(newPack.id, originalTags || []);
    } catch (tagError) {
      console.error("Error copying pack tags:", tagError);
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

    if (savedPackId === packId) {
      clearActivePack();
    }
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
    nameOverride = null,
  } = {}) {
    /*
     * Public save entry point.
     *
     * promptOnRename: if true, renaming an existing pack asks whether to update
     * the existing pack or save a new copy.
     * cardsOverride: optional card array for immediate save-after-drop flows.
     */
    const cardsToSave = cardsOverride || selectedCards;

    if (!isPackActive) return null;
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
          return finishSave(savedPackId, cardsToSave, { nameOverride });
        },

        saveAsNew: async () => {
          setShowRenameChoice(false);
          return finishSave(null, cardsToSave, { nameOverride });
        },
      }));

      return null;
    }

    return finishSave(savedPackId, cardsToSave, { nameOverride });
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
    const timeoutId = window.setTimeout(loadAvailablePackTags, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadAvailablePackTags]);

  useEffect(() => {
    // Debounced autosave after any meaningful pack edit. The snapshot guard in
    // finishSave prevents repeat writes once the database is current.
    if (!user?.id) return undefined;
    if (!isPackActive) return undefined;
    if (selectedCards.length === 0 && !savedPackId) return undefined;
    if (isEditingText) return undefined;

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
    isPackActive,
    isEditingText,
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
    packCardLimit: PACK_CARD_LIMIT,
    isPackActive,
    isPackFull:
      !isPackActive || getPackCardCount(selectedCards) >= PACK_CARD_LIMIT,
    setSelectedCards,
    packName,
    setPackName,
    packDescription,
    setPackDescription,
    packArchetypeTags,
    setPackArchetypeTags,
    availablePackTags,
    createPackTag,
    packTagLimit: PACK_TAG_LIMIT,
    packVisibility,
    setPackVisibility,
    savedPackId,
    setSavedPackId,
    savedPackName,
    setSavedPackName,
    saveStatus,
    saveErrorMessage,
    showRenameChoice,
    pendingSaveAction,
    setIsEditingText,
    addCardToPack,
    decreaseCardQuantity,
    removeCardFromPack,
    newPack,
    clearActivePack,
    startPackFromCards,
    savePack,
    loadPack,
    deletePack,
    duplicatePack,
    moveCard,
    moveCardToMechanicBucket,
  };
}
