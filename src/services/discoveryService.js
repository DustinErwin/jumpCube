import { supabase } from "../utils/supabase";
import { normalizePackTags } from "../utils/packTags";
import { getPackFormat } from "../utils/packFormats";
import { normalizeStoredPackCubeStats } from "../utils/packCubeStats";
import { hydrateSavedCardRows } from "./cardHydrationService";

function getCardImage(card) {
  return card?.image_url || card?.image_uris?.normal || card?.image_uris?.small || null;
}

async function hydratePublicPacks(packs) {
  const packIds = packs.map((pack) => pack.id);
  const userIds = [...new Set(packs.map((pack) => pack.user_id).filter(Boolean))];

  const [cardRowsResult, tagRowsResult, profilesResult] = await Promise.all([
    packIds.length
      ? supabase
          .from("pack_cards")
          .select("pack_id, card_search_id, variant_id, oracle_id, variation_id, quantity, manual_mechanic_bucket")
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
  const profiles = new Map((profilesResult.data || []).map((profile) => [profile.id, profile.username]));
  const tagsByPack = new Map();

  (tagRowsResult.data || []).forEach((row) => {
    tagsByPack.set(row.pack_id, [...(tagsByPack.get(row.pack_id) || []), row.tag]);
  });

  return Promise.all(packs.map(async (pack) => {
    const packCards = cardRows.filter((row) => row.pack_id === pack.id);
    const hydratedCards = await hydrateSavedCardRows(packCards, {
      includeManualMechanicBucket: true,
    });
    const cubeStats = normalizeStoredPackCubeStats(pack.cube_stats);
    const topCard = hydratedCards[hydratedCards.length - 1] || hydratedCards[0];

    return {
      ...pack,
      type: "pack",
      ownerName: profiles.get(pack.user_id) || "Jump Cube user",
      cardCount: packCards.reduce((sum, row) => sum + (row.quantity || 1), 0),
      imageUrl: pack.cover_image_url || getCardImage(topCard),
      formatId: getPackFormat(pack.format_id).id,
      commanderCardId: pack.commander_card_id || null,
      colorIdentity: cubeStats?.colorIdentity || pack.color_identity || [],
      colorPercentages: cubeStats?.colorPercentages || pack.color_percentages || {},
      cubeStats,
      tags: normalizePackTags(tagsByPack.get(pack.id) || pack.archetype_tags || []),
      cards: hydratedCards,
    };
  }));
}

async function summarizePublicPacks(packs) {
  const packIds = packs.map((pack) => pack.id);
  const userIds = [...new Set(packs.map((pack) => pack.user_id).filter(Boolean))];

  const [cardRowsResult, tagRowsResult, profilesResult] = await Promise.all([
    packIds.length
      ? supabase
          .from("pack_cards")
          .select("pack_id, quantity")
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
  if (tagRowsResult.error) throw tagRowsResult.error;
  if (profilesResult.error) throw profilesResult.error;

  const cardCountsByPack = new Map();
  const profiles = new Map((profilesResult.data || []).map((profile) => [profile.id, profile.username]));
  const tagsByPack = new Map();

  (cardRowsResult.data || []).forEach((row) => {
    cardCountsByPack.set(
      row.pack_id,
      (cardCountsByPack.get(row.pack_id) || 0) + (row.quantity || 1),
    );
  });

  (tagRowsResult.data || []).forEach((row) => {
    tagsByPack.set(row.pack_id, [...(tagsByPack.get(row.pack_id) || []), row.tag]);
  });

  return packs.map((pack) => {
    const cubeStats = normalizeStoredPackCubeStats(pack.cube_stats);

    return {
      ...pack,
      type: "pack",
      ownerName: profiles.get(pack.user_id) || "Jump Cube user",
      cardCount: cubeStats?.cardCount || cardCountsByPack.get(pack.id) || 0,
      imageUrl: pack.cover_image_url || null,
      formatId: getPackFormat(pack.format_id).id,
      commanderCardId: pack.commander_card_id || null,
      colorIdentity: cubeStats?.colorIdentity || pack.color_identity || [],
      colorPercentages: cubeStats?.colorPercentages || pack.color_percentages || {},
      cubeStats,
      tags: normalizePackTags(tagsByPack.get(pack.id) || pack.archetype_tags || []),
      cards: [],
    };
  });
}

export async function loadPublicLibrary() {
  const [packsResult, cubesResult] = await Promise.all([
    supabase
      .from("packs")
      .select("id, user_id, name, description, visibility, archetype_tags, cover_image_url, format_id, commander_card_id, color_identity, color_percentages, cube_stats, created_at")
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
        .select("id, user_id, name, description, visibility, archetype_tags, cover_image_url, format_id, commander_card_id, color_identity, color_percentages, cube_stats, created_at")
        .in("id", missingPackIds)
    : { data: [], error: null };

  if (missingPacksError) throw missingPacksError;

  const allPackSummaries = await summarizePublicPacks([...listedPacks, ...(missingPacks || [])]);
  const packs = allPackSummaries.filter((pack) => listedPackIds.has(pack.id));

  const packById = new Map(allPackSummaries.map((pack) => [pack.id, pack]));
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

export async function loadPublicPack(packId) {
  const { data: pack, error } = await supabase
    .from("packs")
    .select("id, user_id, name, description, visibility, archetype_tags, cover_image_url, format_id, commander_card_id, color_identity, color_percentages, cube_stats, created_at")
    .eq("id", packId)
    .single();

  if (error) throw error;

  const [hydratedPack] = await hydratePublicPacks([pack]);
  return hydratedPack || null;
}

export async function loadPublicCube(cubeId) {
  const { data: cube, error } = await supabase
    .from("cubes")
    .select("id, user_id, name, description, visibility, cover_image_url, created_at")
    .eq("id", cubeId)
    .single();

  if (error) throw error;

  const { data: cubePackRows, error: cubePackError } = await supabase
    .from("cube_packs")
    .select("pack_id, position")
    .eq("cube_id", cubeId)
    .order("position", { ascending: true });

  if (cubePackError) throw cubePackError;

  const packIds = (cubePackRows || []).map((row) => row.pack_id);
  const { data: packRows, error: packsError } = packIds.length
    ? await supabase
        .from("packs")
        .select("id, user_id, name, description, visibility, archetype_tags, cover_image_url, format_id, commander_card_id, color_identity, color_percentages, cube_stats, created_at")
        .in("id", packIds)
    : { data: [], error: null };

  if (packsError) throw packsError;

  const summarizedPacks = await summarizePublicPacks(packRows || []);
  const packsById = new Map(summarizedPacks.map((pack) => [pack.id, pack]));
  const { data: owners } = cube.user_id
    ? await supabase.rpc("get_public_usernames", { requested_user_ids: [cube.user_id] })
    : { data: [] };

  return {
    ...cube,
    type: "cube",
    ownerName: owners?.[0]?.username || "Jump Cube user",
    packCount: packIds.length,
    packs: packIds.map((packId) => packsById.get(packId)).filter(Boolean),
    imageUrl: cube.cover_image_url || summarizedPacks[0]?.imageUrl || null,
  };
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
