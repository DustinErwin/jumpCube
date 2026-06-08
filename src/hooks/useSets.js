import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";

/*
 * useSets() loads the curated set list used by FilterBox.
 *
 * The database controls which sets appear through is_standard_set_filter.
 * To add/remove sets from the UI without code changes, update that column in
 * the sets table.
 */
export function useSets() {
  const [sets, setSets] = useState([]);
  const [loadingSets, setLoadingSets] = useState(false);
  const [setsError, setSetsError] = useState(null);

  useEffect(() => {
    async function loadSets() {
      setLoadingSets(true);
      setSetsError(null);

      const { data, error } = await supabase
        // Keep selected columns narrow; FilterBox only needs label, code, date,
        // icon, and set type for display/grouping.
        .from("sets")
        .select("set_code, name, released_at, icon_svg_uri, set_type")
        .eq("is_standard_set_filter", true)
        .order("released_at", { ascending: false });

      if (error) {
        console.error("Error loading sets:", error);
        setSetsError(error);
        setLoadingSets(false);
        return;
      }

      setSets(data || []);
      setLoadingSets(false);
    }

    loadSets();
  }, []);

  return {
    sets,
    loadingSets,
    setsError,
  };
}
