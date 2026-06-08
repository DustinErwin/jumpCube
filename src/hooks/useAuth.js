import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";

/*
 * useAuth() centralizes Supabase auth state.
 *
 * Returns:
 * {
 *   session: Supabase session | null,
 *   user: Supabase user | null,
 *   authLoading: true until the initial session request completes
 * }
 */
export function useAuth() {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    async function getSession() {
      // Initial page load: recover an existing session from Supabase storage.
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        console.error("Error getting session:", error);
      }

      setSession(data.session);
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    }

    getSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      // Keeps React state aligned after login, logout, or token refresh.
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
      },
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  return {
    session,
    user,
    authLoading,
  };
}
