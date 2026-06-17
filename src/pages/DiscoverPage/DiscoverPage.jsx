import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getPackTagStyle } from "../../utils/packTags";
import {
  copyPublicCube,
  copyPublicPack,
  loadPublicLibrary,
} from "../../services/discoveryService";
import "./DiscoverPage.css";

function DiscoveryCard({ item, onCopy, copyState }) {
  const isCube = item.type === "cube";

  return (
    <article className={`discoveryCard ${isCube ? "cube" : "pack"}`}>
      <div
        className="discoveryArtwork"
        style={item.imageUrl ? { backgroundImage: `url("${item.imageUrl}")` } : undefined}
      />
      {isCube && <div className="cubeLayer cubeLayerOne" aria-hidden="true" />}
      {isCube && <div className="cubeLayer cubeLayerTwo" aria-hidden="true" />}

      <div className="discoveryCardContent">
        <div className="discoveryTypeRow">
          <span className="discoveryType">{isCube ? "Cube" : "Pack"}</span>
          <span>{isCube ? `${item.packCount} packs` : `${item.cardCount} cards`}</span>
        </div>
        <h2>{item.name}</h2>
        <p className="discoveryOwner">by {item.ownerName}</p>
        <p className="discoveryDescription">{item.description || "No description yet."}</p>

        {!isCube && item.tags.length > 0 && (
          <div className="discoveryTags">
            {item.tags.slice(0, 5).map((tag) => (
              <span key={tag.id || tag.normalizedName} style={getPackTagStyle(tag)}>
                {tag.name}
              </span>
            ))}
          </div>
        )}

        <div className="discoveryActions">
          <Link to={`/${isCube ? "cubes" : "packs"}/${item.id}`}>
            View Stats
          </Link>
          <button type="button" onClick={() => onCopy(item)} disabled={copyState === "copying"}>
            {copyState === "copying"
              ? "Adding..."
              : copyState === "copied"
                ? "Added"
                : "Copy"}
          </button>
        </div>
      </div>
    </article>
  );
}

export default function DiscoverPage({ user, onAuthRequired, onLibraryChanged }) {
  const [library, setLibrary] = useState({ packs: [], cubes: [] });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copyStates, setCopyStates] = useState({});

  useEffect(() => {
    let active = true;

    loadPublicLibrary()
      .then((result) => {
        if (active) setLibrary(result);
      })
      .catch((loadError) => {
        console.error("Error loading public library:", loadError);
        if (active) setError(loadError.message || "The public library could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const items = useMemo(() => {
    const query = search.trim().toLowerCase();
    const combined = [...library.cubes, ...library.packs];

    return combined.filter((item) => {
      if (filter !== "all" && item.type !== filter) return false;

      const searchableText = [
        item.name,
        item.description,
        item.ownerName,
        ...(item.tags || []).map((tag) => tag.name),
      ]
        .join(" ")
        .toLowerCase();

      return !query || searchableText.includes(query);
    });
  }, [filter, library, search]);

  async function copyItem(item) {
    if (!user?.id) {
      onAuthRequired();
      return;
    }

    const shouldCopy = window.confirm(
      `Add a private copy of this ${item.type} to your saved library? You can edit your copy without changing the public original.`,
    );

    if (!shouldCopy) return;

    setCopyStates((current) => ({ ...current, [item.id]: "copying" }));
    setError("");

    try {
      if (item.type === "cube") {
        await copyPublicCube(item.id, user.id);
      } else {
        await copyPublicPack(item.id, user.id);
      }

      await onLibraryChanged?.();
      setCopyStates((current) => ({ ...current, [item.id]: "copied" }));
    } catch (copyError) {
      console.error("Error copying public item:", copyError);
      setCopyStates((current) => ({ ...current, [item.id]: "" }));
      setError(copyError.message || "That copy could not be added.");
    }
  }

  return (
    <main className="discoverPage">
      <header className="discoverHero">
        <p className="discoverEyebrow">Community Library</p>
        <h1>Discover a new way to jump in</h1>
        <p>Browse public packs and complete cubes, then add private copies to your own library.</p>
      </header>

      <section className="discoverControls" aria-label="Public library filters">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search names, creators, descriptions, or tags"
        />
        <div className="discoverFilters">
          {[
            ["all", "All"],
            ["pack", "Packs"],
            ["cube", "Cubes"],
          ].map(([value, label]) => (
            <button
              type="button"
              className={filter === value ? "active" : ""}
              key={value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {error && <p className="discoverError" role="alert">{error}</p>}
      {loading ? (
        <p className="discoverStatus">Loading the community library...</p>
      ) : items.length === 0 ? (
        <p className="discoverStatus">No public packs or cubes match that search.</p>
      ) : (
        <section className="discoveryGrid" aria-label="Public packs and cubes">
          {items.map((item) => (
            <DiscoveryCard
              item={item}
              key={`${item.type}-${item.id}`}
              onCopy={copyItem}
              copyState={copyStates[item.id]}
            />
          ))}
        </section>
      )}
    </main>
  );
}
