import { useEffect, useRef, useState } from "react";
import {
  PACK_ARCHETYPE_TAGS,
  PACK_CARD_LIMIT,
} from "../../hooks/usePackBuilder";
import {
  getPrimaryCardMechanicBucket,
  PACK_MECHANIC_BUCKETS,
} from "../../utils/cardMechanics";
import "./PackBox.css";

/*
 * PackBox is the active pack editor panel.
 *
 * Props are controlled by usePackBuilder/App:
 * - packName/description/archetypeTags/visibility plus their setters
 * - selectedCards: Array<card row & { quantity, manualMechanicBucket? }>
 * - addCard(card), decreaseCardQuantity(cardId)
 * - addCurrentPackToCube(): saves current pack and inserts/updates cube item
 * - deletePack(savedPackId), newPack()
 * - moveCard(draggedCardId, targetCardId)
 * - moveCardToMechanicBucket(cardId, bucketId)
 * - isOpen/setIsOpen: side-panel collapsed state
 */

const PACK_TITLE_MAX_LENGTH = 40;
// Update CARD_TYPE_COLORS/LABELS together when changing the type pie chart.
const CARD_TYPE_COLORS = {
  Artifact: "#9aa3ad",
  Creature: "#65a765",
  Enchantment: "#b084d6",
  Instant: "#5d95d6",
  Land: "#b68a58",
  Planeswalker: "#d16b6b",
  Sorcery: "#d6b85d",
};
const CARD_TYPES = Object.keys(CARD_TYPE_COLORS);
const CARD_TYPE_LABELS = {
  Artifact: "Artifacts",
  Creature: "Creatures",
  Enchantment: "Enchantments",
  Instant: "Instants",
  Land: "Lands",
  Planeswalker: "Planeswalkers",
  Sorcery: "Sorceries",
};
const IDEAL_MANA_CURVE = [1, 4, 3, 2, 1, 1];
// Pack archetype tag colors. Keep keys synced with PACK_ARCHETYPE_TAGS.
const ARCHETYPE_COLORS = {
  Aggro: { background: "#c93f32", color: "white" },
  Control: { background: "#2f77c8", color: "white" },
  Midrange: { background: "#d8c58f", color: "white" },
  Combo: { background: "#7b4aa1", color: "white" },
  Ramp: { background: "#3f9650", color: "white" },
  Tempo: { background: "#727a80", color: "white" },
};

