import { useCallback, useEffect, useState } from "react";
import { supabase } from "../utils/supabase";
import { normalizePackTags } from "../utils/packTags";

/*
 * useUserPacks() loads the current user's saved pack library.
 *
 * Argument:
 * - user: Supabase auth user. When null, the local pack list is cleared.
 *
 * Returns:
 * { packs, loadingPacks, loadPacks }
 */
export function useUserPacks(user) {
  const [packs, setPacks] = useState([]);
  const [loadingPacks, setLoadingPacks] = useState(false);

  const loadPacks = useCallback(async function loadPacks() {
    // This is intentionally metadata-only; opening a pack hydrates card rows in
    // usePackBuilder.loadPack().
    if (!user) {
      setPacks([]);
      return;
    }

    setLoadingPacks(true);

    const { data, error } = await supabase
      .from("packs")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading packs:", error);
      setLoadingPacks(false);
      return;
    }

    const loadedPacks = data || [];
    const packIds = loadedPacks.map((pack) => pack.id);
    let tagsByPackId = new Map();

    if (packIds.length > 0) {
      const { data: packTagRows, error: packTagsError } = await supabase
        .from("pack_tags")
        .select("pack_id, tag:tags(id, name, normalized_name, color, usage_count)")
        .in("pack_id", packIds);

      if (!packTagsError) {
        tagsByPackId = (packTagRows || []).reduce((tagsByPack, row) => {
          const currentTags = tagsByPack.get(row.pack_id) || [];
          tagsByPack.set(row.pack_id, [...currentTags, row.tag]);
          return tagsByPack;
        }, new Map());
      }
    }

    setPacks(
      loadedPacks.map((pack) => ({
        ...pack,
        packTags: normalizePackTags(
          tagsByPackId.get(pack.id) || pack.archetype_tags || pack.archetype_tag,
        ),
      })),
    );
    setLoadingPacks(false);
  }, [user]);

  useEffect(() => {
    // Defer initial load to avoid racing with the auth hook during login/logout.
    const timeoutId = window.setTimeout(() => {
      loadPacks();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadPacks]);

  return {
    packs,
    loadingPacks,
    loadPacks,
  };
}
