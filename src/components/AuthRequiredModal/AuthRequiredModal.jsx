import { Link } from "react-router-dom";
import "./AuthRequiredModal.css";

/*
 * AuthRequiredModal prompts anonymous users before protected workflows.
 */
export default function AuthRequiredModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="authRequiredOverlay" onClick={onClose}>
      <section
        className="authRequiredModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="authRequiredTitle"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="authRequiredTitle">Sign up to continue</h2>
        <p>
          You can search cards and build a pack before signing in. Saving,
          opening libraries, cube tools, and profile features need an account.
        </p>

        <div className="authRequiredActions">
          <Link
            className="authRequiredPrimary"
            to="/auth?mode=signup"
            onClick={onClose}
          >
            Sign Up
          </Link>
          <Link
            className="authRequiredSecondary"
            to="/auth"
            onClick={onClose}
          >
            Log In
          </Link>
        </div>
      </section>
    </div>
  );
}
