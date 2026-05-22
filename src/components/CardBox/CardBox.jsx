import "./CardBox.css";

export default function CardBox({ cards, onCardSelect }) {
  return (
    <div className="cardGrid">
      {cards.map((card) => {
        const image =
          card.image_uris?.png || card.card_faces?.[0]?.image_uris?.png;

        return (
          <div
            className="cardBox"
            key={card.id || card.name}
            onClick={() => onCardSelect(card)}
          >
            {" "}
            {image && <img className="cardImage" src={image} alt={card.name} />}
            <p className="cardName">{card.name}</p>
            <p className="cardPrice">${card.prices?.usd ?? "N/A"}</p>
          </div>
        );
      })}
    </div>
  );
}