function getCardPrice(card) {
  // Uses normalized price_usd first, with old raw prices fallback.
  const price = card.price_usd ?? card.prices?.usd ?? 0;
  const numericPrice = Number(price);

  return Number.isFinite(numericPrice) ? numericPrice : 0;
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function getArchetypeTagStyle(tag) {
  const colors = ARCHETYPE_COLORS[tag] || {
    background: "#252525",
    color: "white",
  };

  return {
    "--archetype-tag-bg": colors.background,
    "--archetype-tag-text": colors.color,
  };
}

function getCardTypes(card) {
  // Type matching avoids accidental substring hits inside longer words.
  const typeLine = card.type_line || "";

  return CARD_TYPES.filter((type) =>
    new RegExp(`(^|[^A-Za-z])${type}([^A-Za-z]|$)`, "i").test(typeLine),
  );
}

export default function PackBox({
  packName,
  setPackName,
  selectedCards,
  addCard,
  decreaseCardQuantity,
  onCardOpen,
  addCurrentPackToCube,
  onOpenPacks,
  deletePack,
  savedPackId,
  packDescription,
  setPackDescription,
  packArchetypeTags = [],
  setPackArchetypeTags,
  packVisibility = "private",
  setPackVisibility,
  newPack,
  saveStatus,
  showRenameChoice,
  pendingSaveAction,
  moveCard,
  moveCardToMechanicBucket,
  isDraggingCard,
  isOpen,
  setIsOpen,
}) {
  // Drag state controls normal pack-stack reordering and stats-column moves.
  const [draggedCardId, setDraggedCardId] = useState(null);
  const [dragOverCardId, setDragOverCardId] = useState(null);
  const [draggedStatsCardId, setDraggedStatsCardId] = useState(null);
  const [suppressStackHover, setSuppressStackHover] = useState(false);
  const droppedInsidePackRef = useRef(false);
  const [isDragOverPack, setIsDragOverPack] = useState(false);
  const cardDragStartedRef = useRef(false);

  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [confirmingDeletePack, setConfirmingDeletePack] = useState(false);
  const [isArchetypeMenuOpen, setIsArchetypeMenuOpen] = useState(false);
  const [showPackStats, setShowPackStats] = useState(false);
  const [visibilityMessage, setVisibilityMessage] = useState("");
  const visibilityMessageTimeoutRef = useRef(null);
  // const [showManaCurve, setShowManaCurve] = useState(false);

  const totalCards = selectedCards.reduce(
    (sum, card) => sum + card.quantity,
    0,
  );
  const totalPrice = selectedCards.reduce(
    (sum, card) => sum + getCardPrice(card) * card.quantity,
    0,
  );

  const packColorIdentity = [
    ...new Set(selectedCards.flatMap((card) => card.color_identity || [])),
  ];

  const colorOrder = ["W", "U", "B", "R", "G"];

  const sortedPackColors = colorOrder.filter((color) =>
    packColorIdentity.includes(color),
  );

  // Expand quantities into visual copies so stats/stack views reflect the
  // actual pack count while still saving one row per card id.
  const displayedCards = selectedCards.flatMap((card) =>
    Array.from({ length: card.quantity }, (_, index) => ({
      ...card,
      stackId: `${card.id}-${index}`,
      copyNumber: index + 1,
    })),
  );
  // Stats-view columns are mechanic buckets. Manual user placement is handled
  // by getPrimaryCardMechanicBucket().
  const mechanicColumns = PACK_MECHANIC_BUCKETS.map((bucket) => ({
    ...bucket,
    cards: displayedCards.filter((card) => {
      return getPrimaryCardMechanicBucket(card)?.id === bucket.id;
    }),
  }));
  const mechanicBucketCounts = mechanicColumns.map((column) => ({
    id: column.id,
    label: column.label,
    shortLabel: column.shortLabel,
    color: column.color,
    count: column.cards.length,
  }));
  // Bar chart buckets use 6+ as the final bucket.
  const manaCurveChartColumns = [1, 2, 3, 4, 5, 6].map((manaValue, index) => ({
    manaValue,
    idealCount: IDEAL_MANA_CURVE[index],
    label: manaValue === 6 ? "6+" : String(manaValue),
    cards: displayedCards.filter((card) => {
      const cardManaValue = Number(card.mana_value || 0);
      const bucket = cardManaValue >= 6 ? 6 : Math.max(0, cardManaValue);

      return bucket === manaValue;
    }),
  }));
  const largestManaCurveChartCount = Math.max(
    1,
    ...manaCurveChartColumns.map((column) =>
      Math.max(column.cards.length, column.idealCount),
    ),
  );
  const manaCurveLevelLines = Array.from(
    { length: largestManaCurveChartCount },
    (_, index) => largestManaCurveChartCount - index,
  );
  const cardTypeCounts = CARD_TYPES.map((type) => ({
    type,
    count: displayedCards.filter((card) => getCardTypes(card).includes(type))
      .length,
  }));
  const totalTypeCount = cardTypeCounts.reduce(
    (sum, typeCount) => sum + typeCount.count,
    0,
  );
  // Conic-gradient segments for the type pie chart.
  const typeChartSegments = cardTypeCounts.reduce((segments, typeCount) => {
    const percentage =
      totalTypeCount === 0 ? 0 : (typeCount.count / totalTypeCount) * 100;
    const start = segments.reduce(
      (sum, segment) => sum + segment.percentage,
      0,
    );
    const end = start + percentage;

    return [
      ...segments,
      {
        ...typeCount,
        percentage,
        start,
        end,
      },
    ];
  }, []);
  const typeChartBackground =
    totalTypeCount === 0
      ? "#252525"
      : `conic-gradient(${typeChartSegments
          .filter((segment) => segment.count > 0)
          .map(
            (segment) =>
              `${CARD_TYPE_COLORS[segment.type]} ${segment.start}% ${segment.end}%`,
          )
          .join(", ")})`;
  const largestMechanicCount = Math.max(
    1,
    ...mechanicBucketCounts.map((mechanic) => mechanic.count),
  );
  const mechanicChartWidth = 520;
  const mechanicChartHeight = 150;
  const mechanicChartPadding = 18;
  const mechanicChartInnerWidth =
    mechanicChartWidth - mechanicChartPadding * 2;
  const mechanicChartInnerHeight =
    mechanicChartHeight - mechanicChartPadding * 2;
  const mechanicChartPoints = mechanicBucketCounts.map((mechanic, index) => {
    const x =
      mechanicBucketCounts.length === 1
        ? mechanicChartWidth / 2
        : mechanicChartPadding +
          (index / (mechanicBucketCounts.length - 1)) *
            mechanicChartInnerWidth;
    const y =
      mechanicChartPadding +
      mechanicChartInnerHeight -
      (mechanic.count / largestMechanicCount) * mechanicChartInnerHeight;

    return {
      ...mechanic,
      x,
      y,
    };
  });
  const mechanicPolylinePoints = mechanicChartPoints
    .map((point) => `${point.x},${point.y}`)
    .join(" ");

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

  function deleteConfirmedPack() {
    // Actual delete lives in usePackBuilder so database and current pack state
    // are reset together.
    if (!savedPackId) return;

    deletePack(savedPackId);
    setConfirmingDeletePack(false);
  }

  function toggleArchetypeTag(tag) {
    // Multiple archetypes are allowed; empty list means no archetype color tags.
    setPackArchetypeTags((currentTags) => {
      if (currentTags.includes(tag)) {
        return currentTags.filter((currentTag) => currentTag !== tag);
      }

      return [...currentTags, tag];
    });
  }

  function togglePackVisibility() {
    // Visibility autosaves through usePackBuilder; the message is only local UI.
    const nextVisibility = packVisibility === "public" ? "private" : "public";

    setPackVisibility(nextVisibility);
    setVisibilityMessage(nextVisibility === "public" ? "Public" : "Private");

    if (visibilityMessageTimeoutRef.current) {
      window.clearTimeout(visibilityMessageTimeoutRef.current);
    }

    visibilityMessageTimeoutRef.current = window.setTimeout(() => {
      setVisibilityMessage("");
      visibilityMessageTimeoutRef.current = null;
    }, 1800);
  }

  useEffect(() => {
    return () => {
      if (visibilityMessageTimeoutRef.current) {
        window.clearTimeout(visibilityMessageTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!confirmingDeletePack) return undefined;

    function cancelDeleteConfirmation(event) {
      if (
        event.target.closest(".confirmDeletePackButton") ||
        event.target.closest(".deletePackButton")
      ) {
        return;
      }

      setConfirmingDeletePack(false);
    }

    window.addEventListener("click", cancelDeleteConfirmation);

    return () => {
      window.removeEventListener("click", cancelDeleteConfirmation);
    };
  }, [confirmingDeletePack]);

  return (
    <aside
      className={`packBox 
        ${isDragOverPack ? "dragOverPack" : ""}
        ${isDraggingCard ? "isDragging" : ""}
        ${isOpen ? "open" : "closed"}
        ${showPackStats ? "statsOpen" : ""}
        ${suppressStackHover ? "suppressStackHover" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setSuppressStackHover(true);
      }}
      onDragLeave={() => {
        setIsDragOverPack(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setSuppressStackHover(false);

        const cardData = e.dataTransfer.getData("application/json");

        if (!cardData) return;

        addCard(JSON.parse(cardData));
      }}
    >
      <button
        className="packBoxToggle"
        onClick={() => {
          setShowPackStats(false);
          setIsOpen((prev) => !prev);
        }}
        title={isOpen ? "Hide pack" : "Show pack"}
        aria-label={isOpen ? "Hide pack" : "Show pack"}
        aria-expanded={isOpen}
      >
        {isOpen ? ">" : "<"}
      </button>

      <div className="packActionToolbar" aria-label="Pack actions">
        <button
          className={`packVisibilitySwitch ${packVisibility}`}
          type="button"
          onClick={togglePackVisibility}
          aria-label={`Pack visibility: ${
            packVisibility === "public" ? "Public" : "Private"
          }`}
          aria-pressed={packVisibility === "public"}
          title={
            packVisibility === "public"
              ? "Pack is public"
              : "Pack is private"
          }
        >
          <span aria-hidden="true" />
        </button>

        <button
          className="packActionButton openPacksButton"
          type="button"
          onClick={() => {
            setConfirmingDeletePack(false);
            onOpenPacks();
          }}
          title="Open my packs"
          aria-label="Open my packs"
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
          className="packActionButton newPackButton"
          type="button"
          onClick={() => {
            setConfirmingDeletePack(false);
            newPack();
          }}
          title="New pack"
          aria-label="New pack"
        >
          <span aria-hidden="true">+</span>
        </button>

        <button
          className="packActionButton deletePackButton"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setConfirmingDeletePack((current) => !current);
          }}
          disabled={!savedPackId}
          title={savedPackId ? "Delete pack" : "Save this pack before deleting"}
          aria-label={
            savedPackId ? "Delete pack" : "Save this pack before deleting"
          }
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
          <span aria-hidden="true">Ã—</span>
        </button>

        <button
          className="packActionButton addPackToCubeButton"
          type="button"
          onClick={() => {
            setConfirmingDeletePack(false);
            addCurrentPackToCube();
          }}
          disabled={selectedCards.length === 0 || saveStatus === "saving"}
          title="Save and add pack to cube"
          aria-label="Save and add pack to cube"
        >
          <svg
            aria-hidden="true"
            className="actionIcon"
            viewBox="0 0 24 24"
            focusable="false"
          >
            <path d="M4 5h7v7H4z" />
            <path d="M13 5h7v7h-7z" />
            <path d="M4 14h7v7H4z" />
            <path d="M15 14h3v3h3v2h-3v3h-2v-3h-3v-2h3z" />
          </svg>
          <span aria-hidden="true">âŠž</span>
        </button>

        <button
          className="packActionButton archetypeMenuButton"
          type="button"
          onClick={() => {
            setConfirmingDeletePack(false);
            setIsArchetypeMenuOpen((current) => !current);
          }}
          title="Add archetype tag"
          aria-label="Add archetype tag"
          aria-expanded={isArchetypeMenuOpen}
        >
          <span aria-hidden="true">#</span>
        </button>

        <button
          className="packActionButton packStatsButton"
          type="button"
          onClick={() => {
            setConfirmingDeletePack(false);
            setShowPackStats(true);
          }}
          disabled={selectedCards.length === 0}
          title="Show pack statistics"
          aria-label="Show pack statistics"
        >
          <span aria-hidden="true">%</span>
        </button>
      </div>

      {visibilityMessage && (
        <p
          className={`visibilityMessage ${
            visibilityMessage === "Public" ? "public" : "private"
          }`}
        >
          {visibilityMessage}
        </p>
      )}

      {confirmingDeletePack && (
        <button
          className="confirmDeletePackButton"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            deleteConfirmedPack();
          }}
          aria-label={`Confirm delete ${packName}`}
        >
          Delete {packName}
        </button>
      )}

      {editingName ? (
        <input
          className="packNameInput"
          value={packName}
          maxLength={PACK_TITLE_MAX_LENGTH}
          autoFocus
          onChange={(e) =>
            setPackName(e.target.value.slice(0, PACK_TITLE_MAX_LENGTH))
          }
          onBlur={() => setEditingName(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setEditingName(false);
          }}
        />
      ) : (
        <h2 className="packTitle" onClick={() => setEditingName(true)}>
          {packName}
        </h2>
      )}
      {editingDescription ? (
        <textarea
          className="packDescriptionInput"
          value={packDescription}
          placeholder="Click to add a description..."
          autoFocus
          onChange={(e) => setPackDescription(e.target.value)}
          onBlur={() => setEditingDescription(false)}
        />
      ) : (
        <p
          className="packDescription"
          onClick={() => setEditingDescription(true)}
          title="Click to edit description"
        >
          {packDescription || (
            <span className="placeholderText">
              Click to add a description...
            </span>
          )}
        </p>
      )}
      <div className="packMetadata">
        <div className="packColorIdentity">
          {sortedPackColors.length === 0 ? (
            <i className="ms ms-c manaSymbol manaSymbolC" title="Colorless" />
          ) : (
            sortedPackColors.map((color) => (
              <i
                className={`ms ${getManaClass(color)} manaSymbol manaSymbol${color}`}
                key={color}
                title={color}
              />
            ))
          )}
        </div>
      </div>
      <p className="packCount">
        {totalCards} / {PACK_CARD_LIMIT} cards selected
      </p>

      {totalCards >= PACK_CARD_LIMIT && (
        <p className="packLimitMessage">Pack limit reached</p>
      )}

      <div className="packVisibilityToggle" aria-label="Pack visibility">
        <span>Visibility</span>
        <button
          type="button"
          className={packVisibility === "public" ? "public" : "private"}
          onClick={() =>
            setPackVisibility((currentVisibility) =>
              currentVisibility === "public" ? "private" : "public",
            )
          }
          aria-pressed={packVisibility === "public"}
        >
          {packVisibility === "public" ? "Public" : "Private"}
        </button>
      </div>

      <div className="packActionToolbar" aria-label="Pack actions">
        <button
          className="packActionButton openPacksButton"
          type="button"
          onClick={() => {
            setConfirmingDeletePack(false);
            onOpenPacks();
          }}
          title="Open my packs"
          aria-label="Open my packs"
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
          className="packActionButton newPackButton"
          type="button"
          onClick={() => {
            setConfirmingDeletePack(false);
            newPack();
          }}
          title="New pack"
          aria-label="New pack"
        >
          <span aria-hidden="true">+</span>
        </button>

        <button
          className="packActionButton deletePackButton"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setConfirmingDeletePack((current) => !current);
          }}
          disabled={!savedPackId}
          title={savedPackId ? "Delete pack" : "Save this pack before deleting"}
          aria-label={
            savedPackId ? "Delete pack" : "Save this pack before deleting"
          }
        >
          <span aria-hidden="true">×</span>
        </button>

        <button
          className="packActionButton addPackToCubeButton"
          type="button"
          onClick={() => {
            setConfirmingDeletePack(false);
            addCurrentPackToCube();
          }}
          disabled={selectedCards.length === 0 || saveStatus === "saving"}
          title="Save and add pack to cube"
          aria-label="Save and add pack to cube"
        >
          <span aria-hidden="true">⊞</span>
        </button>
        <button
          className="packActionButton archetypeMenuButton"
          type="button"
          onClick={() => {
            setConfirmingDeletePack(false);
            setIsArchetypeMenuOpen((current) => !current);
          }}
          title="Add archetype tag"
          aria-label="Add archetype tag"
          aria-expanded={isArchetypeMenuOpen}
        >
          <span aria-hidden="true">#</span>
        </button>

        <button
          className="packActionButton packStatsButton"
          type="button"
          onClick={() => {
            setConfirmingDeletePack(false);
            setShowPackStats(true);
          }}
          disabled={selectedCards.length === 0}
          title="Show pack statistics"
          aria-label="Show pack statistics"
        >
          <span aria-hidden="true">%</span>
        </button>
      </div>

      {packArchetypeTags.length > 0 && (
        <div className="packArchetypeTags" aria-label="Selected archetypes">
          {packArchetypeTags.map((tag) => (
            <span
              className="packArchetypeTag"
              key={tag}
              style={getArchetypeTagStyle(tag)}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {isArchetypeMenuOpen && (
        <div className="archetypeMenu" aria-label="Archetype tags">
          <div className="archetypeMenuHeader">
            <span>Archetypes</span>
            <button
              type="button"
              onClick={() => setPackArchetypeTags([])}
              disabled={packArchetypeTags.length === 0}
            >
              Clear
            </button>
          </div>

          <div className="archetypeOptions">
            {PACK_ARCHETYPE_TAGS.map((tag) => (
              <label className="archetypeOption" key={tag}>
                <input
                  type="checkbox"
                  checked={packArchetypeTags.includes(tag)}
                  onChange={() => toggleArchetypeTag(tag)}
                />
                {tag}
              </label>
            ))}
          </div>
        </div>
      )}

      <p className="packTotalPrice">Total: {formatUsd(totalPrice)}</p>

      {saveStatus === "saving" && <p className="saveMessage">Saving...</p>}

      {saveStatus === "saved" && (
        <p className="saveMessage success">Pack saved ✓</p>
      )}

      {saveStatus === "error" && (
        <p className="saveMessage error">Save failed</p>
      )}

      {showPackStats && (
        <div className="packStatsOverlay" role="dialog" aria-modal="true">
          <div className="packStatsHeader">
            <div>
              <h2>{packName}</h2>
              <p>
                {totalCards} / {PACK_CARD_LIMIT} cards selected
              </p>
            </div>

            <button
              className="packStatsCloseButton"
              type="button"
              onClick={() => setShowPackStats(false)}
              aria-label="Close pack statistics"
              title="Close pack statistics"
            >
              x
            </button>
          </div>

          <div className="packStatsBody">
            <div
              className="packStatsColumns"
              aria-label="Cards by mechanic"
            >
              {mechanicColumns.map((column) => (
                <section
                  className={`packStatsColumn ${
                    draggedStatsCardId ? "canDropStatsCard" : ""
                  }`}
                  key={column.id}
                  onDragOver={(e) => {
                    if (!draggedStatsCardId) return;

                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const statsCardId =
                      draggedStatsCardId ||
                      e.dataTransfer.getData("text/pack-stats-card");

                    moveCardToMechanicBucket?.(statsCardId, column.id);
                    setDraggedStatsCardId(null);
                  }}
                >
                  <header className="packStatsColumnHeader">
                    <span>{column.label}</span>
                  </header>

                  <div
                    className="packStatsStack"
                    onDragOver={(e) => {
                      if (!draggedStatsCardId) return;

                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();

                      const statsCardId =
                        draggedStatsCardId ||
                        e.dataTransfer.getData("text/pack-stats-card");

                      moveCardToMechanicBucket?.(statsCardId, column.id);
                      setDraggedStatsCardId(null);
                    }}
                  >
                    {column.cards.length === 0 ? (
                      <p className="packStatsEmpty">No cards</p>
                    ) : (
                      column.cards.map((card) => (
                        <div
                          className="packStatsCard"
                          draggable
                          key={card.stackId}
                          onClick={() => onCardOpen?.(card)}
                          onDragStart={(e) => {
                            e.stopPropagation();
                            setDraggedStatsCardId(card.id);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData(
                              "text/pack-stats-card",
                              String(card.id),
                            );
                          }}
                          onDragEnd={(e) => {
                            e.stopPropagation();
                            setDraggedStatsCardId(null);
                          }}
                        >
                          <img
                            src={card.image_url}
                            alt={card.name}
                            draggable={false}
                          />
                        </div>
                      ))
                    )}
                  </div>
                </section>
              ))}
            </div>

            <section className="packStatsVisualArea" aria-label="Pack statistics">
              <div className="packManaCurveChart">
                <h3 className="packManaCurveTitle">Mana Curve</h3>

                <div className="packManaCurveLegend">
                  <span>
                    <i className="packManaCurveLegendSwatch current" />
                    Current
                  </span>
                  <span>
                    <i className="packManaCurveLegendSwatch ideal" />
                    Ideal
                  </span>
                </div>

                <div className="packManaCurveBars">
                  <div className="packManaCurveGrid" aria-hidden="true">
                    {manaCurveLevelLines.map((level) => (
                      <div
                        className="packManaCurveGridLine"
                        key={level}
                        style={{
                          bottom: `${(level / largestManaCurveChartCount) * 100}%`,
                        }}
                      >
                        <span>{level}</span>
                      </div>
                    ))}
                  </div>

                  {manaCurveChartColumns.map((column) => (
                    <div className="packManaCurveBarGroup" key={column.label}>
                      <div className="packManaCurveBarTrack">
                        <div
                          className="packManaCurveIdealBar"
                          style={{
                            height: `${Math.max(
                              4,
                              (column.idealCount / largestManaCurveChartCount) *
                                100,
                            )}%`,
                          }}
                        />
                        <div
                          className="packManaCurveBar"
                          style={{
                            height:
                              column.cards.length === 0
                                ? "0%"
                                : `${Math.max(
                                    4,
                                    (column.cards.length /
                                      largestManaCurveChartCount) *
                                      100,
                                  )}%`,
                          }}
                        />
                      </div>
                      <span>{column.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="packTypeChart" aria-label="Card type percentages">
                <div
                  className="packTypePie"
                  style={{ "--type-chart": typeChartBackground }}
                />

                <div className="packTypeLegend">
                  {typeChartSegments.map((segment) => (
                    <div className="packTypeLegendItem" key={segment.type}>
                      <span
                        className="packTypeSwatch"
                        style={{
                          "--type-color": CARD_TYPE_COLORS[segment.type],
                        }}
                      />
                      <span className="packTypeCount">{segment.count}</span>
                      <span>{CARD_TYPE_LABELS[segment.type]}</span>
                      <strong>{Math.round(segment.percentage)}%</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div
                className="packMechanicChart"
                aria-label="Card mechanics profile"
              >
                <svg
                  className="packMechanicSvg"
                  viewBox={`0 0 ${mechanicChartWidth} ${mechanicChartHeight}`}
                  role="img"
                  aria-label="Mechanical action counts"
                >
                  <polyline
                    className="packMechanicLine"
                    points={mechanicPolylinePoints}
                  />
                  {mechanicChartPoints.map((point) => (
                    <g key={point.id}>
                      <line
                        className="packMechanicGuide"
                        x1={point.x}
                        x2={point.x}
                        y1={mechanicChartPadding}
                        y2={mechanicChartHeight - mechanicChartPadding}
                      />
                      <circle
                        className="packMechanicDot"
                        cx={point.x}
                        cy={point.y}
                        r="4.5"
                        style={{ "--mechanic-color": point.color }}
                      />
                      <text
                        className="packMechanicCount"
                        x={point.x}
                        y={Math.max(12, point.y - 8)}
                      >
                        {point.count}
                      </text>
                    </g>
                  ))}
                </svg>

                <div className="packMechanicLabels">
                  {mechanicChartPoints.map((point) => (
                    <span key={point.id} title={point.label}>
                      {point.shortLabel}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {showRenameChoice && (
        <div className="renameChoiceBox">
          <p className="renameTitle">Pack name changed</p>

          <p className="renameText">
            Update existing pack or create a new version?
          </p>

          <button
            className="renameButton"
            onClick={pendingSaveAction?.renameExisting}
          >
            Update Existing
          </button>

          <button
            className="renameButton secondary"
            onClick={pendingSaveAction?.saveAsNew}
          >
            Save As New
          </button>
        </div>
      )}
      {/* <button
        className="manaCurveToggle"
        onClick={() => setShowManaCurve((prev) => !prev)}
      >
        {showManaCurve ? "Mana Curve ▲" : "Mana Curve ▼"}
      </button>

      {showManaCurve && (
        <div className="manaCurve">
          <h3>Mana Curve</h3>

          {[0, 1, 2, 3, 4, 5, 6, 7].map((mv) => {
            const count = selectedCards.reduce((sum, card) => {
              const cardMv = Number(card.mana_value);
              const bucket = cardMv >= 7 ? 7 : cardMv;

              return bucket === mv ? sum + card.quantity : sum;
            }, 0);

            const maxCount = Math.max(
              1,
              ...[0, 1, 2, 3, 4, 5, 6, 7].map((curveMv) =>
                selectedCards.reduce((sum, card) => {
                  const cardMv = Number(card.mana_value);
                  const bucket = cardMv >= 7 ? 7 : cardMv;

                  return bucket === curveMv ? sum + card.quantity : sum;
                }, 0),
              ),
            );

            return (
              <div className="curveRow" key={mv}>
                <span className="curveLabel">{mv === 7 ? "7+" : mv}</span>

                <div className="curveBarWrap">
                  <div
                    className="curveBar"
                    style={{ width: `${(count / maxCount) * 100}%` }}
                  />
                </div>

                <span className="curveCount">{count}</span>
              </div>
            );
          })}
        </div>
      )} */}
      <div className="packCardScrollArea">
        {selectedCards.length === 0 ? (
          <p className="emptyPack">Add cards to start your pack.</p>
        ) : (
          <div className="stackedPackCards">
            {displayedCards.map((card) => (
              <div
                className={`stackedPackCard ${
                  dragOverCardId === card.id ? "dragOver" : ""
                }`}
                key={card.stackId}
                draggable
                onDragStart={(e) => {
                  cardDragStartedRef.current = true;
                  setDraggedCardId(card.id);
                  setSuppressStackHover(true);

                  droppedInsidePackRef.current = false;

                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/pack-card", String(card.id));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverCardId(card.id);
                }}
                onDragLeave={() => setDragOverCardId(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setSuppressStackHover(false);
                  droppedInsidePackRef.current = true;

                  const internalPackCard =
                    e.dataTransfer.getData("text/pack-card");
                  if (internalPackCard) return;

                  const cardData = e.dataTransfer.getData("application/json");
                  if (!cardData) return;

                  addCard(JSON.parse(cardData));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  droppedInsidePackRef.current = true;

                  const internalPackCard =
                    e.dataTransfer.getData("text/pack-card");
                  const externalCardData =
                    e.dataTransfer.getData("application/json");

                  // Reordering an existing card already in the pack
                  if (internalPackCard) {
                    moveCard(draggedCardId, card.id);
                    setDraggedCardId(null);
                    setDragOverCardId(null);
                    setSuppressStackHover(false);
                    return;
                  }

                  // Dragging a card from the search/card grid into the pack
                  if (externalCardData) {
                    addCard(JSON.parse(externalCardData));
                    setDraggedCardId(null);
                    setDragOverCardId(null);
                    setSuppressStackHover(false);
                    return;
                  }
                }}
                onDragEnd={() => {
                  if (
                    cardDragStartedRef.current &&
                    !droppedInsidePackRef.current
                  ) {
                    decreaseCardQuantity(card.id);
                  }

                  cardDragStartedRef.current = false;
                  droppedInsidePackRef.current = false;
                  setDraggedCardId(null);
                  setDragOverCardId(null);
                  setSuppressStackHover(false);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  decreaseCardQuantity(card.id);
                }}
                onClick={() => {
                  if (cardDragStartedRef.current) return;

                  onCardOpen?.(card);
                }}
              >
                <img src={card.image_url} alt={card.name} />
                <button
                  className="mobileRemoveCardButton"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    decreaseCardQuantity(card.id);
                  }}
                  aria-label={`Remove one ${card.name} from pack`}
                  title={`Remove one ${card.name}`}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
