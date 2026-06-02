import { Link } from "react-router-dom";
import "./NavBar.css";

export default function NavBar({ user, onOpenPacks, onLogout }) {
  return (
    <header className="navBar">
      <Link className="navBrand" to="/">
        <img src="/images/frogCube.png" alt="Jump Cube mascot" />
        <h1>Jump Cube</h1>
      </Link>

      <nav className="navActions">
        {user ? (
          <>
            <span className="navUser">{user.email}</span>

            <button onClick={onOpenPacks}>
              My Packs
            </button>

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