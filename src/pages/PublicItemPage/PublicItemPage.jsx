import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getPackTagStyle } from "../../utils/packTags";
import {
  copyPublicCube,
  copyPublicPack,
  loadPublicCube,
  loadPublicPack,
} from "../../services/discoveryService";
import "./PublicItemPage.css";

const TYPE_ORDER = ["Creature", "Instant", "Sorcery", "Artifact", "Enchantment", "Planeswalker", "Land"];
const COLOR_ORDER = ["W", "U", "B", "R", "G"];

function expandCards(cards) {
  return (cards || []).flatMap((card) =>
    Array.from({ length: card.quantity || 1 }, () => card),
  );
}

function getCardImage(card) {
  return card?.image_url || card?.image_uris?.normal || card?.image_uris?.art_crop || null;
}

function getTypeCounts(cards) {
  return TYPE_ORDER.map((type) => ({
    type,
    count: expandCards(cards).filter((card) =>
      new RegExp(`(^|[^A-Za-z])${type}([^A-Za-z]|$)`, "i").test(card.type_line || ""),
    ).length,
  })).filter((entry) => entry.count > 0);
}

function getManaCurve(cards) {
  return [0, 1, 2, 3, 4, 5, 6].map((manaValue) => {
    const count = expandCards(cards).filter((card) => {
      const cardManaValue = Number(card.mana_value || 0);
      const bucket = cardManaValue >= 6 ? 6 : Math.max(0, cardManaValue);

      return bucket === manaValue;
    }).length;

    return {
      label: manaValue === 6 ? "6+" : String(manaValue),
      count,
    };
  });
}

function getColorIdentity(cards) {
  return COLOR_ORDER.filter((color) =>
    expandCards(cards).some((card) => (card.color_identity || []).includes(color)),
  );
}

