import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../utils/supabase";
import "./AuthCallbackPage.css";

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Finishing sign in...");

  useEffect(() => {
    let isCurrent = true;

    async function finishAuth() {
      const hasCode = new URLSearchParams(window.location.search).has("code");

      if (hasCode) {
        const { error } = await supabase.auth.exchangeCodeForSession(
          window.location.href,
        );

        if (error) {
          if (isCurrent) {
            setMessage("Could not finish sign in. Please try again.");
          }
          return;
        }
      }

      const { data, error } = await supabase.auth.getSession();

      if (error || !data.session) {
        if (isCurrent) {
          setMessage("Could not find your session. Please try logging in again.");
        }
        return;
      }

      navigate("/", { replace: true });
    }

    finishAuth();

    return () => {
      isCurrent = false;
    };
  }, [navigate]);

  return (
    <main className="authCallbackPage">
      <p>{message}</p>
    </main>
  );
}
