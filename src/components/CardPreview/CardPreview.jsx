import "./CardPreview.css";

export default function CardPreview({ preview }) {
  if (!preview) return null;

  const image =
    preview.card.image_url ||
    preview.card.raw?.small?.normal ||
    preview.card.raw?.card_faces?.[0]?.small?.normal ||
    null;

  if (!image) return null;

  return (
    <div
      className="cardPreview"
      style={{
        left: preview.x - 380,
        top: preview.y - 180,
      }}
    >
      <img src={image} alt={preview.card.name} />
    </div>
  );
}
