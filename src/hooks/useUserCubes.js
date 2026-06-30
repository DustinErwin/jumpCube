import { useCallback, useEffect, useState } from "react";
import { supabase } from "../utils/supabase";
import { sanitizeDescription, sanitizeTitle } from "../utils/userText";
import { hasBlockedContentInFields } from "../utils/contentModeration";
import { normalizePackTags } from "../utils/packTags";
import { getPackFormat } from "../utils/packFormats";
import { hydrateSavedCardRows } from "../services/cardHydrationService";

/*
 * useUserCubes() is the database boundary for cube library operations.
 *
 * Argument:
 * - user: Supabase auth user. When null, cube state is cleared.
 *
 * Returns:
 * {
 *   cubes: lightweight cube rows for the library modal,
 *   loadingCubes,
 *   loadCubes(),
 *   saveCube({ cubeId, name, description, packs }),
 *   loadCube(cubeId),
 *   deleteCube(cubeId)
 * }
 */

function buildPackSummary(pack, position = 0, hydratedCards = null) {
  /*
   * Converts the nested Supabase join shape into the pack item shape expected
   * by JumpCubeBox:
   * {
   *   id/savedPackId, name, description, archetypeTags, visibility,
   *   cardCount, colorIdentity, cards, position
   * }
   */
  const cards = hydratedCards || (pack.pack_cards || []).map((row) => ({
    id: row.variation_id || row.variant_id || row.card_search_id || row.card_id,
    card_search_id: row.card_search_id || row.card_id || null,
    variant_id: row.variant_id || null,
    oracle_id: row.oracle_id || null,
    variation_id: row.variation_id || null,
    quantity: row.quantity,
  }));
  const cardCount = cards.reduce((sum, card) => sum + card.quantity, 0);
  const colorIdentity = [
    ...new Set(cards.flatMap((card) => card.color_identity || [])),
  ];

  return {
    id: pack.id,
    savedPackId: pack.id,
    name: sanitizeTitle(pack.name, "Unnamed Pack"),
    description: sanitizeDescription(pack.description),
    archetypeTags: normalizePackTags(
      pack.packTags || pack.archetype_tags || [],
    ),
    visibility: pack.visibility || "private",
    formatId: getPackFormat(pack.format_id).id,
    commanderCardId: pack.commander_card_id || null,
    cardCount,
    colorIdentity,
    cards,
    cardsHydrated: Boolean(hydratedCards),
    position,
  };
}

