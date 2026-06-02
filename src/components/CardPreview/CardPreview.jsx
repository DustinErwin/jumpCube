import "./CardPreview.css";

export default function CardPreview({ preview }) {
  if (!preview) return null;

  const frontImage =
    preview.card.image_url ||
    preview.card.raw?.image_uris?.normal ||
    preview.card.raw?.card_faces?.[0]?.image_uris?.normal ||
    null;

  const possibleBackImage =
    preview.card.back_image_url ||
    preview.card.raw?.card_faces?.[1]?.image_uris?.normal ||
    null;

  const hasRealBackFace =
    preview.card.has_back_face &&
    possibleBackImage &&
    possibleBackImage !== frontImage;

  if (!frontImage) return null;

  const previewWidth = hasRealBackFace ? 732 : 360;
  const cursorGap = 24;
  const cursorIsOnLeftSide = preview.x < window.innerWidth / 2;

  const left = cursorIsOnLeftSide
    ? preview.x + cursorGap
    : preview.x - previewWidth - cursorGap;

  return (
    <div
      className={`cardPreview ${hasRealBackFace ? "hasBackFace" : ""}`}
      style={{
        left,
        top: preview.y - 180,
      }}
    >
      <img src={frontImage} alt={preview.card.name} />

      {hasRealBackFace && (
        <img src={possibleBackImage} alt={`${preview.card.name} back face`} />
      )}
    </div>
  );
}
