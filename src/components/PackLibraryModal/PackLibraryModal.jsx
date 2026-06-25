import { useState } from "react";
import { getPackTagStyle, normalizePackTags } from "../../utils/packTags";
import "./PackLibraryModal.css";

/*
 * PackLibraryModal lists saved packs for the logged-in user.
 *
 * Props:
 * - isOpen: boolean
 * - packs: Array<packs table row>
 * - onClose()
 * - onOpenPack(packId)
 * - onDeletePack(packId)
 * - onDuplicatePack(packId)
 */

function getPackArchetypeTags(pack) {
  return normalizePackTags(
    pack.packTags || pack.archetype_tags || pack.archetype_tag,
  );
}

export default function PackLibraryModal({
  isOpen,
  packs,
  onClose,
  onOpenPack,
  onDeletePack,
  onDuplicatePack,
  onSharePack,
  onAddPacksToCube,
  canAddPacksToCube = false,
  cubePackIds = [],
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [packSearch, setPackSearch] = useState("");
  const [selectedPackIds, setSelectedPackIds] = useState([]);
  const [isAddingPacks, setIsAddingPacks] = useState(false);
  const [copiedPackId, setCopiedPackId] = useState(null);
  const cubePackIdSet = new Set(cubePackIds);

  function togglePackSelection(packId) {
    if (!canAddPacksToCube) return;
    if (cubePackIdSet.has(packId)) return;

    setSelectedPackIds((currentIds) =>
      currentIds.includes(packId)
        ? currentIds.filter((id) => id !== packId)
        : [...currentIds, packId],
    );
  }

  async function addSelectedPacks() {
    if (selectedPackIds.length === 0 || isAddingPacks) return;

    setIsAddingPacks(true);
    await onAddPacksToCube?.(selectedPackIds);
    setIsAddingPacks(false);
    setSelectedPackIds([]);
  }

  async function sharePack(pack) {
    if (pack.visibility !== "public") return;

    const copied = await onSharePack?.(pack.id);
    if (!copied) return;

    setCopiedPackId(pack.id);
    window.setTimeout(() => {
      setCopiedPackId((currentId) => (currentId === pack.id ? null : currentId));
    }, 1800);
  }

  const filteredPacks = packs.filter((pack) => {
    // Local library search only filters loaded metadata; opening a pack hydrates
    // cards through usePackBuilder.loadPack().
    const query = packSearch.toLowerCase().trim();

    if (!query) return true;

    const name = pack.name?.toLowerCase() || "";
    const description = pack.description?.toLowerCase() || "";
    const archetypes = getPackArchetypeTags(pack)
      .map((tag) => tag.name)
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

        <div className="packModalSelectionBar">
          <span>
            {!canAddPacksToCube
              ? "Create or open a cube before adding packs"
              : selectedPackIds.length > 0
              ? `${selectedPackIds.length} selected`
              : "Select packs to add them together"}
          </span>
          <button
            type="button"
            onClick={addSelectedPacks}
            disabled={
              !canAddPacksToCube ||
              selectedPackIds.length === 0 ||
              isAddingPacks
            }
          >
            {isAddingPacks ? "Adding..." : "Add to Cube"}
          </button>
        </div>

        {filteredPacks.length === 0 ? (
          <p className="emptyPackList">No saved packs yet.</p>
        ) : (
          <div className="packModalList">
            {filteredPacks.map((pack) => (
              <div
                className={`packModalItem ${
                  selectedPackIds.includes(pack.id) ? "selected" : ""
                } ${cubePackIdSet.has(pack.id) ? "alreadyInCube" : ""}`}
                key={pack.id}
              >
                <button
                  type="button"
                  className="packSelectButton"
                  onClick={() => togglePackSelection(pack.id)}
                  disabled={
                    !canAddPacksToCube || cubePackIdSet.has(pack.id)
                  }
                  aria-pressed={selectedPackIds.includes(pack.id)}
                  aria-label={
                    !canAddPacksToCube
                      ? "Create or open a cube before selecting packs"
                      : cubePackIdSet.has(pack.id)
                      ? `${pack.name} is already in the cube`
                      : `Select ${pack.name}`
                  }
                >
                  {cubePackIdSet.has(pack.id)
                    ? "In"
                    : selectedPackIds.includes(pack.id)
                      ? "✓"
                      : "+"}
                </button>
                <button
                  className="packModalOpen"
                  onClick={() => onOpenPack(pack.id)}
                >
                  <span>{pack.name}</span>

                  <div className="packModalTags">
                    {getPackArchetypeTags(pack).map((tag) => (
                      <strong
                        className="packModalTag"
                        key={tag.id || tag.normalizedName}
                        style={getPackTagStyle(tag)}
                      >
                        {tag.name}
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
                  className="packShareButton"
                  onClick={() => sharePack(pack)}
                  disabled={pack.visibility !== "public"}
                  title={
                    pack.visibility === "public"
                      ? "Copy public pack link"
                      : "Make this pack public to share it"
                  }
                >
                  {copiedPackId === pack.id ? "Copied" : "Share"}
                </button>
                <button
                  className={`packDeleteButton ${
                    confirmDeleteId === pack.id ? "confirming" : ""
                  }`}
                  onClick={() => {
                    // Two-click delete confirmation with a short auto-reset.
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
