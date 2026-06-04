import { useCallback, useEffect, useState } from "react";
import { supabase } from "../utils/supabase";

function buildPackSummary(pack, position = 0) {
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
            pack_cards (
              quantity,
              cards (*)
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
    if (!cubeId) return;

    const { error } = await supabase.from("cubes").delete().eq("id", cubeId);

    if (error) {
      console.error("Error deleting cube:", error);
      return;
    }

    await loadCubes();
  }

  useEffect(() => {
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
