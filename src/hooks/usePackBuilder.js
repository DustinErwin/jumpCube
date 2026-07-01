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
import {
  DEFAULT_PACK_CARD_LIMIT,
  DEFAULT_PACK_FORMAT_ID,
  getPackFormat,
  PACK_FORMATS,
} from "../utils/packFormats";
import {
  buildPackCubeStats,
  normalizeStoredPackCubeStats,
} from "../utils/packCubeStats";
import { hydrateSavedCardRows } from "../services/cardHydrationService";

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

function getPackSnapshot(
  name,
  description,
  archetypeTags,
  visibility,
  cards,
  formatId = DEFAULT_PACK_FORMAT_ID,
  commanderId = null,
) {
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
    formatId: getPackFormat(formatId).id,
    commanderId,
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

function isBasicLand(card) {
  return /basic\s+land/i.test(card?.type_line || "");
}

function isCommanderEligible(card) {
  const typeLine = card?.type_line || "";
  const isLegendary = /\blegendary\b/i.test(typeLine);
  const isCreatureOrPlaneswalker =
    /\bcreature\b/i.test(typeLine) || /\bplaneswalker\b/i.test(typeLine);

  return isLegendary && isCreatureOrPlaneswalker;
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
    topCard?.image_uris?.normal ||
    topCard?.image_uris?.small ||
    topCard?.card_faces?.[0]?.image_uris?.normal ||
    topCard?.card_faces?.[0]?.image_uris?.small ||
    null
  );
}

function isMissingPackFormatColumnError(error) {
  const message = String(error?.message || error?.details || "");

  return (
    error?.code === "PGRST204" &&
    (message.includes("format_id") ||
      message.includes("commander_card_id") ||
      message.includes("color_identity") ||
      message.includes("color_percentages") ||
      message.includes("cube_stats"))
  );
}

function getPackFormatMigrationMessage(error) {
  if (!isMissingPackFormatColumnError(error)) return null;

  return "Pack formats need the latest database migration. Run 202606260002_add_pack_format_identity.sql, then refresh Supabase's schema cache if needed.";
}

function getPackCubeStatsMigrationMessage(error) {
  const message = String(error?.message || error?.details || "");

  if (
    error?.code !== "PGRST204" ||
    !(
      message.includes("color_identity") ||
      message.includes("color_percentages") ||
      message.includes("cube_stats")
    )
  ) {
    return null;
  }

  return "Pack cube stats need the latest database migration. Run 202606300001_add_pack_cube_stats_cache.sql, then refresh Supabase's schema cache if needed.";
}

function getPackCardSaveMigrationMessage(error) {
  const message = String(error?.message || "");

  if (
    error?.code === "42883" ||
    message.includes("replace_pack_cards")
  ) {
    return "Pack saving needs the latest database migration. Run 202607010001_replace_pack_cards_transaction.sql so card replacements are saved atomically.";
  }

  if (!message.includes("Pack cannot contain more than 20 cards")) return null;

  return "Commander packs need the latest pack format migration. Run 202606260002_add_pack_format_identity.sql so the database allows 30-card Commander packs.";
}

function getNextPackCards(cards, card, packFormat) {
  if (getPackCardCount(cards) >= packFormat.cardLimit) {
    return cards;
  }

  const cardIdentity = getPackCardIdentity(card);
  const existingCard = cards.find(
    (currentCard) => getPackCardIdentity(currentCard) === cardIdentity,
  );

  if (existingCard) {
    if (packFormat.singleton && !isBasicLand(existingCard)) {
      return cards;
    }

    return cards.map((currentCard) =>
      getPackCardIdentity(currentCard) === cardIdentity
        ? { ...currentCard, quantity: currentCard.quantity + 1 }
        : currentCard,
    );
  }

  return [...cards, { ...card, quantity: 1 }];
}

