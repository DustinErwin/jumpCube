import { useState } from "react";
import "./CardBox.css";

/*
 * CardBox renders the searchable card grid.
 *
 * Props:
 * - cards: Array<card row> from useCards()
 * - onCardOpen(card): opens CardModal
 * - selectedCards: active pack cards with quantity
 * - onCardAdd(card): add one copy to the active pack
 * - onCardDecrease(cardId): remove one copy from active pack
 * - setIsDraggingCard(boolean): informs PackBox drag-over styling
 * - isSelectionDisabled: true when pack limit is reached
 */
export default function CardBox({
  cards,
  onCardOpen,
  selectedCards = [],
  onCardAdd,
  onCardDecrease,
  setIsDraggingCard,
  isSelectionDisabled = false,
  ownedQuantities = new Map(),
}) {
  const [flippedCards, setFlippedCards] = useState({});

  function getCardIdentity(card) {
    return String(
      card?.oracle_id ||
        card?.card_search_id ||
        card?.name ||
        card?.variant_id ||
        card?.id ||
        "",
    );
  }

  function getCardQuantity(card) {
    const cardIdentity = getCardIdentity(card);

    return selectedCards.reduce(
      (totalQuantity, selectedCard) =>
        getCardIdentity(selectedCard) === cardIdentity
          ? totalQuantity + selectedCard.quantity
          : totalQuantity,
      0,
    );
  }

  function getFrontImage(card) {
    // Cards imported before image normalization may still rely on card_faces.
    return (
      card.image_url ||
      card.image_uris?.normal ||
      card.image_uris?.small ||
      card.card_faces?.[0]?.image_uris?.normal ||
      card.card_faces?.[0]?.image_uris?.small ||
      card.card_faces?.[0]?.small?.normal ||
      card.card_faces?.[0]?.small?.small ||
      null
    );
  }

  function getBackImage(card) {
    // Only show the flip button for a real second face. back_image_url alone can
    // be stale/over-filled, so it is only a fallback for multi-face cards.
    const secondFaceImage =
      card.card_faces?.[1]?.image_uris?.normal ||
      card.card_faces?.[1]?.image_uris?.small ||
      card.card_faces?.[1]?.small?.normal ||
      card.card_faces?.[1]?.small?.small ||
      null;

    if (secondFaceImage) {
      return secondFaceImage;
    }

    if (card.card_faces?.length > 1) {
      return card.back_image_url || null;
    }

    return null;
  }

  function getFlipKey(card, index) {
    // Stable key for both React rendering and per-card flip state.
    return String(card.scryfall_id || card.id || `${card.name}-${index}`);
  }

  return (
    <>
      <div className="cardGrid">
        {cards.map((card, index) => {
          const frontImage = getFrontImage(card);
          const backImage = getBackImage(card);
          const canFlip = Boolean(backImage);
          const flipKey = getFlipKey(card, index);
          const isFlipped = Boolean(flippedCards[flipKey]);
          const quantity = getCardQuantity(card);
          const ownershipId = card.card_search_id || card.id;
          const ownedQuantity = ownedQuantities.get(ownershipId) || 0;

          return (
            <div
              className={`cardBox${isFlipped ? " flipped" : ""}`}
              key={flipKey}
              draggable={!isSelectionDisabled}
              title={
                isSelectionDisabled
                  ? "Pack limit reached"
                  : card.name
              }
              onDragStart={(e) => {
                // Drag payload is the full card row so PackBox can add it
                // without refetching.
                if (isSelectionDisabled) {
                  e.preventDefault();
                  return;
                }

                setIsDraggingCard(true);

                e.dataTransfer.effectAllowed = "copy";
                e.dataTransfer.setData(
                  "application/json",
                  JSON.stringify(card),
                );
              }}
              onDragEnd={() => {
                setIsDraggingCard(false);
              }}
              onClick={() => {
                onCardOpen?.(card);
              }}
            >
              {frontImage && (
                <div className="cardFlipFrame">
                  <div className="cardFlipInner">
                    <img
                      className="cardFace cardFaceFront"
                      src={frontImage}
                      alt={card.name}
                      loading="lazy"
                    />
                    {canFlip && (
                      <img
                        className="cardFace cardFaceBack"
                        src={backImage}
                        alt={`${card.name} back face`}
                        loading="lazy"
                      />
                    )}
                  </div>
                </div>
              )}

              {canFlip && (
                <button
                  type="button"
                  className="cardFlipButton"
                  onClick={(event) => {
                    event.stopPropagation();
                    setFlippedCards((currentFlippedCards) => ({
                      ...currentFlippedCards,
                      [flipKey]: !currentFlippedCards[flipKey],
                    }));
                  }}
                  aria-label={`Flip ${card.name}`}
                  aria-pressed={isFlipped}
                  title="Flip card"
                >
                  ↻
                </button>
              )}

              <div
                className={`cardQuantityControls${
                  ownedQuantity > 0 ? " hasOwnedCount" : ""
                }`}
                aria-label={`${card.name} pack quantity controls`}
              >
                {ownedQuantity > 0 && (
                  <span
                    className="cardOwnedCount"
                    aria-label={`${ownedQuantity} owned`}
                    title={`${ownedQuantity} owned`}
                  >
                    {ownedQuantity}
                  </span>
                )}

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCardDecrease?.(getCardIdentity(card));
                  }}
                  disabled={quantity === 0}
                  aria-label={`Remove one ${card.name} from pack`}
                >
                  -
                </button>

                <span aria-label={`${quantity} in pack`}>{quantity}</span>

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCardAdd?.(card);
                  }}
                  disabled={isSelectionDisabled}
                  aria-label={`Add one ${card.name} to pack`}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
