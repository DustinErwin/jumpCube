import { useState } from "react";
import "./PackLibraryModal.css";

function getPackArchetypeTags(pack) {
  if (Array.isArray(pack.archetype_tags)) return pack.archetype_tags;
  if (pack.archetype_tag) return [pack.archetype_tag];

  return [];
}

export default function PackLibraryModal({
  isOpen,
  packs,
  onClose,
  onOpenPack,
  onDeletePack,
  onDuplicatePack,
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [packSearch, setPackSearch] = useState("");

  const filteredPacks = packs.filter((pack) => {
    const query = packSearch.toLowerCase().trim();

    if (!query) return true;

    const name = pack.name?.toLowerCase() || "";
    const description = pack.description?.toLowerCase() || "";
    const archetypes = getPackArchetypeTags(pack)
      .join(" ")
      .toLowerCase();

    return (
      name.includes(query) ||
      description.includes(query) ||
      archetypes.includes(query)
    );
  });

  if (!isOpen) return null;

  return (
    <div className="packModalOverlay" onClick={onClose}>
      <div className="packModal" onClick={(e) => e.stopPropagation()}>
        <div className="packModalHeader">
          <h2>My Packs</h2>
          <input
            className="packSearchInput"
            type="text"
            placeholder="Search packs..."
            value={packSearch}
            onChange={(e) => setPackSearch(e.target.value)}
          />
          <button onClick={onClose}>×</button>
        </div>

        {filteredPacks.length === 0 ? (
          <p className="emptyPackList">No saved packs yet.</p>
        ) : (
          <div className="packModalList">
            {filteredPacks.map((pack) => (
              <div className="packModalItem" key={pack.id}>
                <button
                  className="packModalOpen"
                  onClick={() => onOpenPack(pack.id)}
                >
                  <span>{pack.name}</span>

                  <div className="packModalTags">
                    {getPackArchetypeTags(pack).map((tag) => (
                      <strong className="packModalTag" key={tag}>
                        {tag}
                      </strong>
                    ))}
                  </div>

                  <small>{pack.description || "No description"}</small>
                </button>
                <button
                  className="packDuplicateButton"
                  onClick={() => onDuplicatePack(pack.id)}
                >
                  Duplicate
                </button>
                <button
                  className={`packDeleteButton ${
                    confirmDeleteId === pack.id ? "confirming" : ""
                  }`}
                  onClick={() => {
                    if (confirmDeleteId === pack.id) {
                      onDeletePack(pack.id);
                      setConfirmDeleteId(null);
                      return;
                    }

                    setConfirmDeleteId(pack.id);

                    setTimeout(() => {
                      setConfirmDeleteId((current) =>
                        current === pack.id ? null : current,
                      );
                    }, 3000);
                  }}
                >
                  {confirmDeleteId === pack.id ? "Confirm?" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
