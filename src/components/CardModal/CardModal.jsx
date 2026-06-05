import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../utils/supabase";
import "./CardModal.css";

const CARD_VERSION_COLUMNS = `
  id,
  scryfall_id,
  oracle_id,
  name,
  mana_value,
  colors,
  color_identity,
  type_line,
  oracle_text,
  rarity,
  image_url,
  back_image_url,
  legalities,
  price_usd,
  price_usd_foil,
  games,
  nonfoil,
  is_token,
  is_funny,
  is_default_printing,
  is_variant_printing,
  is_planechase,
  set_name,
  set_code,
  collector_number,
  has_back_face
`;

function getImage(card) {
  return (
    card?.image_url ||
    card?.raw?.image_uris?.normal ||
    card?.raw?.image_uris?.small ||
    card?.raw?.card_faces?.[0]?.image_uris?.normal ||
    card?.raw?.card_faces?.[0]?.image_uris?.small ||
    null
  );
}

function formatArray(values, fallback = "None") {
  return Array.isArray(values) && values.length > 0
    ? values.join(", ")
    : fallback;
}

function formatMoney(value) {
  const number = Number(value);

  return Number.isFinite(number) ? `$${number.toFixed(2)}` : "N/A";
}

function getLegalFormats(legalities) {
  if (!legalities || typeof legalities !== "object") return [];

  return Object.entries(legalities)
    .filter(([, status]) => status === "legal")
    .map(([format]) => format);
}

function getVersionLabel(card) {
  const setCode = card.set_code ? card.set_code.toUpperCase() : "Set";
  const collectorNumber = card.collector_number || "?";
  const rarity = card.rarity ? `, ${card.rarity}` : "";

  return `${setCode} #${collectorNumber}${rarity}`;
}

export default function CardModal({
  card,
  isOpen,
  onClose,
  onAddToPack,
  isPackFull,
}) {
  const [versions, setVersions] = useState([]);
  const [selectedCardId, setSelectedCardId] = useState(String(card?.id || ""));
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [versionsError, setVersionsError] = useState("");

  useEffect(() => {
    if (!isOpen || !card) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [card, isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !card) return undefined;

    let isCurrent = true;

    async function loadVersions() {
      setIsLoadingVersions(true);
      setVersionsError("");

      let query = supabase
        .from("cards")
        .select(CARD_VERSION_COLUMNS)
        .contains("games", ["paper"])
        .eq("is_token", false)
        .eq("is_funny", false)
        .eq("is_planechase", false)
        .neq("layout", "art_series")
        .order("set_code", { ascending: true })
        .order("collector_number", { ascending: true });

      if (card.oracle_id) {
        query = query.eq("oracle_id", card.oracle_id);
      } else {
        query = query.eq("name", card.name);
      }

      const { data, error } = await query;

      if (!isCurrent) return;

      if (error) {
        console.error("Error loading card versions:", error);
        setVersionsError("Could not load versions.");
        setVersions([card]);
        setIsLoadingVersions(false);
        return;
      }

      setVersions(data?.length ? data : [card]);
      setIsLoadingVersions(false);
    }

    loadVersions();

    return () => {
      isCurrent = false;
    };
  }, [card, isOpen]);

  const selectedCard = useMemo(
    () =>
      versions.find((version) => String(version.id) === selectedCardId) || card,
    [card, selectedCardId, versions],
  );

  if (!isOpen || !card || !selectedCard) return null;

  const image = getImage(selectedCard);
  const legalFormats = getLegalFormats(selectedCard.legalities);

  return (
    <div className="cardModalOverlay" onClick={onClose}>
      <section
        className="cardModal"
        aria-modal="true"
        role="dialog"
        aria-labelledby="cardModalTitle"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="cardModalClose"
          onClick={onClose}
          aria-label="Close card details"
        >
          x
        </button>

        <div className="cardModalImagePanel">
          {image ? (
            <img src={image} alt={selectedCard.name} />
          ) : (
            <div className="cardModalMissingImage">No image</div>
          )}
        </div>

        <div className="cardModalDetails">
          <div className="cardModalHeader">
            <h2 id="cardModalTitle">{selectedCard.name}</h2>
            <p>{selectedCard.type_line || "Unknown type"}</p>
          </div>

          <label className="cardVersionPicker">
            <span>Version</span>
            <select
              value={selectedCardId}
              onChange={(event) => setSelectedCardId(event.target.value)}
              disabled={isLoadingVersions}
            >
              {versions.map((version) => (
                <option key={version.id} value={String(version.id)}>
                  {getVersionLabel(version)}
                </option>
              ))}
            </select>
          </label>

          {versionsError && <p className="cardModalError">{versionsError}</p>}

          <dl className="cardDataGrid">
            <div>
              <dt>Mana Value</dt>
              <dd>{selectedCard.mana_value ?? "N/A"}</dd>
            </div>
            <div>
              <dt>Colors</dt>
              <dd>{formatArray(selectedCard.colors)}</dd>
            </div>
            <div>
              <dt>Color Identity</dt>
              <dd>{formatArray(selectedCard.color_identity, "Colorless")}</dd>
            </div>
            <div>
              <dt>Rarity</dt>
              <dd>{selectedCard.rarity || "N/A"}</dd>
            </div>
            <div>
              <dt>Set</dt>
              <dd>{selectedCard.set_name || selectedCard.set_code || "N/A"}</dd>
            </div>
            <div>
              <dt>Collector</dt>
              <dd>{selectedCard.collector_number || "N/A"}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>{formatMoney(selectedCard.price_usd)}</dd>
            </div>
            <div>
              <dt>Foil</dt>
              <dd>{formatMoney(selectedCard.price_usd_foil)}</dd>
            </div>
            <div>
              <dt>Games</dt>
              <dd>{formatArray(selectedCard.games)}</dd>
            </div>
            <div>
              <dt>Printing</dt>
              <dd>
                {selectedCard.is_default_printing ? "Default" : "Alternate"}
              </dd>
            </div>
          </dl>

          {selectedCard.oracle_text && (
            <div className="cardOracleText">
              {selectedCard.oracle_text.split("\n").map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}

          <div className="cardLegalities">
            <h3>Legal Formats</h3>
            <p>{formatArray(legalFormats, "None listed")}</p>
          </div>

          <div className="cardModalActions">
            <button
              type="button"
              onClick={() => onAddToPack(selectedCard)}
              disabled={isPackFull}
            >
              Add to Pack
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
