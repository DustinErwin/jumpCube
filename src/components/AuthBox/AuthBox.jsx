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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function signUp() {
    // Supabase may require email confirmation depending on project settings.
    const { error } = await supabase.auth.signUp({
      email,
      password,
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
