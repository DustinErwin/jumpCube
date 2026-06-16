import { supabase } from "../utils/supabase";
import { normalizePackTags } from "../utils/packTags";

function getCardImage(card) {
  return card?.image_url || card?.image_uris?.art_crop || card?.image_uris?.normal || null;
}

async function hydratePublicPacks(packs) {
  const packIds = packs.map((pack) => pack.id);
  const userIds = [...new Set(packs.map((pack) => pack.user_id).filter(Boolean))];

  const [cardRowsResult, tagRowsResult, profilesResult] = await Promise.all([
    packIds.length
      ? supabase
          .from("pack_cards")
          .select("pack_id, card_search_id, variant_id, quantity")
          .in("pack_id", packIds)
      : Promise.resolve({ data: [], error: null }),
    packIds.length
      ? supabase
          .from("pack_tags")
          .select("pack_id, tag:tags(id, name, normalized_name, color, usage_count)")
          .in("pack_id", packIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase.rpc("get_public_usernames", { requested_user_ids: userIds })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (cardRowsResult.error) throw cardRowsResult.error;

  const cardRows = cardRowsResult.data || [];
  const cardSearchIds = [...new Set(cardRows.map((row) => row.card_search_id).filter(Boolean))];
  const variantIds = [...new Set(cardRows.map((row) => row.variant_id).filter(Boolean))];
  const [searchCardsResult, variantsResult] = await Promise.all([
    cardSearchIds.length
      ? supabase.from("card_search").select("id, name, image_url, image_uris").in("id", cardSearchIds)
      : Promise.resolve({ data: [], error: null }),
    variantIds.length
      ? supabase.from("card_variants").select("id, name, image_url, image_uris").in("id", variantIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (searchCardsResult.error) throw searchCardsResult.error;
  if (variantsResult.error) throw variantsResult.error;

  const searchCards = new Map((searchCardsResult.data || []).map((card) => [card.id, card]));
  const variants = new Map((variantsResult.data || []).map((card) => [card.id, card]));
  const profiles = new Map((profilesResult.data || []).map((profile) => [profile.id, profile.username]));
  const tagsByPack = new Map();

  (tagRowsResult.data || []).forEach((row) => {
    tagsByPack.set(row.pack_id, [...(tagsByPack.get(row.pack_id) || []), row.tag]);
  });

  return packs.map((pack) => {
    const packCards = cardRows.filter((row) => row.pack_id === pack.id);
    const topRow = packCards[packCards.length - 1] || packCards[0];
    const topCard = topRow
      ? variants.get(topRow.variant_id) || searchCards.get(topRow.card_search_id)
      : null;

    return {
      ...pack,
      type: "pack",
      ownerName: profiles.get(pack.user_id) || "Jump Cube user",
      cardCount: packCards.reduce((sum, row) => sum + (row.quantity || 1), 0),
      imageUrl: pack.cover_image_url || getCardImage(topCard),
      tags: normalizePackTags(tagsByPack.get(pack.id) || pack.archetype_tags || []),
    };
  });
}

export async function loadPublicLibrary() {
  const [packsResult, cubesResult] = await Promise.all([
    supabase
      .from("packs")
      .select("id, user_id, name, description, visibility, archetype_tags, cover_image_url, created_at")
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("cubes")
      .select("id, user_id, name, description, visibility, cover_image_url, created_at")
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (packsResult.error) throw packsResult.error;
  if (cubesResult.error) throw cubesResult.error;

  const cubeIds = (cubesResult.data || []).map((cube) => cube.id);
  const { data: cubePackRows, error: cubePackError } = cubeIds.length
    ? await supabase
        .from("cube_packs")
        .select("cube_id, pack_id, position")
        .in("cube_id", cubeIds)
        .order("position", { ascending: true })
    : { data: [], error: null };

  if (cubePackError) throw cubePackError;

  const listedPacks = packsResult.data || [];
  const listedPackIds = new Set(listedPacks.map((pack) => pack.id));
  const missingPackIds = [...new Set(
    (cubePackRows || [])
      .map((row) => row.pack_id)
      .filter((packId) => !listedPackIds.has(packId)),
  )];
  const { data: missingPacks, error: missingPacksError } = missingPackIds.length
    ? await supabase
        .from("packs")
        .select("id, user_id, name, description, visibility, archetype_tags, cover_image_url, created_at")
        .in("id", missingPackIds)
    : { data: [], error: null };

  if (missingPacksError) throw missingPacksError;

  const allHydratedPacks = await hydratePublicPacks([...listedPacks, ...(missingPacks || [])]);
  const packs = allHydratedPacks.filter((pack) => listedPackIds.has(pack.id));

  const packById = new Map(allHydratedPacks.map((pack) => [pack.id, pack]));
  const ownerIds = [...new Set((cubesResult.data || []).map((cube) => cube.user_id).filter(Boolean))];
  const { data: cubeOwners } = ownerIds.length
    ? await supabase.rpc("get_public_usernames", { requested_user_ids: ownerIds })
    : { data: [] };
  const ownerById = new Map((cubeOwners || []).map((profile) => [profile.id, profile.username]));

  const cubes = (cubesResult.data || []).map((cube) => {
    const cubePacks = (cubePackRows || [])
      .filter((row) => row.cube_id === cube.id)
      .map((row) => packById.get(row.pack_id))
      .filter(Boolean);

    return {
      ...cube,
      type: "cube",
      ownerName: ownerById.get(cube.user_id) || "Jump Cube user",
      packCount: cubePacks.length,
      packs: cubePacks,
      imageUrl: cube.cover_image_url || cubePacks[0]?.imageUrl || null,
    };
  });

  return { packs, cubes };
}

export async function copyPublicPack(packId, userId) {
  const { data, error } = await supabase.rpc("copy_public_pack", {
    source_pack_id: packId,
    destination_user_id: userId,
  });

  if (error) throw error;
  return data;
}

export async function copyPublicCube(cubeId, userId) {
  const { data, error } = await supabase.rpc("copy_public_cube", {
    source_cube_id: cubeId,
    destination_user_id: userId,
  });

  if (error) throw error;
  return data;
}
