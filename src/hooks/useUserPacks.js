import { useCallback, useEffect, useState } from "react";
import { supabase } from "../utils/supabase";

export function useUserPacks(user) {
  const [packs, setPacks] = useState([]);
  const [loadingPacks, setLoadingPacks] = useState(false);

  const loadPacks = useCallback(async function loadPacks() {
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

    setPacks(data || []);
    setLoadingPacks(false);
  }, [user]);

  useEffect(() => {
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
