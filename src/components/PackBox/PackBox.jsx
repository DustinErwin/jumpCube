import { useRef, useState } from "react";
import {
  PACK_ARCHETYPE_TAGS,
  PACK_CARD_LIMIT,
} from "../../hooks/usePackBuilder";
import "./PackBox.css";

const PACK_TITLE_MAX_LENGTH = 40;
const ARCHETYPE_COLORS = {
  Aggro: { background: "#c93f32", color: "white" },
  Control: { background: "#2f77c8", color: "white" },
  Midrange: { background: "#d8c58f", color: "white" },
  Combo: { background: "#7b4aa1", color: "white" },
  Ramp: { background: "#3f9650", color: "white" },
  Tempo: { background: "#727a80", color: "white" },
};

function getCardPrice(card) {
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

export default function PackBox({
  packName,
  setPackName,
  selectedCards,
  addCard,
  decreaseCardQuantity,
  addCurrentPackToCube,
  onOpenPacks,
  deletePack,
  savedPackId,
  packDescription,
  setPackDescription,
  packArchetypeTags = [],
  setPackArchetypeTags,
  newPack,
  saveStatus,
  showRenameChoice,
  pendingSaveAction,
  moveCard,
  isDraggingCard,
  isOpen,
  setIsOpen,
}) {
  // Drag state constants
  const [draggedCardId, setDraggedCardId] = useState(null);
  const [dragOverCardId, setDragOverCardId] = useState(null);
  const [suppressStackHover, setSuppressStackHover] = useState(false);
  const droppedInsidePackRef = useRef(false);
  const [isDragOverPack, setIsDragOverPack] = useState(false);

  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [confirmingDeletePack, setConfirmingDeletePack] = useState(false);
  const [isArchetypeMenuOpen, setIsArchetypeMenuOpen] = useState(false);
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

  const displayedCards = selectedCards.flatMap((card) =>
    Array.from({ length: card.quantity }, (_, index) => ({
      ...card,
      stackId: `${card.id}-${index}`,
      copyNumber: index + 1,
    })),
  );

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
    if (!savedPackId) return;

    deletePack(savedPackId);
    setConfirmingDeletePack(false);
  }

  function toggleArchetypeTag(tag) {
    setPackArchetypeTags((currentTags) => {
      if (currentTags.includes(tag)) {
        return currentTags.filter((currentTag) => currentTag !== tag);
      }

      return [...currentTags, tag];
    });
  }

  return (
    <aside
      className={`packBox 
        ${isDragOverPack ? "dragOverPack" : ""}
        ${isDraggingCard ? "isDragging" : ""}
        ${isOpen ? "open" : "closed"}
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
        onClick={() => setIsOpen((prev) => !prev)}
        title={isOpen ? "Hide pack" : "Show pack"}
        aria-label={isOpen ? "Hide pack" : "Show pack"}
        aria-expanded={isOpen}
      >
        {isOpen ? "›" : "‹"}
      </button>
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
          onClick={() => setConfirmingDeletePack((current) => !current)}
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

      {confirmingDeletePack && (
        <button
          className="confirmDeletePackButton"
          type="button"
          onClick={deleteConfirmedPack}
          aria-label={`Confirm delete ${packName}`}
        >
          Delete {packName}
        </button>
      )}

      {saveStatus === "saving" && <p className="saveMessage">Saving...</p>}

      {saveStatus === "saved" && (
        <p className="saveMessage success">Pack saved ✓</p>
      )}

      {saveStatus === "error" && (
        <p className="saveMessage error">Save failed</p>
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
          <p className="emptyPack">Click cards to add them here.</p>
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
                  if (!droppedInsidePackRef.current) {
                    decreaseCardQuantity(card.id);
                  }

                  droppedInsidePackRef.current = false;
                  setDraggedCardId(null);
                  setDragOverCardId(null);
                  setSuppressStackHover(false);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  decreaseCardQuantity(card.id);
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
