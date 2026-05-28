import { useState } from "react";
import { supabase } from "../../utils/supabase";
import "./AuthBox.css";

export default function AuthBox({ user }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function signUp() {
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
