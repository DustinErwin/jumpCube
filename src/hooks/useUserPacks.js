import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";

export function useUserPacks(user) {
  const [packs, setPacks] = useState([]);
  const [loadingPacks, setLoadingPacks] = useState(false);

  async function loadPacks() {
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
  }

  useEffect(() => {
    loadPacks();
  }, [user]);

  return {
    packs,
    loadingPacks,
    loadPacks,
  };
}
