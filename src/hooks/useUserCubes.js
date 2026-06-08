import { useCallback, useEffect, useState } from "react";
import { supabase } from "../utils/supabase";

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

const CUBE_CARD_COLUMNS = `
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

function buildPackSummary(pack, position = 0) {
  /*
   * Converts the nested Supabase join shape into the pack item shape expected
   * by JumpCubeBox:
   * {
   *   id/savedPackId, name, description, archetypeTags, visibility,
   *   cardCount, colorIdentity, cards, position
   * }
   */
  const cards = (pack.pack_cards || []).map((row) => ({
    ...row.cards,
    quantity: row.quantity,
  }));
  const cardCount = cards.reduce((sum, card) => sum + card.quantity, 0);
  const colorIdentity = [
    ...new Set(cards.flatMap((card) => card.color_identity || [])),
  ];

  return {
    id: pack.id,
    savedPackId: pack.id,
    name: pack.name || "Unnamed Pack",
    description: pack.description || "",
    archetypeTags: pack.archetype_tags || [],
    visibility: pack.visibility || "private",
    cardCount,
    colorIdentity,
    cards,
    position,
  };
}

export function useUserCubes(user) {
  const [cubes, setCubes] = useState([]);
  const [loadingCubes, setLoadingCubes] = useState(false);

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
    packs,
  }) {
    /*
     * Saves cube metadata and replaces cube_packs relationships.
     *
     * packs: Array of selected pack summaries. Each item must have either
     * savedPackId or id pointing at a saved packs row.
     */
    if (!user?.id || (!cubeId && packs.length === 0)) return null;

    let actualCubeId = cubeId;

    if (!actualCubeId) {
      const { data: cube, error: cubeError } = await supabase
        .from("cubes")
        .insert({
          name,
          description,
          user_id: user.id,
        })
        .select()
        .single();

      if (cubeError) {
        console.error("Error saving cube:", cubeError);
        return null;
      }

      actualCubeId = cube.id;
    } else {
      const { error: updateError } = await supabase
        .from("cubes")
        .update({
          name,
          description,
        })
        .eq("id", actualCubeId);

      if (updateError) {
        console.error("Error updating cube:", updateError);
        return null;
      }
    }

    const { error: deleteError } = await supabase
      // Replace relationships instead of diffing; position is the array index.
      .from("cube_packs")
      .delete()
      .eq("cube_id", actualCubeId);

    if (deleteError) {
      console.error("Error clearing cube packs:", deleteError);
      return null;
    }

    const cubePacks = packs
      .map((pack, index) => ({
        cube_id: actualCubeId,
        pack_id: pack.savedPackId || pack.id,
        position: index,
      }))
      .filter((cubePack) => cubePack.pack_id);

    if (cubePacks.length > 0) {
      const { error: insertError } = await supabase
        .from("cube_packs")
        .insert(cubePacks);

      if (insertError) {
        console.error("Error saving cube packs:", insertError);
        return null;
      }
    }

    await loadCubes();

    return actualCubeId;
  }, [loadCubes, user]);

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
              quantity,
              cards (${CUBE_CARD_COLUMNS})
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

    return {
      ...cube,
      packs: (cubePacks || [])
        .filter((row) => row.packs)
        .map((row) => buildPackSummary(row.packs, row.position)),
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
    loadCubes,
    saveCube,
    loadCube,
    deleteCube,
  };
}
