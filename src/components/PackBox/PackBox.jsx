import { useState } from "react";
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
}) {
  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [showManaCurve, setShowManaCurve] = useState(false);
  const { preview, startPreview, movePreview, stopPreview } =
    useCardPreview(250);

  const totalCards = selectedCards.reduce(
    (sum, card) => sum + card.quantity,
    0,
  );

  return (
    <aside className="packBox">
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
      <p className="packCount">{totalCards} cards selected</p>
      <button
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
      )}
      {selectedCards.length === 0 ? (
        <p className="emptyPack">Click cards to add them here.</p>
      ) : (
        <div className="packList">
          {selectedCards.map((card) => (
            <div
              className="packCard"
              key={card.id}
              onMouseEnter={(e) => startPreview(card, e)}
              onMouseMove={movePreview}
              onMouseLeave={stopPreview}
            >
              <img src={card.image_url} alt={card.name} />

              <div>
                <p className="packCardName">{card.name}</p>
                <p className="packQuantity">Qty: {card.quantity}</p>

                <div className="packButtons">
                  <button onClick={() => decreaseCardQuantity(card.id)}>
                    -
                  </button>

                  <button onClick={() => addCard(card)}>+</button>

                  <button onClick={() => removeCard(card.id)}>Remove</button>
                </div>
              </div>
            </div>
          ))}
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
        </div>
      )}
      <CardPreview preview={preview} />
    </aside>
  );
}
