import { useState } from "react";
import { supabase } from "../../utils/supabase";
import { getContentModerationMessage } from "../../utils/contentModeration";
import "./UsernameRequiredModal.css";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,31}$/;

/*
 * Blocks signed-in users who do not yet have a profile username.
 *
 * Props:
 * - user: Supabase user. The modal is only rendered when this exists.
 * - onProfileSaved(profile): updates useAuth() profile state after insert.
 */
export default function UsernameRequiredModal({ user, onProfileSaved }) {
  const [username, setUsername] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const usernameModerationMessage = getContentModerationMessage(username);

  async function saveUsername(event) {
    event.preventDefault();

    const trimmedUsername = username.trim();
    setErrorMessage("");

    if (!USERNAME_PATTERN.test(trimmedUsername)) {
      setErrorMessage("Usernames must be 3-31 letters, numbers, or underscores.");
      return;
    }

    if (usernameModerationMessage) {
      setErrorMessage(usernameModerationMessage);
      return;
    }

    setIsSaving(true);

    const { data: isUsernameAvailable, error: availabilityError } =
      await supabase.rpc("is_username_available", {
        requested_username: trimmedUsername,
      });

    if (availabilityError) {
      setErrorMessage("Could not check that username. Please try again.");
      setIsSaving(false);
      return;
    }

    if (!isUsernameAvailable) {
      setErrorMessage("That username is already taken.");
      setIsSaving(false);
      return;
    }

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
      .select("id, username")
      .single();

    setIsSaving(false);

    if (error) {
      setErrorMessage("Could not save that username. Please try another.");
      return;
    }

    onProfileSaved(data);
  }

  return (
    <div className="usernameRequiredOverlay">
      <section
        className="usernameRequiredModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="usernameRequiredTitle"
      >
        <h2 id="usernameRequiredTitle">Choose a username</h2>
        <p>
          Your account needs a username before you can continue.
        </p>

        <form className="usernameRequiredForm" onSubmit={saveUsername}>
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
              autoFocus
              required
            />
            {usernameModerationMessage && (
              <span className="usernameRequiredError" role="alert">
                {usernameModerationMessage}
              </span>
            )}
          </label>

          {errorMessage && (
            <p className="usernameRequiredError">{errorMessage}</p>
          )}

          <button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Continue"}
          </button>
        </form>
      </section>
    </div>
  );
}
