import { Link, useLocation } from "react-router-dom";
import "./NavBar.css";

/*
 * NavBar renders the persistent top navigation.
 *
 * Props:
 * - user: Supabase user | null
 * - displayName: username/profile display fallback from useAuth()
 * - isAdmin: whether to show privileged navigation
 */
export default function NavBar({ user, displayName, isAdmin }) {
  const location = useLocation();
  const profileTarget = location.pathname === "/profile" ? "/" : "/profile";

  return (
    <header className="navBar">
      <Link className="navBrand" to="/">
        <img
          src={`${import.meta.env.BASE_URL}images/frogCube.png`}
          alt="Jump Cube mascot"
        />
        <h1>Jump Cube</h1>
      </Link>

      <nav className="navActions">
        {user ? (
          <>
            {isAdmin && (
              <Link className="navAdminLink" to="/secret-manager">
                Support
              </Link>
            )}

            <Link className="navUser" to={profileTarget}>
              {displayName || user.email}
            </Link>
          </>
        ) : (
          <Link
            className="navLoginButton"
            to="/auth?mode=signup"
          >
            Log In / Sign Up
          </Link>
        )}
      </nav>
    </header>
  );
}
