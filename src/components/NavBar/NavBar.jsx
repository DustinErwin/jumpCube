import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./NavBar.css";

const FALLBACK_FROG_IMAGE = `${import.meta.env.BASE_URL}images/frogCube.png`;

function getCardArt(card) {
  return (
    card?.image_uris?.art_crop ||
    card?.image_uris?.normal ||
    card?.card_faces?.find((face) => face.image_uris)?.image_uris?.art_crop ||
    card?.card_faces?.find((face) => face.image_uris)?.image_uris?.normal ||
    null
  );
}

export default function NavBar({ user, onLogout }) {
  const [frogImage, setFrogImage] = useState(FALLBACK_FROG_IMAGE);
  const [frogName, setFrogName] = useState("Jump Cube mascot");

  useEffect(() => {
    let isCurrent = true;

    async function loadRandomFrog() {
      try {
        const response = await fetch(
          "https://api.scryfall.com/cards/random?q=t%3Afrog%20t%3Acreature%20-is%3Afunny",
        );

        if (!response.ok) return;

        const card = await response.json();
        const cardArt = getCardArt(card);

        if (isCurrent && cardArt) {
          setFrogImage(cardArt);
          setFrogName(card.name || "Random Frog creature");
        }
      } catch (error) {
        console.error("Error loading random Frog card:", error);
      }
    }

    loadRandomFrog();

    return () => {
      isCurrent = false;
    };
  }, []);

  return (
    <header className="navBar">
      <Link className="navBrand" to="/">
        <span
          className="navFrogArt"
          style={{ backgroundImage: `url("${frogImage}")` }}
          role="img"
          aria-label={frogName}
          title={frogName}
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
