import { useEffect, useState } from "react";
import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  sanitizeDescription,
  sanitizeTitle,
} from "../../utils/userText";
import "./JumpCubeBox.css";

/*
 * JumpCubeBox is the active cube editor panel.
 *
 * Props:
 * - cubeName/cubeDescription plus setters: controlled cube metadata
 * - selectedPacks: Array<pack summary> from App/useUserCubes
 * - onOpenCubes(): opens CubeLibraryModal
 * - onOpenPack(packId): loads a cube pack into PackBox
 * - removePackFromCube(packId): removes relationship from current cube
 * - newCube(): resets active cube editor state
 * - saveStatus: "saving" | "saved" | "error" | ""
 * - isOpen/setIsOpen: side-panel collapsed state
 */

// Colors used for the mana-pip percentage backdrop on each pack item.
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
  // Stats view groups packs by overall color identity, not mana-cost pips.
  { id: "W", label: "White" },
  { id: "U", label: "Blue" },
  { id: "B", label: "Black" },
  { id: "R", label: "Red" },
  { id: "G", label: "Green" },
  { id: "C", label: "Colorless" },
  { id: "M", label: "Multicolor" },
];

function getManaCost(card) {
  return card.mana_cost || "";
}

function getCardManaPips(card) {
  // Counts colored/colorless symbols in mana_cost only. Generic costs are
  // intentionally ignored.
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
  /*
   * Converts all card mana pips in a pack into percentage segments.
   * Segments are sorted ascending by count so the largest color lands on the
   * right side after CSS positioning.
   */
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
  // Returns layered spans whose CSS variables draw the slanted color divisions.
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
    // Pack removal is a two-step right-click flow: first right-click arms the
    // item, second right-click removes it. Left/click elsewhere cancels.
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

  useEffect(() => {
    // Cube delete confirmation behaves like pack delete: any outside click
    // cancels the pending action.
    if (!confirmingDeleteCube) return undefined;

    function cancelDeleteConfirmation(event) {
      if (
        event.target.closest(".confirmDeleteCubeButton") ||
        event.target.closest(".deleteCubeButton")
      ) {
        return;
      }

      setConfirmingDeleteCube(false);
    }

    window.addEventListener("click", cancelDeleteConfirmation);

    return () => {
      window.removeEventListener("click", cancelDeleteConfirmation);
    };
  }, [confirmingDeleteCube]);

  function deleteConfirmedCube() {
    newCube();
    setConfirmingDeleteCube(false);
  }

  function getPackColorIdentity(pack) {
    // Loaded cubes and live-added packs use slightly different property names;
    // cards fallback keeps older summaries displayable.
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
    // Used only by cube stats view columns.
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
    // Right-click/touch context menu removal flow.
    event.preventDefault();

    if (pendingRemovePackId === packId) {
      removePackFromCube(packId);
      setPendingRemovePackId(null);
      return;
    }

    setPendingRemovePackId(packId);
  }

  function handlePackClick(pack) {
    // Left click opens the saved pack in PackBox.
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
          maxLength={TITLE_MAX_LENGTH}
          autoFocus
          onChange={(e) =>
            setCubeName(sanitizeTitle(e.target.value, ""))
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
          maxLength={DESCRIPTION_MAX_LENGTH}
          placeholder="Click to add a cube description..."
          autoFocus
          onChange={(e) =>
            setCubeDescription(sanitizeDescription(e.target.value))
          }
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
          onClick={(event) => {
            event.stopPropagation();
            setConfirmingDeleteCube((current) => !current);
          }}
          disabled={selectedPacks.length === 0 && !cubeDescription.trim()}
          title="Clear cube"
          aria-label="Clear cube"
        >
          <svg
            aria-hidden="true"
            className="actionIcon"
            viewBox="0 0 24 24"
            focusable="false"
          >
            <path d="M9 3h6l1 2h5v2H3V5h5z" />
            <path d="M6 9h12l-1 12H7z" />
            <path className="actionIconInset" d="M10 11h2v8h-2z" />
            <path className="actionIconInset" d="M14 11h2v8h-2z" />
          </svg>
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
          onClick={(event) => {
            event.stopPropagation();
            deleteConfirmedCube();
          }}
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