async function loadPackTagsByPackId(packIds) {
  const uniquePackIds = [...new Set((packIds || []).filter(Boolean))];

  if (uniquePackIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("pack_tags")
    .select("pack_id, tag:tags(id, name, normalized_name, color, usage_count)")
    .in("pack_id", uniquePackIds);

  if (error) {
    console.error("Error loading cube pack tags:", error);
    return new Map();
  }

  return (data || []).reduce((tagsByPackId, row) => {
    const currentTags = tagsByPackId.get(row.pack_id) || [];
    tagsByPackId.set(row.pack_id, [...currentTags, row.tag]);
    return tagsByPackId;
  }, new Map());
}

async function hydrateCubePackCards(packCards) {
  // DISCONNECTED: legacy card_search/card_variants hydration. Cube and pack
  // summaries now hydrate card facts from Scryfall by saved variation_id.
  try {
    const hydratedCards = await hydrateSavedCardRows(packCards);

    return hydratedCards.length > 0 || (packCards || []).length === 0
      ? hydratedCards
      : null;
  } catch (error) {
    console.error("Error hydrating cube pack cards from Scryfall:", error);
    return null;
  }
}

export function useUserCubes(user) {
  const [cubes, setCubes] = useState([]);
  const [loadingCubes, setLoadingCubes] = useState(false);
  const [cubesLoaded, setCubesLoaded] = useState(false);
  const [cubesLoadedUserId, setCubesLoadedUserId] = useState(null);
  const [cubeSaveError, setCubeSaveError] = useState("");

  const loadCubes = useCallback(async function loadCubes() {
    // Library list only needs cube metadata; individual cube opening hydrates
    // packs/cards separately in loadCube().
    if (!user) {
      setCubes([]);
      setCubesLoaded(true);
      setCubesLoadedUserId(null);
      return;
    }

    setLoadingCubes(true);
    setCubesLoaded(false);
    setCubesLoadedUserId(null);

    const { data, error } = await supabase
      .from("cubes")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading cubes:", error);
      setLoadingCubes(false);
      setCubesLoaded(true);
      setCubesLoadedUserId(user.id);
      return;
    }

    setCubes(data || []);
    setLoadingCubes(false);
    setCubesLoaded(true);
    setCubesLoadedUserId(user.id);
  }, [user]);

  const saveCube = useCallback(async function saveCube({
    cubeId,
    name,
    description,
    visibility = "private",
    coverImageUrl = null,
    packs,
  }) {
    /*
     * Saves cube metadata and replaces cube_packs relationships.
     *
     * packs: Array of selected pack summaries. Each item must have either
     * savedPackId or id pointing at a saved packs row.
     */
    if (
      !user?.id ||
      (!cubeId && packs.length === 0) ||
      hasBlockedContentInFields(name, description)
    ) {
      return null;
    }

    setCubeSaveError("");
    const packIds = packs
      .map((pack) => pack.savedPackId || pack.id)
      .filter(Boolean);
    const { data: actualCubeId, error: saveError } = await supabase.rpc(
      "save_user_cube",
      {
        requested_cube_id: cubeId,
        requested_name: sanitizeTitle(name, "Unnamed Cube"),
        requested_description: sanitizeDescription(description),
        requested_visibility: visibility === "public" ? "public" : "private",
        requested_cover_image_url: coverImageUrl,
        requested_pack_ids: packIds,
      },
    );

    if (saveError) {
      console.error("Error saving cube transaction:", saveError);
      setCubeSaveError(
        saveError.code === "42883"
          ? "Cube saving needs the latest database migration."
          : saveError.message || "Cube could not be saved.",
      );
      return null;
    }

    await loadCubes();

    return actualCubeId;
  }, [loadCubes, user]);

  const loadPackSummaries = useCallback(async function loadPackSummaries(
    packIds,
    { hydrateCards = false } = {},
  ) {
    const uniquePackIds = [...new Set((packIds || []).filter(Boolean))];

    if (uniquePackIds.length === 0) return [];

    const { data: packRows, error: packsError } = await supabase
      .from("packs")
      .select(
        `
          id,
          name,
          description,
          archetype_tags,
          visibility,
          format_id,
          commander_card_id,
          cover_image_url,
          pack_cards (
            card_id,
            card_search_id,
            variant_id,
            quantity,
            oracle_id,
            variation_id
          )
        `,
      )
      .in("id", uniquePackIds);

    if (packsError) {
      console.error("Error loading packs for cube:", packsError);
      return [];
    }

    const packsById = new Map((packRows || []).map((pack) => [pack.id, pack]));
    const tagsByPackId = await loadPackTagsByPackId(uniquePackIds);
    const loadedPacks = await Promise.all(
      uniquePackIds.map(async (packId, position) => {
        const pack = packsById.get(packId);

        if (!pack) return null;

        const hydratedCards = hydrateCards
          ? await hydrateCubePackCards(pack.pack_cards || [])
          : null;

        return buildPackSummary(
          { ...pack, packTags: tagsByPackId.get(pack.id) },
          position,
          hydratedCards,
        );
      }),
    );

    return loadedPacks.filter(Boolean);
  }, []);

  const loadCube = useCallback(async function loadCube(cubeId) {
    // Loads one cube with lightweight pack summaries. Individual pack cards
    // hydrate lazily only when a pack is opened or a print workflow needs them.
    const { data: cube, error: cubeError } = await supabase
      .from("cubes")
      .select("*")
      .eq("id", cubeId)
      .single();

    if (cubeError) {
      console.error("Error loading cube:", cubeError);
      return null;
    }

    const { data: cubePacks, error: packsError } = await supabase
      .from("cube_packs")
      .select(
        `
          position,
          packs (
            id,
            name,
            description,
            archetype_tags,
            visibility,
            format_id,
            commander_card_id,
            pack_cards (
              card_id,
              card_search_id,
              variant_id,
              quantity,
              oracle_id,
              variation_id
            )
          )
        `,
      )
      .eq("cube_id", cubeId)
      .order("position", { ascending: true });

    if (packsError) {
      console.error("Error loading cube packs:", packsError);
      return null;
    }

    const tagsByPackId = await loadPackTagsByPackId(
      (cubePacks || []).map((row) => row.packs?.id),
    );

    const loadedPacks = (cubePacks || [])
      .filter((row) => row.packs)
      .map((row) =>
        buildPackSummary(
          {
            ...row.packs,
            packTags: tagsByPackId.get(row.packs.id),
          },
          row.position,
        ),
    );

    return {
      ...cube,
      packs: loadedPacks,
    };
  }, []);

  async function deleteCube(cubeId) {
    // Deletes only the cube. Packs remain in the user's pack library.
    if (!cubeId) return;

    const { error } = await supabase.from("cubes").delete().eq("id", cubeId);

    if (error) {
      console.error("Error deleting cube:", error);
      return;
    }

    await loadCubes();
  }

  useEffect(() => {
    // Defer initial load one tick so auth/user changes settle before querying.
    const timeoutId = window.setTimeout(() => {
      loadCubes();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadCubes]);

  return {
    cubes,
    loadingCubes,
    cubesLoaded,
    cubesLoadedUserId,
    cubeSaveError,
    loadCubes,
    saveCube,
    loadCube,
    loadPackSummaries,
    deleteCube,
  };
}
