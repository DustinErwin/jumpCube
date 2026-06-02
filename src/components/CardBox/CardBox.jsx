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
      card.raw?.small?.normal ||
      card.raw?.card_faces?.[0]?.small?.normal ||
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

              <p className="cardName">{card.name}</p>
              <p className="cardPrice">${card.price_usd ?? "--"}</p>
              <p className="cardPrice">Foil: ${card.price_usd_foil ?? "--"}</p>
            </div>
          );
        })}
      </div>

      {!isDraggingCard && <CardPreview preview={preview} />}
    </>
  );
}
