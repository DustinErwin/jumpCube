import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  buildSampleDraftDeck,
  formatArenaDeckList,
  getSampleDraftChoices,
  shuffleItems,
} from "../../utils/sampleDraft";
import "./SampleDraftPage.css";

const OPENING_HAND_SIZE = 7;

function getPackId(pack) {
  return String(pack.savedPackId || pack.id);
}

function getCardImage(card) {
  return (
    card.image_url ||
    card.image_uris?.normal ||
    card.image_uris?.small ||
    card.card_faces?.[0]?.image_uris?.normal ||
    card.card_faces?.[0]?.image_uris?.small ||
    null
  );
}

function getPackImage(pack) {
  return (
    [...(pack.cards || [])]
      .reverse()
      .map(getCardImage)
      .find(Boolean) || null
  );
}

function getPackCardCount(pack) {
  return (pack.cards || []).reduce(
    (total, card) => total + (Number(card.quantity) || 0),
    0,
  );
}

function isLandCard(card) {
  return /\bland\b/i.test(card.type_line || "");
}

function DraftCardFace({ card }) {
  const image = getCardImage(card);

  return image ? (
    <img src={image} alt={card.name} />
  ) : (
    <span className="sampleDraftCardFallback">{card.name}</span>
  );
}

export default function SampleDraftPage({ cubeName, packs = [] }) {
  const navigate = useNavigate();
  const draftablePacks = packs.filter(
    (pack) => (pack.cards || []).length > 0,
  );
  const [draftNonce, setDraftNonce] = useState(0);
  const [pickedPacks, setPickedPacks] = useState([]);
  const [choices, setChoices] = useState(() =>
    getSampleDraftChoices(draftablePacks, [], 3),
  );
  const [deck, setDeck] = useState([]);
  const [hand, setHand] = useState([]);
  const [nonlandPermanents, setNonlandPermanents] = useState([]);
  const [landPermanents, setLandPermanents] = useState([]);
  const [tappedCardIds, setTappedCardIds] = useState(() => new Set());
  const [graveyard, setGraveyard] = useState([]);
  const [hasDrawnOpeningHand, setHasDrawnOpeningHand] = useState(false);

  const isDraftReady = pickedPacks.length === 2;
  const availablePackCount = draftablePacks.length;

  function restartDraft() {
    setPickedPacks([]);
    setDeck([]);
    setHand([]);
    setNonlandPermanents([]);
    setLandPermanents([]);
    setTappedCardIds(new Set());
    setGraveyard([]);
    setHasDrawnOpeningHand(false);
    setChoices(getSampleDraftChoices(draftablePacks, [], 3));
    setDraftNonce((currentNonce) => currentNonce + 1);
  }

  function choosePack(pack) {
    if (isDraftReady) return;

    const nextPickedPacks = [...pickedPacks, pack];
    setPickedPacks(nextPickedPacks);

    if (nextPickedPacks.length === 1) {
      setChoices(
        getSampleDraftChoices(draftablePacks, [getPackId(pack)], 3),
      );
      return;
    }

    setChoices([]);
    setDeck(buildSampleDraftDeck(nextPickedPacks));
  }

  function drawOpeningHand() {
    if (hasDrawnOpeningHand) return;

    setHand(deck.slice(0, OPENING_HAND_SIZE));
    setDeck(deck.slice(OPENING_HAND_SIZE));
    setHasDrawnOpeningHand(true);
  }

  function drawCard() {
    if (!hasDrawnOpeningHand || deck.length === 0) return;

    setHand((currentHand) => [...currentHand, deck[0]]);
    setDeck((currentDeck) => currentDeck.slice(1));
  }

  function reshuffleAndDrawHand() {
    const reshuffledDeck = shuffleItems([
      ...hand,
      ...deck,
      ...nonlandPermanents,
      ...landPermanents,
      ...graveyard,
    ]);

    setHand(reshuffledDeck.slice(0, OPENING_HAND_SIZE));
    setDeck(reshuffledDeck.slice(OPENING_HAND_SIZE));
    setNonlandPermanents([]);
    setLandPermanents([]);
    setTappedCardIds(new Set());
    setGraveyard([]);
    setHasDrawnOpeningHand(true);
  }

  function playCard(card) {
    setHand((currentHand) =>
      currentHand.filter(
        (handCard) => handCard.draftCardId !== card.draftCardId,
      ),
    );

    if (isLandCard(card)) {
      setLandPermanents((currentLands) => [...currentLands, card]);
      return;
    }

    setNonlandPermanents((currentPermanents) => [
      ...currentPermanents,
      card,
    ]);
  }

  function toggleTapped(cardId) {
    setTappedCardIds((currentTappedIds) => {
      const nextTappedIds = new Set(currentTappedIds);

      if (nextTappedIds.has(cardId)) {
        nextTappedIds.delete(cardId);
      } else {
        nextTappedIds.add(cardId);
      }

      return nextTappedIds;
    });
  }

  function moveToGraveyard(card, zone) {
    const removeFromZone = (cards) =>
      cards.filter(
        (battlefieldCard) =>
          battlefieldCard.draftCardId !== card.draftCardId,
      );

    if (zone === "land") {
      setLandPermanents(removeFromZone);
    } else {
      setNonlandPermanents(removeFromZone);
    }

    setTappedCardIds((currentTappedIds) => {
      const nextTappedIds = new Set(currentTappedIds);
      nextTappedIds.delete(card.draftCardId);
      return nextTappedIds;
    });
    setGraveyard((currentGraveyard) => [...currentGraveyard, card]);
  }

  function exportArenaDeck() {
    const allDraftCards = [
      ...hand,
      ...deck,
      ...nonlandPermanents,
      ...landPermanents,
      ...graveyard,
    ];
    const deckText = formatArenaDeckList(allDraftCards);
    const fileName = `${pickedPacks
      .map((pack) => pack.name)
      .join("-")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "sample-draft"}.txt`;
    const downloadUrl = URL.createObjectURL(
      new Blob([deckText], { type: "text/plain;charset=utf-8" }),
    );
    const downloadLink = document.createElement("a");

    downloadLink.href = downloadUrl;
    downloadLink.download = fileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    URL.revokeObjectURL(downloadUrl);
  }

  if (availablePackCount < 4) {
    return (
      <section className="sampleDraftPage">
        <header className="sampleDraftHeader">
          <button type="button" onClick={() => navigate("/create")}>
            Back to Cube
          </button>
          <div>
            <h1>Sample Draft</h1>
            <p>{cubeName}</p>
          </div>
        </header>

        <div className="sampleDraftEmpty">
          <h2>Add more packs to draft</h2>
          <p>
            A sample draft needs at least four packs so both rounds can present
            three unique choices.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="sampleDraftPage" key={draftNonce}>
      <header className="sampleDraftHeader">
        <button type="button" onClick={() => navigate("/create")}>
          Back to Cube
        </button>

        <div>
          <h1>Sample Draft</h1>
          <p>{cubeName}</p>
        </div>

        <button type="button" onClick={restartDraft}>
          Restart
        </button>
      </header>

      {!isDraftReady ? (
        <>
          <div className="sampleDraftRound">
            <span>Pick {pickedPacks.length + 1} of 2</span>
            <h2>Choose a pack</h2>
            <p>
              {pickedPacks.length === 0
                ? "Pick your first pack."
                : `${pickedPacks[0].name} is locked in. Choose its partner.`}
            </p>
          </div>

          <div className="sampleDraftChoices">
            {choices.map((pack) => {
              const packImage = getPackImage(pack);

              return (
                <button
                  className="sampleDraftPack"
                  type="button"
                  key={getPackId(pack)}
                  onClick={() => choosePack(pack)}
                >
                  {packImage && <img src={packImage} alt="" />}
                  <span>
                    <strong>{pack.name}</strong>
                    <small>{getPackCardCount(pack)} cards</small>
                    <small>{pack.description || "No description"}</small>
                  </span>
                </button>
              );
            })}
          </div>

          {pickedPacks.length > 0 && (
            <div className="sampleDraftPicks" aria-label="Selected packs">
              <strong>Selected</strong>
              <span>{pickedPacks.map((pack) => pack.name).join(" + ")}</span>
            </div>
          )}
        </>
      ) : (
        <div className="sampleDraftTable">
          <div className="sampleDraftDeckHeader">
            <div>
              <span>Draft complete</span>
              <h2>{pickedPacks.map((pack) => pack.name).join(" + ")}</h2>
              <p>
                {hand.length} cards in hand · {deck.length} cards remaining
              </p>
            </div>

            <div className="sampleDraftDeckActions">
              <button type="button" onClick={exportArenaDeck}>
                Export Arena Deck
              </button>

              {hasDrawnOpeningHand && (
                <button type="button" onClick={reshuffleAndDrawHand}>
                  Reshuffle + New Hand
                </button>
              )}

              {!hasDrawnOpeningHand ? (
                <button type="button" onClick={drawOpeningHand}>
                  Draw Opening Hand
                </button>
              ) : (
                <button
                  type="button"
                  onClick={drawCard}
                  disabled={deck.length === 0}
                >
                  {deck.length === 0 ? "Deck Empty" : "Draw Card"}
                </button>
              )}
            </div>
          </div>

          {hasDrawnOpeningHand ? (
            <>
              <section
                className="sampleDraftPlayArea"
                aria-label="Cards in play"
              >
                <div className="sampleDraftBattlefield">
                  <div className="sampleDraftPlayRow">
                    <div className="sampleDraftPlayCards">
                      {nonlandPermanents.map((card) => (
                          <div
                            className="sampleDraftPlayCardSlot"
                            key={card.draftCardId}
                          >
                            <button
                              className={`sampleDraftPlayCard${
                                tappedCardIds.has(card.draftCardId)
                                  ? " tapped"
                                  : ""
                              }`}
                              type="button"
                              onClick={() => toggleTapped(card.draftCardId)}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                moveToGraveyard(card, "nonland");
                              }}
                              aria-pressed={tappedCardIds.has(
                                card.draftCardId,
                              )}
                              title="Click to tap or untap. Right-click to move to graveyard."
                            >
                              <DraftCardFace card={card} />
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="sampleDraftPlayRow landRow">
                    <div className="sampleDraftPlayCards">
                      {landPermanents.map((card) => (
                          <div
                            className="sampleDraftPlayCardSlot"
                            key={card.draftCardId}
                          >
                            <button
                              className={`sampleDraftPlayCard${
                                tappedCardIds.has(card.draftCardId)
                                  ? " tapped"
                                  : ""
                              }`}
                              type="button"
                              onClick={() => toggleTapped(card.draftCardId)}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                moveToGraveyard(card, "land");
                              }}
                              aria-pressed={tappedCardIds.has(
                                card.draftCardId,
                              )}
                              title="Click to tap or untap. Right-click to move to graveyard."
                            >
                              <DraftCardFace card={card} />
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>

                <aside
                  className="sampleDraftGraveyard"
                  aria-label={`${graveyard.length} cards in graveyard`}
                >
                  <strong>Graveyard</strong>
                  <div className="sampleDraftGraveyardPile">
                    {graveyard.length > 0 ? (
                      <>
                        <DraftCardFace card={graveyard.at(-1)} />
                        <span className="sampleDraftGraveyardCount">
                          {graveyard.length}
                        </span>
                      </>
                    ) : (
                      <span className="sampleDraftZoneEmpty">Empty</span>
                    )}
                  </div>
                </aside>
              </section>

              <section className="sampleDraftHandArea">
                <div className="sampleDraftHandHeading">
                  <h3>Hand</h3>
                  <span>{hand.length} cards</span>
                </div>

                <div className="sampleDraftHand" aria-label="Draft hand">
                  {hand.map((card) => (
                    <button
                      className="sampleDraftCard"
                      type="button"
                      key={card.draftCardId}
                      onClick={() => playCard(card)}
                      title={`Play ${card.name}`}
                    >
                      <DraftCardFace card={card} />
                      <span className="sampleDraftCardPack">
                        {card.draftPackName}
                      </span>
                    </button>
                  ))}

                  {hand.length === 0 && (
                    <p className="sampleDraftEmptyHand">
                      Your hand is empty. Draw a card or reshuffle.
                    </p>
                  )}
                </div>
              </section>
            </>
          ) : (
            <div className="sampleDraftDeckReady">
              <strong>{deck.length}</strong>
              <span>cards shuffled and ready</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
