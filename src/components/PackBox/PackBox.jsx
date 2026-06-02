import { useRef, useState } from "react";
import CardPreview from "../CardPreview/CardPreview";
import { useCardPreview } from "../../hooks/useCardPreview";
import "./PackBox.css";

export default function PackBox({
  packName,
  setPackName,
  selectedCards,
  addCard,
  decreaseCardQuantity,
  removeCard,
  savePack,
  packDescription,
  setPackDescription,
  newPack,
  saveStatus,
  showRenameChoice,
  pendingSaveAction,
  moveCard,
  isDraggingCard,
  setIsDraggingCard,
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
  // const [showManaCurve, setShowManaCurve] = useState(false);
  const { preview, startPreview, movePreview, stopPreview } =
    useCardPreview(250);

  const totalCards = selectedCards.reduce(
    (sum, card) => sum + card.quantity,
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
      >
        {isOpen ? "›" : "‹"}
      </button>
      {editingName ? (
        <input
          className="packNameInput"
          value={packName}
          autoFocus
          onChange={(e) => setPackName(e.target.value)}
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
      <p className="packCount">{totalCards} cards selected</p>
      <button
        className={`savePackButton ${saveStatus === "saving" ? "saving" : ""}`}
        onClick={savePack}
        disabled={selectedCards.length === 0 || saveStatus === "saving"}
      >
        {saveStatus === "saving" ? "Saving..." : "Save Pack"}
      </button>

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
      <button className="newPackButton" onClick={newPack}>
        New Pack
      </button>
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
              </div>
            ))}
          </div>
        )}
      </div>
      {!isDraggingCard && <CardPreview preview={preview} />}
    </aside>
  );
}