async function hydratePackCardRows(packCards) {
  // DISCONNECTED: legacy card_search/card_variants hydration. Saved pack rows
  // are now hydrated from Scryfall using variation_id as the Scryfall card id.
  try {
    const hydratedCards = await hydrateSavedCardRows(packCards, {
      includeManualMechanicBucket: true,
    });

    return hydratedCards.length > 0 || (packCards || []).length === 0
      ? hydratedCards
      : null;
  } catch (error) {
    console.error("Error hydrating pack cards from Scryfall:", error);
    return null;
  }
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
  const [packFormatId, setPackFormatId] = useState(DEFAULT_PACK_FORMAT_ID);
  const [commanderCardId, setCommanderCardId] = useState(null);
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
    // Adds one copy up to the active format limit. Singleton formats only
    // allow duplicate basic lands.
    if (!isPackActive) return;

    const packFormat = getPackFormat(packFormatId);
    const shouldFillCommanderSlot =
      packFormat.commanderSlot &&
      !commanderCardId &&
      canAddCardToPack(card) &&
      isCommanderEligible(card);

    setSelectedCards((prev) => {
      return getNextPackCards(prev, card, packFormat);
    });

    if (shouldFillCommanderSlot) {
      setCommanderCardId(card.id);
    }
  }

  function canAddCardToPack(card) {
    if (!isPackActive || !card) return false;

    const packFormat = getPackFormat(packFormatId);

    if (getPackCardCount(selectedCards) >= packFormat.cardLimit) return false;

    const cardIdentity = getPackCardIdentity(card);
    const existingCard = selectedCards.find(
      (selectedCard) => getPackCardIdentity(selectedCard) === cardIdentity,
    );

    if (existingCard && packFormat.singleton && !isBasicLand(existingCard)) {
      return false;
    }

    return true;
  }

  function getCommanderCard(cards = selectedCards) {
    return (
      cards.find((card) => card.id === commanderCardId) ||
      cards.find(isCommanderEligible) ||
      null
    );
  }

  function hasValidCommander(cards = selectedCards) {
    const packFormat = getPackFormat(packFormatId);

    if (!packFormat.commanderSlot) return true;

    return Boolean(getCommanderCard(cards));
  }

  function setCommanderCard(cardId) {
    const commanderCard = selectedCards.find((card) => card.id === cardId);

    if (!commanderCard || !isCommanderEligible(commanderCard)) return;

    setCommanderCardId(commanderCard.id);
  }

  function setPackFormat(nextFormatId) {
    const nextFormat = getPackFormat(nextFormatId);

    setPackFormatId(nextFormat.id);
    setSelectedCards((currentCards) => {
      const nextCards = [];

      currentCards.forEach((card) => {
        if (getPackCardCount(nextCards) >= nextFormat.cardLimit) return;

        const existingCard = nextCards.find(
          (nextCard) =>
            getPackCardIdentity(nextCard) === getPackCardIdentity(card),
        );

        if (existingCard && nextFormat.singleton && !isBasicLand(existingCard)) {
          return;
        }

        if (existingCard) {
          existingCard.quantity = Math.min(
            existingCard.quantity + card.quantity,
            nextFormat.cardLimit - getPackCardCount(nextCards) + existingCard.quantity,
          );
          return;
        }

        const quantity =
          nextFormat.singleton && !isBasicLand(card) ? 1 : card.quantity;

        nextCards.push({
          ...card,
          quantity: Math.min(
            quantity,
            nextFormat.cardLimit - getPackCardCount(nextCards),
          ),
        });
      });

      return nextCards.filter((card) => card.quantity > 0);
    });

    setCommanderCardId((currentCommanderId) => {
      if (!nextFormat.commanderSlot) return null;

      const commanderStillExists = selectedCards.some(
        (card) => card.id === currentCommanderId && isCommanderEligible(card),
      );

      if (commanderStillExists) return currentCommanderId;

      return selectedCards.find(isCommanderEligible)?.id || null;
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
      hydratedCards = null;
    }

    const selectedPackCards = hydratedCards || (packCards || []).map((row) => ({
      id: row.variation_id || row.variant_id || row.card_search_id || row.card_id,
      card_search_id: row.card_search_id || row.card_id || null,
      variant_id: row.variant_id || null,
      oracle_id: row.oracle_id || null,
      variation_id: row.variation_id || null,
      quantity: row.quantity,
      manualMechanicBucket: row.manual_mechanic_bucket || null,
    }));
    const packCubeStats =
      normalizeStoredPackCubeStats(pack.cube_stats) ||
      buildPackCubeStats(selectedPackCards);

    setIsPackActive(true);
    setPackName(normalizePackName(pack.name, DRAFT_PACK_NAME));
    setPackDescription(sanitizeDescription(pack.description));
    const relationalTags = await loadPackTagAssignments(pack.id);
    const loadedTags = relationalTags?.length
      ? relationalTags
      : pack.archetype_tags || pack.archetype_tag;

    setPackArchetypeTags(normalizeArchetypeTags(loadedTags));
    setPackVisibility(normalizeVisibility(pack.visibility));
    const loadedFormatId = getPackFormat(pack.format_id).id;
    const loadedCommanderCardId =
      loadedFormatId === DEFAULT_PACK_FORMAT_ID ? null : pack.commander_card_id;

    setPackFormatId(loadedFormatId);
    setCommanderCardId(loadedCommanderCardId);
    setSelectedCards(selectedPackCards);
    setSavedPackId(pack.id);
    setSavedPackName(pack.name || null);
    setIsEditingText(false);
    lastSavedSnapshotRef.current = getPackSnapshot(
      pack.name || DRAFT_PACK_NAME,
      sanitizeDescription(pack.description),
      loadedTags,
      pack.visibility,
      selectedPackCards,
      loadedFormatId,
      loadedCommanderCardId,
    );

    return {
      id: pack.id,
      savedPackId: pack.id,
      name: normalizePackName(pack.name, DRAFT_PACK_NAME),
      description: sanitizeDescription(pack.description),
      archetypeTags: normalizeArchetypeTags(loadedTags),
      coverImageUrl: pack.cover_image_url || getPackCoverImage(selectedPackCards),
      visibility: normalizeVisibility(pack.visibility),
      formatId: loadedFormatId,
      commanderCardId: loadedCommanderCardId,
      cardCount: getPackCardCount(selectedPackCards),
      colorIdentity: pack.color_identity || packCubeStats.colorIdentity,
      colorPercentages: pack.color_percentages || packCubeStats.colorPercentages,
      cubeStats: packCubeStats,
      cards: selectedPackCards,
      cardsHydrated: true,
    };
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

    if (commanderCardId === cardId) {
      setCommanderCardId(null);
    }
  }

  function removeCardFromPack(cardId) {
    setSelectedCards((prev) => prev.filter((card) => card.id !== cardId));

    if (commanderCardId === cardId) {
      setCommanderCardId(null);
    }
  }

  function newPack() {
    // Resets local editor state only. It does not delete anything in Supabase.
    setIsPackActive(true);
    setPackName(DRAFT_PACK_NAME);
    setPackDescription("");
    setPackArchetypeTags([]);
    setPackVisibility("private");
    setPackFormatId(DEFAULT_PACK_FORMAT_ID);
    setCommanderCardId(null);
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
    setPackFormatId(DEFAULT_PACK_FORMAT_ID);
    setCommanderCardId(null);
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

  function startPackFromCards(cards, name = DRAFT_PACK_NAME, options = {}) {
    const nextFormat = getPackFormat(options.formatId || DEFAULT_PACK_FORMAT_ID);
    const nextCommanderId =
      nextFormat.commanderSlot
          ? options.commanderCardId ||
          cards?.find(isCommanderEligible)?.id ||
          null
        : null;

    setIsPackActive(true);
    setPackName(normalizePackName(name, DRAFT_PACK_NAME));
    setPackDescription("");
    setPackArchetypeTags([]);
    setPackVisibility("private");
    setPackFormatId(nextFormat.id);
    setCommanderCardId(nextCommanderId);
    setSelectedCards(cards || []);
    setSavedPackId(null);
    setSavedPackName(null);
    setShowRenameChoice(false);
    setPendingSaveAction(null);
    setIsEditingText(false);
    lastSavedSnapshotRef.current = null;
    localStorage.removeItem("jumpCubeCurrentPack");
  }

  function openSavedPackFromSummary(packSummary) {
    if (!packSummary) return false;

    const nextCards = packSummary.cards || [];
    const nextFormatId = getPackFormat(packSummary.formatId).id;
    const nextCommanderCardId =
      nextFormatId === DEFAULT_PACK_FORMAT_ID
        ? null
        : packSummary.commanderCardId || null;
    const nextName = normalizePackName(packSummary.name, DRAFT_PACK_NAME);
    const nextDescription = sanitizeDescription(packSummary.description);
    const nextTags = normalizeArchetypeTags(
      packSummary.archetypeTags || packSummary.packTags || [],
    );
    const nextVisibility = normalizeVisibility(packSummary.visibility);

    setIsPackActive(true);
    setPackName(nextName);
    setPackDescription(nextDescription);
    setPackArchetypeTags(nextTags);
    setPackVisibility(nextVisibility);
    setPackFormatId(nextFormatId);
    setCommanderCardId(nextCommanderCardId);
    setSelectedCards(nextCards);
    setSavedPackId(packSummary.savedPackId || packSummary.id || null);
    setSavedPackName(packSummary.name || null);
    setShowRenameChoice(false);
    setPendingSaveAction(null);
    setIsEditingText(false);
    lastSavedSnapshotRef.current = getPackSnapshot(
      nextName,
      nextDescription,
      nextTags,
      nextVisibility,
      nextCards,
      nextFormatId,
      nextCommanderCardId,
    );
    localStorage.removeItem("jumpCubeCurrentPack");

    return true;
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
    const packFormat = getPackFormat(packFormatId);
    const packCubeStats = buildPackCubeStats(cardsToSave);

    if (packFormat.commanderSlot && !cardsToSave.some(isCommanderEligible)) {
      setSaveErrorMessage("Commander packs need one eligible commander.");
      setSaveStatus("error");
      return null;
    }

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
      packFormatId,
      commanderCardId,
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
    const isNewPackSave = !actualPackId;

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
          format_id: packFormat.id,
          commander_card_id: commanderCardId,
          color_identity: packCubeStats.colorIdentity,
          color_percentages: packCubeStats.colorPercentages,
          cube_stats: packCubeStats,
          user_id: user.id,
        })
        .select()
        .single();

      if (packError) {
        console.error("Error saving pack:", packError);
        setSaveErrorMessage(
          getPackCubeStatsMigrationMessage(packError) ||
          getPackFormatMigrationMessage(packError) ||
            packError.message ||
            "Pack could not be saved.",
        );
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
          format_id: packFormat.id,
          commander_card_id: commanderCardId,
          color_identity: packCubeStats.colorIdentity,
          color_percentages: packCubeStats.colorPercentages,
          cube_stats: packCubeStats,
        })
        .eq("id", actualPackId);

      if (updateError) {
        console.error("Error updating pack:", updateError);
        setSaveErrorMessage(
          getPackCubeStatsMigrationMessage(updateError) ||
          getPackFormatMigrationMessage(updateError) ||
            updateError.message ||
            "Pack could not be updated.",
        );
        setSaveStatus("error");
        return null;
      }
    }

    const packCards = cardsToSave.map((card) => ({
      card_id: null,
      card_search_id: null,
      variant_id: null,
      oracle_id: card.oracle_id || null,
      variation_id: card.variation_id || card.scryfall_id || null,
      quantity: card.quantity,
      manual_mechanic_bucket: card.manualMechanicBucket || null,
    }));

    const { error: cardsError } = await supabase.rpc("replace_pack_cards", {
      requested_pack_id: actualPackId,
      requested_cards: packCards,
    });

    if (cardsError) {
      console.error("Error saving pack cards:", cardsError);
      if (isNewPackSave) {
        await supabase.from("packs").delete().eq("id", actualPackId);
      }
      setSaveErrorMessage(
        getPackCardSaveMigrationMessage(cardsError) ||
          "Pack cards could not be saved.",
      );
      setSaveStatus("error");
      return null;
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
      formatId: packFormat.id,
      commanderCardId,
      cardCount: packCubeStats.cardCount,
      colorIdentity: packCubeStats.colorIdentity,
      colorPercentages: packCubeStats.colorPercentages,
      cubeStats: packCubeStats,
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
    packFormatId,
    commanderCardId,
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
        format_id: getPackFormat(originalPack.format_id).id,
        commander_card_id: originalPack.commander_card_id || null,
        color_identity: originalPack.color_identity || [],
        color_percentages: originalPack.color_percentages || {},
        cube_stats: originalPack.cube_stats || {},
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
      card_search_id: null,
      variant_id: null,
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
      packFormatId,
      commanderCardId,
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
    packFormatId,
    commanderCardId,
    savedPackId,
    selectedCards,
    user,
  ]);

  return {
    selectedCards,
    packFormatId,
    setPackFormat,
    packFormats: PACK_FORMATS,
    packCardLimit: getPackFormat(packFormatId).cardLimit,
    commanderCardId,
    commanderCard: getCommanderCard(),
    setCommanderCard,
    hasValidCommander: hasValidCommander(),
    isPackActive,
    isPackFull:
      !isPackActive ||
      getPackCardCount(selectedCards) >= getPackFormat(packFormatId).cardLimit,
    canAddCardToPack,
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
    openSavedPackFromSummary,
    savePack,
    loadPack,
    deletePack,
    duplicatePack,
    moveCard,
    moveCardToMechanicBucket,
  };
}
