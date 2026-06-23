import { useEffect, useRef, useState } from "react";
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
  const menuRef = useRef(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const profileTarget = location.pathname === "/profile" ? "/" : "/profile";

  useEffect(() => {
    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) {
        setIsMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function closeMenu() {
    setIsMenuOpen(false);
  }

  return (
    <header className={`navBar${isMenuOpen ? " menuOpen" : ""}`}>
      <Link className="navBrand" to="/">
        <img
          src={`${import.meta.env.BASE_URL}images/frogCube.png`}
          alt="Jump Cube mascot"
        />
        <h1>Jump Cube</h1>
      </Link>

      <div className="navMenu" ref={menuRef}>
        <button
          type="button"
          className={`navMenuButton${isMenuOpen ? " open" : ""}`}
          onClick={() => setIsMenuOpen((current) => !current)}
          aria-label="Toggle navigation menu"
          aria-expanded={isMenuOpen}
          aria-controls="primary-navigation"
        >
          <span />
          <span />
          <span />
        </button>

        <nav
          id="primary-navigation"
          className={`navActions${isMenuOpen ? " open" : ""}`}
        >
          <Link className="navCreateLink" to="/create" onClick={closeMenu}>
            Create
          </Link>
          <Link className="navDiscoverLink" to="/discover" onClick={closeMenu}>
            Discover
          </Link>
          {user ? (
            <>
              <Link
                className="navCollectionLink"
                to="/collection"
                onClick={closeMenu}
              >
                Collection
              </Link>
              {isAdmin && (
                <Link
                  className="navAdminLink"
                  to="/secret-manager"
                  onClick={closeMenu}
                >
                  Support
                </Link>
              )}

              <Link className="navUser" to={profileTarget} onClick={closeMenu}>
                {displayName || user.email}
              </Link>
            </>
          ) : (
            <Link
              className="navLoginButton"
              to="/auth?mode=signup"
              onClick={closeMenu}
            >
              Log In / Sign Up
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
