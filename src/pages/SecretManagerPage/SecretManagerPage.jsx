import { Link } from "react-router-dom";
import "./SecretManagerPage.css";

/*
 * SecretManagerPage is the admin-only support surface.
 *
 * Do not add service-role Supabase calls here. Account impersonation must run
 * through a server-side audited function so credentials never ship to browsers.
 */
export default function SecretManagerPage() {
  return (
    <main className="secretManagerPage">
      <section className="secretManagerPanel">
        <Link className="secretManagerBackLink" to="/">
          Back to Jump Cube
        </Link>

        <header className="secretManagerHeader">
          <h1>Support Manager</h1>
          <p>Admin-only tools for support requests.</p>
        </header>

        <section className="supportToolSection">
          <h2>Account Access</h2>
          <p>
            User impersonation will be enabled through a server-side audited
            support action. Browser-only access is intentionally disabled.
          </p>

          <form className="supportLookupForm">
            <label>
              User email or username
              <input
                type="text"
                placeholder="Search support target"
                disabled
              />
            </label>

            <button type="button" disabled>
              Start Support Session
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}
