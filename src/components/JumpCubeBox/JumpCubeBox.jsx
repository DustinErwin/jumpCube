import { useEffect, useState } from "react";
import "./JumpCubeBox.css";

const CUBE_TITLE_MAX_LENGTH = 40;
const ARCHETYPE_COLORS = {
  Aggro: "#c93f32",
  Control: "#2f77c8",
  Midrange: "#d8c58f",
  Combo: "#7b4aa1",
  Ramp: "#3f9650",
  Tempo: "#727a80",
};
const GOLD_ARCHETYPE_BACKGROUND = "linear-gradient(90deg, #e1c45a, #9a6a18)";

function getPackArchetypeTags(pack) {
  if (Array.isArray(pack.archetypeTags)) return pack.archetypeTags;
  if (pack.archetypeTag) return [pack.archetypeTag];

  return [];
}

function getArchetypeBackground(tags) {
  if (tags.length === 0) return "#202020";
  if (tags.length > 3) return GOLD_ARCHETYPE_BACKGROUND;
  if (tags.length === 1) return ARCHETYPE_COLORS[tags[0]] || "#202020";

  const segmentSize = 100 / tags.length;
  const segments = tags.flatMap((tag, index) => {
    const color = ARCHETYPE_COLORS[tag] || "#202020";
    const start = `${index * segmentSize}%`;
    const end = `${(index + 1) * segmentSize}%`;

    return [`${color} ${start}`, `${color} ${end}`];
  });

  return `linear-gradient(90deg, ${segments.join(", ")})`;
}

function getPackArchetypeStyle(pack) {
  const tags = getPackArchetypeTags(pack);
  const usesDarkText = tags.length === 1 && tags[0] === "Midrange";

  return {
    "--cube-pack-archetype-bg": getArchetypeBackground(tags),
    "--cube-pack-text": usesDarkText ? "#17130b" : "white",
  };
}

export default function JumpCubeBox({
  cubeName,
  setCubeName,
  cubeDescription,
  setCubeDescription,
  selectedPacks,
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

  function getManaClass(color) {
    const classes = {
      W: "ms-w",
      U: "ms-u",
      B: "ms-b",
      R: "ms-r",
      G: "ms-g",
      C: "ms-c",
    };

    return classes[color] || "";
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

      {saveStatus === "saving" && <p className="saveMessage">Saving...</p>}

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
                className={`cubePackItem ${
                  pendingRemovePackId === pack.id ? "pendingRemove" : ""
                }`}
                style={getPackArchetypeStyle(pack)}
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
                <span className="cubePackName">{pack.name}</span>
                <span className="cubePackPips" aria-label="Color identity">
                  {getPackColorIdentity(pack).length === 0 ? (
                    <i
                      className="ms ms-c cubeManaSymbol cubeManaSymbolC"
                      title="Colorless"
                    />
                  ) : (
                    getPackColorIdentity(pack).map((color) => (
                      <i
                        className={`ms ${getManaClass(color)} cubeManaSymbol cubeManaSymbol${color}`}
                        key={color}
                        title={color}
                      />
                    ))
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
