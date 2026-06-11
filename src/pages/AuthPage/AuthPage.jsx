import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../utils/supabase";
import "./AuthPage.css";

const PENDING_SIGNUP_USERNAME_KEY = "jumpCubePendingSignupUsername";
const USERNAME_PATTERN = /^[A-Za-z0-9]{3,31}$/;

/*
 * AuthPage handles login/signup routes.
 *
 * State:
 * - mode: "login" | "signup"
 * - email/password/username: controlled inputs
 * - authMessage/authError: user feedback from Supabase
 * - isSubmitting: disables the email form during requests
 *
 * OAuth redirect uses BASE_URL so GitHub Pages/project-path deploys return to
 * the correct app URL.
 */
export default function AuthPage() {
  const navigate = useNavigate();
  const authRedirectUrl = new URL(import.meta.env.BASE_URL, window.location.origin)
    .href;

  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function getValidSignupUsername() {
    const trimmedUsername = username.trim();

    if (!USERNAME_PATTERN.test(trimmedUsername)) {
      return {
        error: "Usernames must be 3-31 letters or numbers.",
        username: "",
      };
    }

    return {
      error: "",
      username: trimmedUsername,
    };
  }

  async function checkUsernameAvailability(trimmedUsername) {
    const { data: isUsernameAvailable, error } = await supabase.rpc(
      "is_username_available",
      {
        requested_username: trimmedUsername,
      },
    );

    if (error) {
      return {
        error: "Could not check that username. Please try again.",
        isAvailable: false,
      };
    }

    if (!isUsernameAvailable) {
      return {
        error: "That username is already taken.",
        isAvailable: false,
      };
    }

    return {
      error: "",
      isAvailable: true,
    };
  }

  async function checkEmailAvailability(trimmedEmail) {
    const { data: isEmailAvailable, error } = await supabase.rpc(
      "is_email_available",
      {
        requested_email: trimmedEmail,
      },
    );

    if (error) {
      return {
        error: "Could not check that email. Please try again.",
        isAvailable: false,
      };
    }

    if (!isEmailAvailable) {
      return {
        error: "That email is already being used.",
        isAvailable: false,
      };
    }

    return {
      error: "",
      isAvailable: true,
    };
  }

  async function handleEmailAuth(e) {
    // One form supports both signup and login; mode controls which Supabase
    // auth method is called.
    e.preventDefault();

    setAuthMessage("");
    setAuthError("");
    setIsSubmitting(true);

    if (mode === "signup") {
      const trimmedEmail = email.trim();
      const usernameResult = getValidSignupUsername();

      if (usernameResult.error) {
        setAuthError(usernameResult.error);
        setIsSubmitting(false);
        return;
      }

      const emailAvailabilityResult =
        await checkEmailAvailability(trimmedEmail);

      if (!emailAvailabilityResult.isAvailable) {
        setAuthError(emailAvailabilityResult.error);
        setIsSubmitting(false);
        return;
      }

      const availabilityResult = await checkUsernameAvailability(
        usernameResult.username,
      );

      if (!availabilityResult.isAvailable) {
        setAuthError(availabilityResult.error);
        setIsSubmitting(false);
        return;
      }

      const { error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: {
            username: usernameResult.username,
          },
          emailRedirectTo: authRedirectUrl,
        },
      });

      setIsSubmitting(false);

      if (error) {
        setAuthError(error.message);
        return;
      }

      setAuthMessage(
        "Account created. Check your email to confirm your account.",
      );
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setIsSubmitting(false);

    if (error) {
      setAuthError(error.message);
      return;
    }

    navigate("/");
  }

  async function signInWithGoogle() {
    // Google provider must also be enabled/configured in Supabase dashboard.
    setAuthMessage("");
    setAuthError("");

    if (mode === "signup") {
      const usernameResult = getValidSignupUsername();

      if (usernameResult.error) {
        setAuthError(usernameResult.error);
        return;
      }

      const availabilityResult = await checkUsernameAvailability(
        usernameResult.username,
      );

      if (!availabilityResult.isAvailable) {
        setAuthError(availabilityResult.error);
        return;
      }

      window.localStorage.setItem(
        PENDING_SIGNUP_USERNAME_KEY,
        usernameResult.username,
      );
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: authRedirectUrl,
      },
    });

    if (error) {
      if (mode === "signup") {
        window.localStorage.removeItem(PENDING_SIGNUP_USERNAME_KEY);
      }

      setAuthError(error.message);
    }
  }

  return (
    <main className="authPage">
      <div className="authCard">
        <Link className="authBackLink" to="/">
          ← Back to Jump Cube
        </Link>

        <img
          className="authMascot"
          src={`${import.meta.env.BASE_URL}images/frogCube.png`}
          alt="Jump Cube frog mascot"
        />

        <h1>{mode === "login" ? "Welcome Back" : "Create Account"}</h1>

        <p className="authSubtitle">
          {mode === "login"
            ? "Log in to access your saved packs."
          : "Create an account to save and share packs."}
        </p>

        {mode === "signup" && (
          <label className="authUsernameField">
            Username
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              minLength={3}
              maxLength={31}
              pattern="[A-Za-z0-9]+"
              required
            />
          </label>
        )}

        <button
          className="googleAuthButton"
          type="button"
          onClick={signInWithGoogle}
        >
          Continue with Google
        </button>

        <div className="authDivider">
          <span>or</span>
        </div>

        <form className="authForm" onSubmit={handleEmailAuth}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              minLength={6}
              required
            />
          </label>

          {authError && <p className="authError">{authError}</p>}
          {authMessage && <p className="authMessage">{authMessage}</p>}

          <button
            className="emailAuthButton"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? "Working..."
              : mode === "login"
                ? "Log In"
                : "Create Account"}
          </button>
        </form>

        <button
          className="authModeToggle"
          type="button"
          onClick={() => {
            setAuthError("");
            setAuthMessage("");
            setMode((current) => (current === "login" ? "signup" : "login"));
          }}
        >
          {mode === "login"
            ? "Need an account? Sign up"
            : "Already have an account? Log in"}
        </button>
      </div>
    </main>
  );
}
