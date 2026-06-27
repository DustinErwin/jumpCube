import { useState } from "react";
import { createPortal } from "react-dom";
import "./DeckConverterModal.css";

const DEFAULT_PACK_NAME = "Converted Deck Pack";
const IMPORT_SOURCES = {
  arena: "arena",
  mtgo: "mtgo",
};

export default function DeckConverterModal({
  isOpen,
  onClose,
  onConvert,
  onFinalize,
}) {
  const [deckText, setDeckText] = useState("");
  const [mtgoDeckText, setMtgoDeckText] = useState("");
  const [mtgoFileName, setMtgoFileName] = useState("");
  const [importSource, setImportSource] = useState(IMPORT_SOURCES.arena);
  const [packName, setPackName] = useState(DEFAULT_PACK_NAME);
  const [isConverting, setIsConverting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [conversionResult, setConversionResult] = useState(null);
  const [keptCards, setKeptCards] = useState([]);
  const [removedCards, setRemovedCards] = useState([]);

  if (!isOpen) return null;

  function closeModal() {
    setDeckText("");
    setMtgoDeckText("");
    setMtgoFileName("");
    setImportSource(IMPORT_SOURCES.arena);
    setPackName(DEFAULT_PACK_NAME);
    setErrorMessage("");
    setConversionResult(null);
    setKeptCards([]);
    setRemovedCards([]);
    onClose();
  }

  function clearDefaultPackName() {
    if (packName === DEFAULT_PACK_NAME) {
      setPackName("");
    }
  }

  async function loadMtgoFile(event) {
    const file = event.target.files?.[0];

    setErrorMessage("");
    setMtgoDeckText("");
    setMtgoFileName("");

    if (!file) return;

    try {
      const fileText = await file.text();

      setMtgoDeckText(fileText);
      setMtgoFileName(file.name);

      if (
        (packName === DEFAULT_PACK_NAME || !packName.trim()) &&
        file.name
      ) {
        setPackName(file.name.replace(/\.dek$/i, "").trim());
      }
    } catch (error) {
      setErrorMessage(error?.message || "The MTGO .dek file could not be read.");
    }
  }

  function getCardKey(card) {
    return String(card.variant_id || card.id || card.card_search_id || card.name);
  }

  function getTotalCards(cards) {
    return cards.reduce((sum, card) => sum + (Number(card.quantity) || 0), 0);
  }

  function mergeCardIntoList(cards, nextCard) {
    const nextKey = getCardKey(nextCard);
    const existingCard = cards.find((card) => getCardKey(card) === nextKey);

    if (!existingCard) return [...cards, nextCard];

    return cards.map((card) =>
      getCardKey(card) === nextKey
        ? {
            ...card,
            quantity:
              (Number(card.quantity) || 0) + (Number(nextCard.quantity) || 0),
          }
        : card,
    );
  }

  function removeCardQuantityFromList(cards, targetCard, quantity = 1) {
    const targetKey = getCardKey(targetCard);

    return cards
      .map((card) =>
        getCardKey(card) === targetKey
          ? {
              ...card,
              quantity: Math.max(0, (Number(card.quantity) || 0) - quantity),
            }
          : card,
      )
      .filter((card) => (Number(card.quantity) || 0) > 0);
  }

  function getMatchingCard(cards, targetCard) {
    const targetKey = getCardKey(targetCard);

    return cards.find((card) => getCardKey(card) === targetKey) || null;
  }

  function moveOneCard(card, from, to) {
    const setFromCards = from === "kept" ? setKeptCards : setRemovedCards;
    const setToCards = to === "kept" ? setKeptCards : setRemovedCards;

    setFromCards((currentCards) =>
      removeCardQuantityFromList(currentCards, card, 1),
    );
    setToCards((currentCards) =>
      mergeCardIntoList(currentCards, {
        ...card,
        quantity: 1,
        removalReason:
          to === "removed" ? card.removalReason || "Manually removed" : null,
      }),
    );
  }

  function finalizeConversion() {
    if (keptCards.length === 0) {
      setErrorMessage("Keep at least one card before creating the pack.");
      return;
    }

    onFinalize?.(keptCards, packName.trim() || DEFAULT_PACK_NAME, conversionResult);
    closeModal();
  }

  async function convertDeck(event) {
    event.preventDefault();
    setErrorMessage("");
    setIsConverting(true);

    try {
      const sourceText =
        importSource === IMPORT_SOURCES.mtgo ? mtgoDeckText : deckText;
      const result = await onConvert(
        sourceText,
        packName.trim() || DEFAULT_PACK_NAME,
        importSource,
      );

      setConversionResult(result);
      setKeptCards(result.cards || []);
      setRemovedCards(result.removedCards || []);
    } catch (error) {
      setErrorMessage(error?.message || "Deck could not be converted.");
    } finally {
      setIsConverting(false);
    }
  }

  const canConvert =
    importSource === IMPORT_SOURCES.mtgo
      ? Boolean(mtgoDeckText.trim())
      : Boolean(deckText.trim());

  const modal = (
    <div className="deckConverterOverlay" onClick={closeModal}>
      <section
        className={`deckConverterModal ${
          conversionResult ? "reviewMode" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="deckConverterTitle"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="deckConverterHeader">
          <h2 id="deckConverterTitle">Import Deck</h2>
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
              {conversionResult.mode === "direct" &&
                `Imported ${conversionResult.packCardCount} cards directly.`}
              {conversionResult.mode === "converted" &&
                `Created a ${conversionResult.packCardCount}-card draft from ${conversionResult.parsedCardCount} main-deck cards.`}
              {conversionResult.mode === "commander" &&
                `Created a ${conversionResult.packCardCount}-card commander pack from ${conversionResult.parsedCardCount} main-deck cards.`}
            </p>
            {conversionResult.mode === "commander" && (
              <p className="deckConverterCommander">
                Commander: <strong>{conversionResult.commanderName}</strong>
              </p>
            )}
            <dl>
              {conversionResult.mode !== "direct" && (
                <>
                  <div>
                    <dt>Imported lands removed</dt>
                    <dd>{conversionResult.importedLandNames.length}</dd>
                  </div>
                  <div>
                    <dt>Cards trimmed</dt>
                    <dd>{conversionResult.trimmedCount}</dd>
                  </div>
                </>
              )}
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

            {errorMessage && (
              <p className="deckConverterError" role="alert">
                {errorMessage}
              </p>
            )}

            <div className="deckConverterReviewSummary">
              <strong>
                Kept {getTotalCards(keptCards)}
                {conversionResult.mode !== "direct" &&
                  ` / ${conversionResult.packCardCount}`}
              </strong>
              <span>{removedCards.length} removable entries</span>
            </div>

            <div className="deckConverterReview">
              <section>
                <h3>Kept</h3>
                <div className="deckConverterCardList">
                  {keptCards.map((card) => (
                    <div className="deckConverterCardRow" key={getCardKey(card)}>
                      <strong>{card.name}</strong>
                      <div
                        className="deckConverterQuantityControls"
                        aria-label={`${card.name} kept quantity controls`}
                      >
                        <button
                          type="button"
                          onClick={() => moveOneCard(card, "kept", "removed")}
                          aria-label={`Remove one ${card.name} from converted pack`}
                        >
                          -
                        </button>
                        <span>{card.quantity}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const matchingRemovedCard = getMatchingCard(
                              removedCards,
                              card,
                            );

                            if (matchingRemovedCard) {
                              moveOneCard(matchingRemovedCard, "removed", "kept");
                            }
                          }}
                          disabled={
                            !getMatchingCard(removedCards, card) ||
                            getTotalCards(keptCards) >=
                              conversionResult.packCardCount
                          }
                          aria-label={`Add one ${card.name} back to converted pack`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3>Removed</h3>
                <div className="deckConverterCardList">
                  {removedCards.length === 0 ? (
                    <p className="deckConverterEmpty">Nothing removed</p>
                  ) : (
                    removedCards.map((card) => {
                      const wouldExceedLimit =
                        getTotalCards(keptCards) + 1 >
                        conversionResult.packCardCount;

                      return (
                        <div
                          className="deckConverterCardRow"
                          key={getCardKey(card)}
                        >
                          <strong>{card.name}</strong>
                          <small>{card.removalReason}</small>
                          <div
                            className="deckConverterQuantityControls"
                            aria-label={`${card.name} removed quantity controls`}
                          >
                            <button
                              type="button"
                              disabled
                              aria-label={`${card.name} is already removed`}
                            >
                              -
                            </button>
                            <span>{card.quantity}</span>
                            <button
                              type="button"
                              onClick={() => moveOneCard(card, "removed", "kept")}
                              disabled={wouldExceedLimit}
                              aria-label={`Keep one ${card.name} in converted pack`}
                              title={
                                wouldExceedLimit
                                  ? "Remove another kept card first."
                                  : "Keep one copy"
                              }
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            </div>

            <div className="deckConverterActions">
              <button
                type="button"
                onClick={() => {
                  setConversionResult(null);
                  setKeptCards([]);
                  setRemovedCards([]);
                  setErrorMessage("");
                }}
              >
                Back
              </button>
              <button type="button" onClick={closeModal}>
                Cancel
              </button>
              <button
                className="deckConverterPrimaryAction"
                type="button"
                onClick={finalizeConversion}
              >
                Create Pack
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
              onFocus={clearDefaultPackName}
              disabled={isConverting}
              required
            />
          </label>

          <div className="deckConverterSourceControl" role="group" aria-label="Deck import source">
            <button
              type="button"
              className={importSource === IMPORT_SOURCES.arena ? "active" : ""}
              onClick={() => setImportSource(IMPORT_SOURCES.arena)}
              disabled={isConverting}
            >
              Arena paste
            </button>
            <button
              type="button"
              className={importSource === IMPORT_SOURCES.mtgo ? "active" : ""}
              onClick={() => setImportSource(IMPORT_SOURCES.mtgo)}
              disabled={isConverting}
            >
              MTGO .dek
            </button>
          </div>

          {importSource === IMPORT_SOURCES.mtgo ? (
            <label className="deckConverterFileDrop">
              MTGO .dek file
              <input
                type="file"
                accept=".dek,application/xml,text/xml,text/plain"
                onChange={loadMtgoFile}
                disabled={isConverting}
                required
              />
              <span>
                {mtgoFileName || "Choose a Magic Online deck file"}
              </span>
            </label>
          ) : (
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
          )}

          <p className="deckConverterNote">
            Arena sideboards and MTGO sideboard cards are excluded. Lists at or
            below the current pack limit import directly; larger decks are
            converted into a pack with generated basic lands.
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
            <button type="submit" disabled={isConverting || !canConvert}>
              {isConverting ? "Importing..." : "Import Deck"}
            </button>
          </div>
          </form>
        )}
      </section>
    </div>
  );

  if (typeof document === "undefined") return modal;

  return createPortal(modal, document.body);
}
