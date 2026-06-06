import { useEffect, useState } from "react";
import "./JumpCubeBox.css";

const CUBE_TITLE_MAX_LENGTH = 40;
const MANA_COLORS = {
  W: "#eee0b3",
  U: "#3560c6",
  B: "#60086f",
  R: "#bd1616",
  G: "#1e8514",
  C: "#9ea3a6",
};
const MANA_ORDER = ["W", "U", "B", "R", "G", "C"];
const CUBE_COLOR_COLUMNS = [
  { id: "W", label: "White" },
  { id: "U", label: "Blue" },
  { id: "B", label: "Black" },
  { id: "R", label: "Red" },
  { id: "G", label: "Green" },
  { id: "C", label: "Colorless" },
  { id: "M", label: "Multicolor" },
];

function getManaCost(card) {
  return card.raw?.mana_cost || card.mana_cost || "";
}

function getCardManaPips(card) {
  const pips = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
    C: 0,
  };
  const manaCost = getManaCost(card);
  const symbols = manaCost.match(/\{[^}]+\}/g) || [];

  symbols.forEach((symbol) => {
    MANA_ORDER.forEach((color) => {
      if (symbol.includes(color)) {
        pips[color] += 1;
      }
    });
  });

  return pips;
}

function getPackManaPipSegments(pack) {
  const totals = MANA_ORDER.reduce(
    (counts, color) => ({ ...counts, [color]: 0 }),
    {},
  );

  (pack.cards || []).forEach((card) => {
    const cardPips = getCardManaPips(card);
    const quantity = card.quantity || 1;

    MANA_ORDER.forEach((color) => {
      totals[color] += cardPips[color] * quantity;
    });
  });

  const totalPips = MANA_ORDER.reduce((sum, color) => sum + totals[color], 0);

  if (totalPips === 0) {
    return [
      {
        color: "C",
        start: 0,
        end: 100,
        percentage: 100,
      },
    ];
  }

  let currentOffset = 0;

  return MANA_ORDER.map((color) => ({
    color,
    count: totals[color],
    percentage: (totals[color] / totalPips) * 100,
  }))
    .filter((segment) => segment.count > 0)
    .sort((segmentA, segmentB) => {
      if (segmentA.count !== segmentB.count) {
        return segmentA.count - segmentB.count;
      }

      return MANA_ORDER.indexOf(segmentA.color) - MANA_ORDER.indexOf(segmentB.color);
    })
    .map((segment) => {
      const start = currentOffset;
      const end = currentOffset + segment.percentage;

      currentOffset = end;

      return {
        ...segment,
        start,
        end,
      };
    });
}

function getPackManaBackdrop(pack) {
  return (
    <span className="cubePackManaBackdrop" aria-hidden="true">
      {getPackManaPipSegments(pack).map((segment, index, segments) => (
        <span
          className="cubePackManaSegment"
          key={segment.color}
          style={{
            "--segment-color": MANA_COLORS[segment.color],
            "--segment-start": `${segment.start}%`,
            "--segment-end": `${segment.end}%`,
            "--segment-left-slope": index === 0 ? "0px" : "8px",
            "--segment-right-slope":
              index === segments.length - 1 ? "0px" : "8px",
          }}
        />
      ))}
    </span>
  );
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
  const [showCubeStats, setShowCubeStats] = useState(false);

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

  function getPackColorColumnId(pack) {
    const colors = getPackColorIdentity(pack);

    if (colors.length === 0) return "C";
    if (colors.length > 1) return "M";

    return colors[0];
  }

  const colorIdentityColumns = CUBE_COLOR_COLUMNS.map((column) => ({
    ...column,
    packs: selectedPacks.filter(
      (pack) => getPackColorColumnId(pack) === column.id,
    ),
  }));
  const largestColorColumn = Math.max(
    1,
    ...colorIdentityColumns.map((column) => column.packs.length),
  );

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
    <aside
      className={`jumpCubeBox ${isOpen ? "open" : "closed"} ${
        showCubeStats ? "statsOpen" : ""
      }`}
    >
      <button
        className="jumpCubeToggle"
        onClick={() => {
          setShowCubeStats(false);
          setIsOpen((prev) => !prev);
        }}
        title={isOpen ? "Hide cube" : "Show cube"}
        aria-label={isOpen ? "Hide cube" : "Show cube"}
        aria-expanded={isOpen}
      >
        {isOpen ? "<" : ">"}
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

        <button
          className="cubeActionButton cubeStatsButton"
          type="button"
          onClick={() => {
            setConfirmingDeleteCube(false);
            setShowCubeStats(true);
          }}
          disabled={selectedPacks.length === 0}
          title="Show cube statistics"
          aria-label="Show cube statistics"
        >
          <span aria-hidden="true">%</span>
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

      {showCubeStats && (
        <div className="cubeStatsOverlay" role="dialog" aria-modal="true">
          <div className="cubeStatsHeader">
            <div>
              <h2>{cubeName}</h2>
              <p>{selectedPacks.length} packs selected</p>
            </div>

            <button
              className="cubeStatsCloseButton"
              type="button"
              onClick={() => setShowCubeStats(false)}
              aria-label="Close cube statistics"
              title="Close cube statistics"
            >
              x
            </button>
          </div>

          <div className="cubeStatsColumns" aria-label="Packs by color identity">
            {colorIdentityColumns.map((column) => (
              <section className="cubeStatsColumn" key={column.id}>
                <header className="cubeStatsColumnHeader">
                  <span>{column.label}</span>
                  <strong>{column.packs.length}</strong>
                </header>

                <div className="cubeStatsStack">
                  {column.packs.length === 0 ? (
                    <p className="cubeStatsEmpty">No packs</p>
                  ) : (
                    column.packs.map((pack) => (
                      <button
                        className="cubeStatsPack"
                        type="button"
                        key={pack.id}
                        onClick={() => {
                          setShowCubeStats(false);
                          handlePackClick(pack);
                        }}
                      >
                        {getPackManaBackdrop(pack)}
                        <span className="cubeStatsPackName">{pack.name}</span>
                      </button>
                    ))
                  )}
                </div>

                <dl className="cubeStatsData">
                  <div>
                    <dt>Packs</dt>
                    <dd>{column.packs.length}</dd>
                  </div>
                  <div>
                    <dt>Share</dt>
                    <dd>
                      {selectedPacks.length === 0
                        ? "0%"
                        : `${Math.round(
                            (column.packs.length / selectedPacks.length) * 100,
                          )}%`}
                    </dd>
                  </div>
                  <div>
                    <dt>Curve</dt>
                    <dd>
                      {Math.round(
                        (column.packs.length / largestColorColumn) * 100,
                      )}
                      %
                    </dd>
                  </div>
                </dl>
              </section>
            ))}
          </div>
        </div>
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
                {getPackManaBackdrop(pack)}
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
