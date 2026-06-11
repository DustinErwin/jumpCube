import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";

const PENDING_SIGNUP_USERNAME_KEY = "jumpCubePendingSignupUsername";
const USERNAME_PATTERN = /^[A-Za-z0-9]{3,31}$/;

/*
 * useAuth() centralizes Supabase auth state.
 *
 * Returns:
 * {
 *   session: Supabase session | null,
 *   user: Supabase user | null,
 *   profile: public.profiles row | null,
 *   displayName: username/email fallback for signed-in UI,
 *   authLoading: true until the initial session request completes
 *   profileLoading: true while the current user's profile is being checked
 * }
 */
export function useAuth() {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    let isCurrent = true;

    async function claimPendingSignupUsername(authUser, currentProfile) {
      if (typeof window === "undefined") return currentProfile;

      const pendingUsername = window.localStorage.getItem(
        PENDING_SIGNUP_USERNAME_KEY,
      );

      if (!pendingUsername) return currentProfile;

      if (!USERNAME_PATTERN.test(pendingUsername)) {
        window.localStorage.removeItem(PENDING_SIGNUP_USERNAME_KEY);
        return currentProfile;
      }

      if (currentProfile?.username === pendingUsername) {
        window.localStorage.removeItem(PENDING_SIGNUP_USERNAME_KEY);
        return currentProfile;
      }

      const { data: isUsernameAvailable, error: availabilityError } =
        await supabase.rpc("is_username_available", {
          requested_username: pendingUsername,
        });

      if (availabilityError || !isUsernameAvailable) {
        if (availabilityError) {
          console.error("Error checking pending username:", availabilityError);
        }

        window.localStorage.removeItem(PENDING_SIGNUP_USERNAME_KEY);
        return currentProfile;
      }

      const { data, error } = await supabase
        .from("profiles")
        .upsert(
          {
            id: authUser.id,
            username: pendingUsername,
          },
          {
            onConflict: "id",
          },
        )
        .select("id, username")
        .single();

      if (error) {
        console.error("Error saving pending username:", error);
        return currentProfile;
      }

      window.localStorage.removeItem(PENDING_SIGNUP_USERNAME_KEY);
      return data;
    }

    async function loadProfile(authUser) {
      setProfileLoading(Boolean(authUser));

      if (!authUser) {
        setProfile(null);
        setProfileLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("id, username")
        .eq("id", authUser.id)
        .maybeSingle();

      if (!isCurrent) return;

      if (error) {
        console.error("Error loading profile:", error);
        setProfile(null);
        setProfileLoading(false);
        return;
      }

      const nextProfile = await claimPendingSignupUsername(authUser, data);

      if (!isCurrent) return;

      setProfile(nextProfile);
      setProfileLoading(false);
    }

    function applySession(nextSession) {
      const nextUser = nextSession?.user ?? null;

      setSession(nextSession);
      setUser(nextUser);
      loadProfile(nextUser);
    }

    async function getSession() {
      // Initial page load: recover an existing session from Supabase storage.
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        console.error("Error getting session:", error);
      }

      applySession(data.session);

      if (isCurrent) {
        setAuthLoading(false);
      }
    }

    getSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      // Keeps React state aligned after login, logout, or token refresh.
      (_event, session) => {
        applySession(session);
      },
    );

    return () => {
      isCurrent = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const displayName =
    profile?.username ||
    user?.user_metadata?.username ||
    user?.user_metadata?.preferred_username ||
    user?.email ||
    "";

  return {
    session,
    user,
    profile,
    displayName,
    authLoading,
    profileLoading,
    setProfile,
  };
}
