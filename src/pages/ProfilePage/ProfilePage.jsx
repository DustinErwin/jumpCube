import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../utils/supabase";
import { getContentModerationMessage } from "../../utils/contentModeration";
import "./ProfilePage.css";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,31}$/;
const PROFILE_COLUMNS = "id, username";

/*
 * ProfilePage lets signed-in users update app-owned profile fields.
 *
 * Email remains read-only because Supabase Auth owns auth.users.email.
 */
export default function ProfilePage({
  user,
  profile,
  profileLoading,
  onProfileSaved,
  onLogout,
}) {
  const navigate = useNavigate();
  const [username, setUsername] = useState(profile?.username || "");
  const [saveStatus, setSaveStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const usernameModerationMessage = getContentModerationMessage(username);
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

    const { data, error } = await supabase
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
      .select(PROFILE_COLUMNS)
      .single();

    setIsSaving(false);

    if (error) {
      setErrorMessage("Could not save your profile. Please try again.");
      return;
    }

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
