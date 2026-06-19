import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../utils/supabase";
import { getContentModerationMessage } from "../../utils/contentModeration";
import {
  getStoredBasicLandSetCode,
  normalizeBasicLandSetCode,
  setStoredBasicLandSetCode,
} from "../../utils/basicLandPreferences";
import "./ProfilePage.css";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,31}$/;
const PROFILE_COLUMNS = "id, username, basic_land_set_code";
const FALLBACK_PROFILE_COLUMNS = "id, username";

function isMissingBasicLandSetColumnError(error) {
  return (
    error?.code === "42703" ||
    String(error?.message || "").includes("basic_land_set_code")
  );
}

/*
 * ProfilePage lets signed-in users update app-owned profile fields.
 *
 * Email remains read-only because Supabase Auth owns auth.users.email.
 */
export default function ProfilePage({
  user,
  profile,
  profileLoading,
  sets = [],
  onProfileSaved,
  onLogout,
}) {
  const navigate = useNavigate();
  const [username, setUsername] = useState(profile?.username || "");
  const [basicLandSetCode, setBasicLandSetCode] = useState(
    normalizeBasicLandSetCode(
      profile?.basic_land_set_code || getStoredBasicLandSetCode(),
    ),
  );
  const [saveStatus, setSaveStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const usernameModerationMessage = getContentModerationMessage(username);
  const basicLandSetOptions = useMemo(() => {
    const optionsByCode = new Map();

    sets.forEach((set) => {
      const setCode = normalizeBasicLandSetCode(set.set_code);

      if (!setCode) return;

      optionsByCode.set(setCode, {
        code: setCode,
        name: set.name,
        releasedAt: set.released_at,
      });
    });

    const sortedOptions = [...optionsByCode.values()].sort((setA, setB) =>
      setA.name.localeCompare(setB.name),
    );

    return [
      {
        code: "",
        name: "Default basics: Battle for Zendikar and Oath of the Gatewatch",
      },
      ...sortedOptions,
    ];
  }, [sets]);

  async function saveProfile(event) {
    event.preventDefault();

    const trimmedUsername = username.trim();
    setSaveStatus("");
    setErrorMessage("");

    if (!USERNAME_PATTERN.test(trimmedUsername)) {
      setErrorMessage("Usernames must be 3-31 letters, numbers, or underscores.");
      return;
    }

    if (usernameModerationMessage) {
      setErrorMessage(usernameModerationMessage);
      return;
    }

    if (profile?.username?.toLowerCase() !== trimmedUsername.toLowerCase()) {
      const { data: isUsernameAvailable, error: availabilityError } =
        await supabase.rpc("is_username_available", {
          requested_username: trimmedUsername,
        });

      if (availabilityError) {
        setErrorMessage("Could not check that username. Please try again.");
        return;
      }

      if (!isUsernameAvailable) {
        setErrorMessage("That username is already taken.");
        return;
      }
    }

    setIsSaving(true);

    let { data, error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          username: trimmedUsername,
          basic_land_set_code: basicLandSetCode || null,
        },
        {
          onConflict: "id",
        },
      )
      .select(PROFILE_COLUMNS)
      .single();

    if (error && isMissingBasicLandSetColumnError(error)) {
      const fallbackResult = await supabase
        .from("profiles")
        .upsert(
          {
            id: user.id,
            username: trimmedUsername,
          },
          {
            onConflict: "id",
          },
        )
        .select(FALLBACK_PROFILE_COLUMNS)
        .single();

      data = fallbackResult.data
        ? {
            ...fallbackResult.data,
            basic_land_set_code: basicLandSetCode || null,
          }
        : fallbackResult.data;
      error = fallbackResult.error;
    }

    setIsSaving(false);

    if (error) {
      setErrorMessage("Could not save your profile. Please try again.");
      return;
    }

    setStoredBasicLandSetCode(basicLandSetCode);
    onProfileSaved(data);
    setSaveStatus("Profile saved.");
  }

  async function logOut() {
    await onLogout();
    navigate("/");
  }

  return (
    <main className="profilePage" onClick={() => navigate("/")}>
      <section
        className="profilePanel"
        onClick={(event) => event.stopPropagation()}
      >
        <h1>Profile</h1>

        <form className="profileForm" onSubmit={saveProfile}>
          <label>
            Username
            <input
              type="text"
              value={username}
              aria-invalid={Boolean(usernameModerationMessage)}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              minLength={3}
              maxLength={31}
              pattern="[A-Za-z0-9_]+"
              disabled={profileLoading || isSaving}
              required
            />
            {usernameModerationMessage && (
              <span className="profileError" role="alert">
                {usernameModerationMessage}
              </span>
            )}
          </label>

          <label>
            Email
            <input type="email" value={user.email || ""} disabled readOnly />
          </label>

          <section className="profileSettingsSection" aria-labelledby="profileSettingsHeading">
            <h2 id="profileSettingsHeading">Settings</h2>

            <label>
              Basic land set
              <select
                value={basicLandSetCode}
                onChange={(event) => setBasicLandSetCode(event.target.value)}
                disabled={profileLoading || isSaving}
              >
                {basicLandSetOptions.map((setOption) => (
                  <option key={setOption.code || "default"} value={setOption.code}>
                    {setOption.name}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {errorMessage && <p className="profileError">{errorMessage}</p>}
          {saveStatus && <p className="profileSuccess">{saveStatus}</p>}

          <button type="submit" disabled={profileLoading || isSaving}>
            {isSaving ? "Saving..." : "Save Profile"}
          </button>
        </form>

        <button
          className="profileLogoutButton"
          type="button"
          onClick={logOut}
        >
          Log Out
        </button>
      </section>
    </main>
  );
}
