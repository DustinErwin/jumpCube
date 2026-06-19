import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";
import {
  getStoredBasicLandSetCode,
  setStoredBasicLandSetCode,
} from "../utils/basicLandPreferences";

const PENDING_SIGNUP_USERNAME_KEY = "jumpCubePendingSignupUsername";
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,31}$/;
const PROFILE_COLUMNS = "id, username, basic_land_set_code";
const FALLBACK_PROFILE_COLUMNS = "id, username";

function isMissingBasicLandSetColumnError(error) {
  return (
    error?.code === "42703" ||
    String(error?.message || "").includes("basic_land_set_code")
  );
}

function applyStoredProfileSettings(profile) {
  if (!profile) return profile;

  if (profile.basic_land_set_code) {
    setStoredBasicLandSetCode(profile.basic_land_set_code);
    return profile;
  }

  const storedBasicLandSetCode = getStoredBasicLandSetCode();

  if (!storedBasicLandSetCode) return profile;

  return {
    ...profile,
    basic_land_set_code: storedBasicLandSetCode,
  };
}

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
 *   isAdmin/adminLoading: database-backed admin status for privileged pages
 * }
 */
export function useAuth() {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminLoading, setAdminLoading] = useState(true);

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
        .select(PROFILE_COLUMNS)
        .single();

      if (error) {
        if (isMissingBasicLandSetColumnError(error)) {
          const { data: fallbackData, error: fallbackError } = await supabase
            .from("profiles")
            .select(FALLBACK_PROFILE_COLUMNS)
            .eq("id", authUser.id)
            .maybeSingle();

          if (!fallbackError) {
            window.localStorage.removeItem(PENDING_SIGNUP_USERNAME_KEY);
            return applyStoredProfileSettings(fallbackData);
          }
        }

        console.error("Error saving pending username:", error);
        return currentProfile;
      }

      window.localStorage.removeItem(PENDING_SIGNUP_USERNAME_KEY);
      return applyStoredProfileSettings(data);
    }

    async function loadProfile(authUser) {
      setProfileLoading(Boolean(authUser));

      if (!authUser) {
        setProfile(null);
        setProfileLoading(false);
        return;
      }

      let { data, error } = await supabase
        .from("profiles")
        .select(PROFILE_COLUMNS)
        .eq("id", authUser.id)
        .maybeSingle();

      if (error && isMissingBasicLandSetColumnError(error)) {
        const fallbackResult = await supabase
          .from("profiles")
          .select(FALLBACK_PROFILE_COLUMNS)
          .eq("id", authUser.id)
          .maybeSingle();

        data = fallbackResult.data;
        error = fallbackResult.error;
      }

      if (!isCurrent) return;

      if (error) {
        console.error("Error loading profile:", error);
        setProfile(null);
        setProfileLoading(false);
        return;
      }

      const nextProfile = await claimPendingSignupUsername(
        authUser,
        applyStoredProfileSettings(data),
      );

      if (!isCurrent) return;

      setProfile(applyStoredProfileSettings(nextProfile));
      setProfileLoading(false);
    }

    async function loadAdminStatus(authUser) {
      setAdminLoading(Boolean(authUser));

      if (!authUser) {
        setIsAdmin(false);
        setAdminLoading(false);
        return;
      }

      const { data, error } = await supabase.rpc("is_current_user_admin");

      if (!isCurrent) return;

      if (error) {
        console.error("Error loading admin status:", error);
        setIsAdmin(false);
        setAdminLoading(false);
        return;
      }

      setIsAdmin(Boolean(data));
      setAdminLoading(false);
    }

    function applySession(nextSession) {
      const nextUser = nextSession?.user ?? null;

      setSession(nextSession);
      setUser(nextUser);
      loadProfile(nextUser);
      loadAdminStatus(nextUser);
    }

    async function recoverStoredSession({ clearWhenMissing = true } = {}) {
      // Initial page load: recover an existing session from Supabase storage.
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        console.error("Error getting session:", error);
        if (isCurrent) {
          setAuthLoading(false);
        }
        return;
      }

      if (data.session) {
        const { data: refreshData, error: refreshError } =
          await supabase.auth.refreshSession();

        if (!isCurrent) return;

        if (refreshError) {
          console.error("Error refreshing session:", refreshError);
          applySession(data.session);
        } else {
          applySession(refreshData.session || data.session);
        }
      } else if (clearWhenMissing) {
        applySession(null);
      }

      if (isCurrent) {
        setAuthLoading(false);
      }
    }

    function recoverSessionAfterResume() {
      if (document.visibilityState === "hidden") return;

      recoverStoredSession({ clearWhenMissing: false });
    }

    recoverStoredSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      // Keeps React state aligned after login, logout, or token refresh.
      (_event, session) => {
        applySession(session);
      },
    );

    window.addEventListener("focus", recoverSessionAfterResume);
    window.addEventListener("pageshow", recoverSessionAfterResume);
    document.addEventListener("visibilitychange", recoverSessionAfterResume);

    return () => {
      isCurrent = false;
      window.removeEventListener("focus", recoverSessionAfterResume);
      window.removeEventListener("pageshow", recoverSessionAfterResume);
      document.removeEventListener(
        "visibilitychange",
        recoverSessionAfterResume,
      );
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
    isAdmin,
    adminLoading,
    setProfile,
  };
}
