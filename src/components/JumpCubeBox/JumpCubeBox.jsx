import { useEffect, useState } from "react";
import "./JumpCubeBox.css";

const CUBE_TITLE_MAX_LENGTH = 40;

export default function JumpCubeBox({
  cubeName,
  setCubeName,
  cubeDescription,
  setCubeDescription,
  selectedPacks,
  saveCube,
  onOpenCubes,
  onOpenPack,
  removePackFromCube,
  newCube,
  saveStatus,
  isOpen,
  setIsOpen,
}) {
  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [confirmingDeleteCube, setConfirmingDeleteCube] = useState(false);
  const [pendingRemovePackId, setPendingRemovePackId] = useState(null);

  useEffect(() => {
    if (!pendingRemovePackId) return undefined;

    function cancelPendingRemove(event) {
      const packItem = event.target.closest(".cubePackItem");

      if (packItem?.dataset.packId === pendingRemovePackId) return;

      setPendingRemovePackId(null);
    }

    window.addEventListener("click", cancelPendingRemove);

    return () => {
      window.removeEventListener("click", cancelPendingRemove);
    };
  }, [pendingRemovePackId]);

  function deleteConfirmedCube() {
    newCube();
    setConfirmingDeleteCube(false);
  }

  function getPackColorIdentity(pack) {
    const colors =
      pack.colorIdentity ||
      pack.color_identity ||
      pack.cards?.flatMap((card) => card.color_identity || []) ||
      [];

    return [...new Set(colors)].sort();
  }

  function getPackColorClass(pack) {
    const colors = getPackColorIdentity(pack);

    if (colors.length === 0) return "cubePackColorless";
    if (colors.length > 1) return "cubePackMulticolor";

    const colorClassBySymbol = {
      W: "cubePackWhite",
      U: "cubePackBlue",
      B: "cubePackBlack",
      R: "cubePackRed",
      G: "cubePackGreen",
    };

    return colorClassBySymbol[colors[0]] || "cubePackColorless";
  }

  function handlePackContextMenu(event, packId) {
    event.preventDefault();

    if (pendingRemovePackId === packId) {
      removePackFromCube(packId);
      setPendingRemovePackId(null);
      return;
    }

    setPendingRemovePackId(packId);
  }

  function handlePackClick(pack) {
    const packId = pack.savedPackId || pack.id;

    if (!packId) return;

    setPendingRemovePackId(null);
    onOpenPack(packId);
  }

  return (
    <aside className={`jumpCubeBox ${isOpen ? "open" : "closed"}`}>
      <button
        className="jumpCubeToggle"
        onClick={() => setIsOpen((prev) => !prev)}
        title={isOpen ? "Hide cube" : "Show cube"}
        aria-label={isOpen ? "Hide cube" : "Show cube"}
        aria-expanded={isOpen}
      >
        {isOpen ? "‹" : "›"}
      </button>

      {editingName ? (
        <input
          className="cubeNameInput"
          value={cubeName}
          maxLength={CUBE_TITLE_MAX_LENGTH}
          autoFocus
          onChange={(e) =>
            setCubeName(e.target.value.slice(0, CUBE_TITLE_MAX_LENGTH))
          }
          onBlur={() => setEditingName(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setEditingName(false);
          }}
        />
      ) : (
        <h2 className="cubeTitle" onClick={() => setEditingName(true)}>
          {cubeName}
        </h2>
      )}

      {editingDescription ? (
        <textarea
          className="cubeDescriptionInput"
          value={cubeDescription}
          placeholder="Click to add a cube description..."
          autoFocus
          onChange={(e) => setCubeDescription(e.target.value)}
          onBlur={() => setEditingDescription(false)}
        />
      ) : (
        <p
          className="cubeDescription"
          onClick={() => setEditingDescription(true)}
          title="Click to edit description"
        >
          {cubeDescription || (
            <span className="placeholderText">
              Click to add a cube description...
            </span>
          )}
        </p>
      )}

      <p className="cubeCount">{selectedPacks.length} packs selected</p>

      <div className="cubeActionToolbar" aria-label="Cube actions">
        <button
          className="cubeActionButton openCubesButton"
          type="button"
          onClick={() => {
            setConfirmingDeleteCube(false);
            onOpenCubes();
          }}
          title="Open my cubes"
          aria-label="Open my cubes"
        >
          <svg
            aria-hidden="true"
            className="actionIcon"
            viewBox="0 0 24 24"
            focusable="false"
          >
            <path d="M3.5 6.5h6l2 2h10v2h-18z" />
            <path d="M2.5 9.5h21l-2 11h-19z" />
          </svg>
        </button>

        <button
          className={`cubeActionButton saveCubeButton ${
            saveStatus === "saving" ? "saving" : ""
          }`}
          type="button"
          onClick={() => {
            setConfirmingDeleteCube(false);
            saveCube();
          }}
          disabled={selectedPacks.length === 0 || saveStatus === "saving"}
          title={saveStatus === "saving" ? "Saving cube" : "Save cube"}
          aria-label={saveStatus === "saving" ? "Saving cube" : "Save cube"}
        >
          <svg
            aria-hidden="true"
            className="actionIcon"
            viewBox="0 0 24 24"
            focusable="false"
          >
            <path d="M4 3h14l2 2v16H4z" />
            <path d="M7 3h10v7H7z" className="actionIconInset" />
            <path d="M8 15h8v6H8z" className="actionIconInset" />
            <path d="M14 4h3v5h-3z" />
          </svg>
        </button>

        <button
          className="cubeActionButton newCubeButton"
          type="button"
          onClick={() => {
            setConfirmingDeleteCube(false);
            newCube();
          }}
          title="New cube"
          aria-label="New cube"
        >
          <span aria-hidden="true">+</span>
        </button>

        <button
          className="cubeActionButton deleteCubeButton"
          type="button"
          onClick={() => setConfirmingDeleteCube((current) => !current)}
          disabled={selectedPacks.length === 0 && !cubeDescription.trim()}
          title="Clear cube"
          aria-label="Clear cube"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      {confirmingDeleteCube && (
        <button
          className="confirmDeleteCubeButton"
          type="button"
          onClick={deleteConfirmedCube}
          aria-label={`Confirm clear ${cubeName}`}
        >
          Clear {cubeName}
        </button>
      )}

      {saveStatus === "saved" && (
        <p className="saveMessage success">Cube saved ✓</p>
      )}

      {saveStatus === "error" && (
        <p className="saveMessage error">Save failed</p>
      )}

      <div className="cubePackScrollArea">
        {selectedPacks.length === 0 ? (
          <p className="emptyCube">Add packs to build your Jump Cube.</p>
        ) : (
          <div className="cubePackList">
            {selectedPacks.map((pack) => (
              <button
                type="button"
                className={`cubePackItem ${getPackColorClass(pack)} ${
                  pendingRemovePackId === pack.id ? "pendingRemove" : ""
                }`}
                data-pack-id={pack.id}
                key={pack.id}
                onClick={() => handlePackClick(pack)}
                onContextMenu={(event) =>
                  handlePackContextMenu(event, pack.id)
                }
                title={
                  pendingRemovePackId === pack.id
                    ? `Right-click again to remove ${pack.name}`
                    : pack.name
                }
              >
                <span>{pack.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
