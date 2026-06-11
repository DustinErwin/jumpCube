import { Link, useLocation } from "react-router-dom";
import "./NavBar.css";

/*
 * NavBar renders the persistent top navigation.
 *
 * Props:
 * - user: Supabase user | null
 * - displayName: username/profile display fallback from useAuth()
 */
export default function NavBar({ user, displayName }) {
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
          <Link className="navUser" to={profileTarget}>
            {displayName || user.email}
          </Link>
        ) : (
          <Link className="navLoginButton" to="/auth">
            Log In / Sign Up
          </Link>
        )}
      </nav>
    </header>
  );
}
