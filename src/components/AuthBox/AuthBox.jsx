import { useState } from "react";
import { supabase } from "../../utils/supabase";
import "./AuthBox.css";

/*
 * AuthBox is a simple email/password auth form.
 *
 * Prop:
 * - user: Supabase user | null. When present, show signed-in state.
 *
 * The main app currently routes auth through AuthPage/NavBar, so keep styling
 * and behavior here in sync if this component is reused.
 */
export default function AuthBox({ user }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function signUp() {
    // Supabase may require email confirmation depending on project settings.
    const trimmedUsername = username.trim();

    if (!/^[A-Za-z0-9]{3,31}$/.test(trimmedUsername)) {
      console.error("Signup error: usernames must be 3-31 letters or numbers.");
      return;
    }

    const { data: isUsernameAvailable, error: usernameError } =
      await supabase.rpc("is_username_available", {
        requested_username: trimmedUsername,
      });

    if (usernameError || !isUsernameAvailable) {
      console.error(
        "Signup error:",
        usernameError || new Error("That username is already taken."),
      );
      return;
    }

    const { data: isEmailAvailable, error: emailError } = await supabase.rpc(
      "is_email_available",
      {
        requested_email: email.trim(),
      },
    );

    if (emailError || !isEmailAvailable) {
      console.error(
        "Signup error:",
        emailError || new Error("That email is already being used."),
      );
      return;
    }

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          username: trimmedUsername,
        },
      },
    });

    if (error) {
      console.error("Signup error:", error);
      return;
    }

    alert("Check your email to confirm your account.");
  }

  async function signIn() {
    // Password login. OAuth providers should be added in AuthPage if needed.
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("Login error:", error);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (user) {
    return (
      <div className="authBox">
        <p>Signed in as {user.email}</p>
        <button onClick={signOut}>Log Out</button>
      </div>
    );
  }

  return (
    <div className="authBox">
      <input
        type="text"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />

      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <button onClick={signIn}>Log In</button>
      <button onClick={signUp}>Sign Up</button>
    </div>
  );
}
