import "./CardBox.css";
import CardPreview from "../CardPreview/CardPreview";
import { useCardPreview } from "../../hooks/useCardPreview";

export default function CardBox({ cards, onCardSelect }) {
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
        {cards.map((card) => {
          const image = getImage(card);

          return (
            <div
              className="cardBox"
              key={card.id || card.scryfall_id || card.name}
              onClick={() => onCardSelect?.(card)}
              onMouseEnter={(e) => startPreview(card, e)}
              onMouseMove={movePreview}
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

      <CardPreview preview={preview} />
    </>
  );
}
