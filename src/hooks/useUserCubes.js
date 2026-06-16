import { useCallback, useEffect, useState } from "react";
import { supabase } from "../utils/supabase";
import { sanitizeDescription, sanitizeTitle } from "../utils/userText";
import { hasBlockedContentInFields } from "../utils/contentModeration";
import { normalizePackTags } from "../utils/packTags";

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

const CUBE_CARD_SEARCH_COLUMNS = `
  id,
  oracle_id,
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
  has_back_face
`;
const CUBE_CARD_VARIANT_COLUMNS = `
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
  is_variant_printing,
  is_planechase,
  set_name,
  set_code,
  collector_number,
  has_back_face
`;

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
    card_search_id: row.card_search_id || null,
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
    cardCount,
    colorIdentity,
    cards,
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
  const cardSearchIds = [
    ...new Set(packCards.map((row) => row.card_search_id).filter(Boolean)),
  ];
  const variantIds = [
    ...new Set(packCards.map((row) => row.variant_id).filter(Boolean)),
  ];

  const [searchResult, variantResult] = await Promise.all([
    cardSearchIds.length > 0
      ? supabase
          .from("card_search")
          .select(CUBE_CARD_SEARCH_COLUMNS)
          .in("id", cardSearchIds)
      : Promise.resolve({ data: [], error: null }),
    variantIds.length > 0
      ? supabase
          .from("card_variants")
          .select(CUBE_CARD_VARIANT_COLUMNS)
          .in("id", variantIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (searchResult.error) throw searchResult.error;
  if (variantResult.error) throw variantResult.error;

  const searchById = new Map((searchResult.data || []).map((card) => [card.id, card]));
  const variantById = new Map(
    (variantResult.data || []).map((variant) => [variant.id, variant]),
  );

  return (packCards || []).map((row) => {
    const searchCard = searchById.get(row.card_search_id);
    const variantCard = variantById.get(row.variant_id);
    return {
      ...(searchCard || {}),
      ...(variantCard || {}),
      id: row.variant_id || variantCard?.id || searchCard?.id,
      card_search_id: row.card_search_id || searchCard?.id || null,
      variant_id: row.variant_id || variantCard?.id || null,
      oracle_id: row.oracle_id || searchCard?.oracle_id || null,
      variation_id: row.variation_id || variantCard?.scryfall_id || null,
      scryfall_id: variantCard?.scryfall_id || null,
      quantity: row.quantity,
    };
  });
}

export function useUserCubes(user) {
  const [cubes, setCubes] = useState([]);
  const [loadingCubes, setLoadingCubes] = useState(false);
  const [cubeSaveError, setCubeSaveError] = useState("");

  const loadCubes = useCallback(async function loadCubes() {
    // Library list only needs cube metadata; individual cube opening hydrates
    // packs/cards separately in loadCube().
    if (!user) {
      setCubes([]);
      return;
    }

    setLoadingCubes(true);

    const { data, error } = await supabase
      .from("cubes")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading cubes:", error);
      setLoadingCubes(false);
      return;
    }

    setCubes(data || []);
    setLoadingCubes(false);
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

  async function loadPackSummaries(packIds) {
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
          cover_image_url,
          pack_cards (
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
    const hydratedPacks = await Promise.all(
      uniquePackIds.map(async (packId, position) => {
        const pack = packsById.get(packId);

        if (!pack) return null;

        const hydratedCards = await hydrateCubePackCards(pack.pack_cards || []);
        return buildPackSummary(
          { ...pack, packTags: tagsByPackId.get(pack.id) },
          position,
          hydratedCards,
        );
      }),
    );

    return hydratedPacks.filter(Boolean);
  }

  async function loadCube(cubeId) {
    // Hydrates one cube with its packs and cards for opening in JumpCubeBox.
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
            pack_cards (
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

    const hydratedPacks = await Promise.all(
      (cubePacks || [])
        .filter((row) => row.packs)
        .map(async (row) => {
          const hydratedCards = await hydrateCubePackCards(
            row.packs.pack_cards || [],
          );

          return buildPackSummary(
            {
              ...row.packs,
              packTags: tagsByPackId.get(row.packs.id),
            },
            row.position,
            hydratedCards,
          );
        }),
    );

    return {
      ...cube,
      packs: hydratedPacks,
    };
  }

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
    cubeSaveError,
    loadCubes,
    saveCube,
    loadCube,
    loadPackSummaries,
    deleteCube,
  };
}
