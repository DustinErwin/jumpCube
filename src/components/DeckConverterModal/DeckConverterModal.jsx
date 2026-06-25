import { useState } from "react";
import "./DeckConverterModal.css";

const DEFAULT_PACK_NAME = "Converted Deck Pack";

export default function DeckConverterModal({
  isOpen,
  onClose,
  onConvert,
}) {
  const [deckText, setDeckText] = useState("");
  const [packName, setPackName] = useState(DEFAULT_PACK_NAME);
  const [isConverting, setIsConverting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [conversionResult, setConversionResult] = useState(null);

  if (!isOpen) return null;

  function closeModal() {
    setDeckText("");
    setPackName(DEFAULT_PACK_NAME);
    setErrorMessage("");
    setConversionResult(null);
    onClose();
  }

  async function convertDeck(event) {
    event.preventDefault();
    setErrorMessage("");
    setIsConverting(true);

    try {
      const result = await onConvert(
        deckText,
        packName.trim() || DEFAULT_PACK_NAME,
      );

      setConversionResult(result);
    } catch (error) {
      setErrorMessage(error?.message || "Deck could not be converted.");
    } finally {
      setIsConverting(false);
    }
  }

  return (
    <div className="deckConverterOverlay" onClick={closeModal}>
      <section
        className="deckConverterModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deckConverterTitle"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="deckConverterHeader">
          <h2 id="deckConverterTitle">Convert Arena Deck</h2>
          <button
            type="button"
            onClick={closeModal}
            aria-label="Close deck converter"
          >
            x
          </button>
        </header>

        {conversionResult ? (
          <div className="deckConverterResult">
            <p>
              Created a {conversionResult.packCardCount}-card draft from{" "}
              {conversionResult.parsedCardCount} main-deck cards.
            </p>
            <dl>
              <div>
                <dt>Imported lands removed</dt>
                <dd>{conversionResult.importedLandNames.length}</dd>
              </div>
              <div>
                <dt>Cards trimmed</dt>
                <dd>{conversionResult.trimmedCount}</dd>
              </div>
              <div>
                <dt>Unresolved names</dt>
                <dd>{conversionResult.missingNames.length}</dd>
              </div>
            </dl>

            {conversionResult.missingNames.length > 0 && (
              <div className="deckConverterMissing">
                <strong>Not imported</strong>
                <p>{conversionResult.missingNames.join(", ")}</p>
              </div>
            )}

            <div className="deckConverterActions">
              <button type="button" onClick={closeModal}>
                View Pack
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={convertDeck}>
          <label>
            Pack name
            <input
              type="text"
              value={packName}
              maxLength={80}
              onChange={(event) => setPackName(event.target.value)}
              disabled={isConverting}
              required
            />
          </label>

          <label>
            Arena deck list
            <textarea
              value={deckText}
              onChange={(event) => setDeckText(event.target.value)}
              placeholder={"Deck\n4 Card Name\n4 Another Card\n\nSideboard\n3 Sideboard Card"}
              disabled={isConverting}
              autoFocus
              required
            />
          </label>

          <p className="deckConverterNote">
            This replaces the current editor with a new draft. Imported lands
            and the Sideboard section are excluded.
          </p>

          {errorMessage && (
            <p className="deckConverterError" role="alert">
              {errorMessage}
            </p>
          )}

          <div className="deckConverterActions">
            <button
              type="button"
              onClick={closeModal}
              disabled={isConverting}
            >
              Cancel
            </button>
            <button type="submit" disabled={isConverting || !deckText.trim()}>
              {isConverting ? "Converting..." : "Convert Deck"}
            </button>
          </div>
          </form>
        )}
      </section>
    </div>
  );
}
