import "./CardBox.css";

export default function CardBox({
  cards,
  onCardOpen,
  selectedCards = [],
  onCardAdd,
  onCardDecrease,
  setIsDraggingCard,
  isSelectionDisabled = false,
}) {
  function getCardQuantity(card) {
    return selectedCards.find((selectedCard) => selectedCard.id === card.id)
      ?.quantity || 0;
  }

  function getImage(card) {
    return (
      card.image_url ||
      card.raw?.image_uris?.normal ||
      card.raw?.image_uris?.small ||
      card.raw?.small?.normal ||
      card.raw?.small?.small ||
      card.raw?.card_faces?.[0]?.image_uris?.normal ||
      card.raw?.card_faces?.[0]?.image_uris?.small ||
      card.raw?.card_faces?.[0]?.small?.normal ||
      card.raw?.card_faces?.[0]?.small?.small ||
      null
    );
  }

  return (
    <>
      <div className="cardGrid">
        {cards.map((card, index) => {
          const image = getImage(card);
          const quantity = getCardQuantity(card);

          return (
            <div
              className="cardBox"
              key={`${card.scryfall_id || card.id || card.name}-${index}`}
              draggable={!isSelectionDisabled}
              title={
                isSelectionDisabled
                  ? "Pack limit reached"
                  : card.name
              }
              onDragStart={(e) => {
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
              {image && <img src={image} alt={card.name} loading="lazy" />}
              <div
                className="cardQuantityControls"
                aria-label={`${card.name} pack quantity controls`}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCardDecrease?.(card.id);
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
