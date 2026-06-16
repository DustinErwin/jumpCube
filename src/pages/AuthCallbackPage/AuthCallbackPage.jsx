import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../utils/supabase";
import "./AuthCallbackPage.css";

const AUTH_STEP_TIMEOUT_MS = 8000;
const SESSION_RETRY_DELAYS_MS = [0, 250, 750, 1500, 3000];

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function withTimeout(promise, timeoutMessage) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new Error(timeoutMessage)),
      AUTH_STEP_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Finishing sign in...");

  useEffect(() => {
    let isCurrent = true;

    async function getRecoveredSession() {
      for (const delay of SESSION_RETRY_DELAYS_MS) {
        if (delay > 0) {
          await sleep(delay);
        }

        if (!isCurrent) return null;

        const { data, error } = await withTimeout(
          supabase.auth.getSession(),
          "Session check timed out.",
        ).catch(() => ({ data: {}, error: true }));

        if (!error && data.session) {
          return data.session;
        }
      }

      return null;
    }

    function waitForAuthState() {
      return new Promise((resolve) => {
        let subscription;
        const timeoutId = window.setTimeout(() => {
          subscription?.unsubscribe();
          resolve(null);
        }, AUTH_STEP_TIMEOUT_MS);
        const { data: listener } = supabase.auth.onAuthStateChange(
          (_event, session) => {
            if (!session) return;

            window.clearTimeout(timeoutId);
            subscription?.unsubscribe();
            resolve(session);
          },
        );
        subscription = listener.subscription;
      });
    }

    async function finishAuth() {
      const hasCode = new URLSearchParams(window.location.search).has("code");
      const existingSession = await getRecoveredSession();

      if (existingSession) {
        navigate("/", { replace: true });
        return;
      }

      if (hasCode) {
        const { error } = await withTimeout(
          supabase.auth.exchangeCodeForSession(window.location.href),
          "Sign in timed out.",
        ).catch((timeoutError) => ({
          error: timeoutError,
        }));

        if (error) {
          const recoveredSession = await getRecoveredSession();

          if (recoveredSession) {
            navigate("/", { replace: true });
            return;
          }

          if (!isCurrent) return;

          setMessage(
            "Sign in is taking too long. Please close this page and try logging in again.",
          );
          return;
        }
      }

      const session = (await getRecoveredSession()) || (await waitForAuthState());

      if (!session) {
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
