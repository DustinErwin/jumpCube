import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../utils/supabase";
import "./AuthPage.css";

export default function AuthPage() {
  const navigate = useNavigate();

  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleEmailAuth(e) {
    e.preventDefault();

    setAuthMessage("");
    setAuthError("");
    setIsSubmitting(true);

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
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
    setAuthMessage("");
    setAuthError("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    });

    if (error) {
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
          src="/images/frogCube.png"
          alt="Jump Cube frog mascot"
        />

        <h1>{mode === "login" ? "Welcome Back" : "Create Account"}</h1>

        <p className="authSubtitle">
          {mode === "login"
            ? "Log in to access your saved packs."
            : "Create an account to save and share packs."}
        </p>

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
