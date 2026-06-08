import { Link } from "react-router-dom";
import "./NavBar.css";

/*
 * NavBar renders the persistent top navigation.
 *
 * Props:
 * - user: Supabase user | null
 * - onLogout(): signs out and clears active app UI in App
 */
export default function NavBar({ user, onLogout }) {
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
            <span className="navUser">{user.email}</span>

            <button onClick={onLogout}>
              Log Out
            </button>
          </>
        ) : (
          <Link className="navLoginButton" to="/auth">
            Log In / Sign Up
          </Link>
        )}
      </nav>
    </header>
  );
}
