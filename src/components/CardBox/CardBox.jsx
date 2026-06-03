import "./CardBox.css";
import CardPreview from "../CardPreview/CardPreview";
import { useCardPreview } from "../../hooks/useCardPreview";

export default function CardBox({
  cards,
  onCardSelect,
  isDraggingCard,
  setIsDraggingCard,
}) {
  const { preview, startPreview, movePreview, stopPreview } =
    useCardPreview(250);

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

          return (
            <div
              className="cardBox"
              key={`${card.scryfall_id || card.id || card.name}-${index}`}
              draggable
              title={card.name}
              onDragStart={(e) => {
                stopPreview();
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
              onClick={() => onCardSelect?.(card)}
              onMouseEnter={(e) => {
                if (!isDraggingCard) startPreview(card, e);
              }}
              onMouseMove={(e) => {
                if (!isDraggingCard) movePreview(e);
              }}
              onMouseLeave={stopPreview}
            >
              {image && <img src={image} alt={card.name} loading="lazy" />}
            </div>
          );
        })}
      </div>

      {!isDraggingCard && <CardPreview preview={preview} />}
    </>
  );
}