function PackStats({ pack }) {
  const cards = pack.cards || [];
  const cardCount = cards.reduce((sum, card) => sum + (card.quantity || 1), 0);
  const typeCounts = getTypeCounts(cards);
  const manaCurve = getManaCurve(cards);
  const largestCurveCount = Math.max(1, ...manaCurve.map((entry) => entry.count));
  const colorIdentity = getColorIdentity(cards);

  return (
    <section className="publicStatsPanel" aria-label={`${pack.name} statistics`}>
      <div className="statTiles">
        <div>
          <span>Cards</span>
          <strong>{cardCount}</strong>
        </div>
        <div>
          <span>Colors</span>
          <strong>
            {colorIdentity.length === 0
              ? "C"
              : colorIdentity.join("")}
          </strong>
        </div>
        <div>
          <span>Tags</span>
          <strong>{pack.tags?.length || 0}</strong>
        </div>
      </div>

      <div className="publicCharts">
        <div className="publicCurve" aria-label="Mana curve">
          {manaCurve.map((entry) => (
            <div className="publicCurveColumn" key={entry.label}>
              <span>{entry.count}</span>
              <i style={{ height: `${Math.max(4, (entry.count / largestCurveCount) * 100)}%` }} />
              <strong>{entry.label}</strong>
            </div>
          ))}
        </div>

        <div className="typeList" aria-label="Card types">
          {typeCounts.length === 0 ? (
            <p>No typed cards found.</p>
          ) : (
            typeCounts.map((entry) => (
              <div key={entry.type}>
                <span>{entry.type}</span>
                <strong>{entry.count}</strong>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function PackCardGrid({ cards }) {
  return (
    <section className="publicCardsGrid" aria-label="Pack cards">
      {(cards || []).map((card, index) => (
        <article className="publicCardTile" key={`${card.variant_id || card.card_search_id}-${index}`}>
          {getCardImage(card) && <img src={getCardImage(card)} alt={card.name} />}
          <div>
            <strong>{card.name}</strong>
            <span>{card.quantity || 1}x</span>
          </div>
        </article>
      ))}
    </section>
  );
}

export default function PublicItemPage({ type, user, onAuthRequired, onLibraryChanged }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [selectedPackId, setSelectedPackId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState("");
  const isCube = type === "cube";

  useEffect(() => {
    let active = true;

    (isCube ? loadPublicCube(id) : loadPublicPack(id))
      .then((loadedItem) => {
        if (!active) return;
        setItem(loadedItem);
        setError("");
        setSelectedPackId(loadedItem?.packs?.[0]?.id || null);
      })
      .catch((loadError) => {
        console.error("Error loading public item:", loadError);
        if (active) setError("That public link could not be opened.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id, isCube]);

  const isLoadedItemCurrent = item?.id === id;
  const isPageLoading = loading || (!isLoadedItemCurrent && !error);

  const selectedPack = useMemo(() => {
    if (!isCube) return item;
    return item?.packs?.find((pack) => pack.id === selectedPackId) || item?.packs?.[0] || null;
  }, [isCube, item, selectedPackId]);

  async function copyItemToLibrary() {
    if (!user?.id) {
      onAuthRequired?.();
      return;
    }

    const shouldCopy = window.confirm(
      `Add a private copy of this ${isCube ? "cube" : "pack"} to your saved library? You can edit your copy without changing the shared original.`,
    );

    if (!shouldCopy) return;

    setCopyState("copying");
    setError("");

    try {
      if (isCube) {
        await copyPublicCube(item.id, user.id);
      } else {
        await copyPublicPack(item.id, user.id);
      }

      await onLibraryChanged?.();
      setCopyState("copied");
    } catch (copyError) {
      console.error("Error copying public item:", copyError);
      setError(copyError.message || "A copy could not be added.");
      setCopyState("");
    }
  }

  if (isPageLoading) {
    return <main className="publicItemPage"><p className="publicItemStatus">Loading shared {isCube ? "cube" : "pack"}...</p></main>;
  }

  if (error && !item) {
    return (
      <main className="publicItemPage">
        <p className="publicItemStatus error">{error}</p>
        <Link className="publicBackLink" to="/discover">Browse Discover</Link>
      </main>
    );
  }

  return (
    <main className="publicItemPage">
      <header className={`publicItemHero ${isCube ? "cube" : "pack"}`}>
        <div
          className="publicHeroArtwork"
          style={item.imageUrl ? { backgroundImage: `url("${item.imageUrl}")` } : undefined}
        />
        <div className="publicHeroContent">
          <button type="button" className="publicBackLink" onClick={() => navigate(-1)}>
            Back
          </button>
          <p className="publicItemType">{isCube ? "Shared Cube" : "Shared Pack"}</p>
          <h1>{item.name}</h1>
          <p className="publicOwner">by {item.ownerName}</p>
          <p className="publicDescription">{item.description || "No description yet."}</p>
          <div className="publicActions">
            <button type="button" onClick={copyItemToLibrary} disabled={copyState === "copying"}>
              {copyState === "copying"
                ? "Copying..."
                : copyState === "copied"
                  ? "Copied to My Library"
                  : user
                    ? `Copy ${isCube ? "Cube" : "Pack"} to My Library`
                    : "Log In to Copy"}
            </button>
            <Link to="/discover">Discover More</Link>
          </div>
          {error && <p className="publicItemError" role="alert">{error}</p>}
        </div>
      </header>

      {isCube && (
        <section className="publicCubePacks" aria-label="Cube packs">
          {(item.packs || []).map((pack) => (
            <button
              type="button"
              className={selectedPack?.id === pack.id ? "active" : ""}
              key={pack.id}
              onClick={() => setSelectedPackId(pack.id)}
            >
              <span>{pack.name}</span>
              <small>{pack.cardCount} cards</small>
            </button>
          ))}
        </section>
      )}

      {selectedPack && (
        <>
          <section className="publicPackHeader">
            <div>
              <p>{isCube ? "Selected Pack" : "Pack Details"}</p>
              <h2>{selectedPack.name}</h2>
            </div>
            {selectedPack.tags?.length > 0 && (
              <div className="publicPackTags">
                {selectedPack.tags.map((tag) => (
                  <span key={tag.id || tag.normalizedName} style={getPackTagStyle(tag)}>
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </section>
          <PackStats pack={selectedPack} />
          <PackCardGrid cards={selectedPack.cards} />
        </>
      )}
    </main>
  );
}
