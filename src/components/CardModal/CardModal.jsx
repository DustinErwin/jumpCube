import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../utils/supabase";
import "./CardModal.css";

/*
 * CardModal shows detailed data for one card and lets the user choose a
 * printing/version before changing pack quantity.
 *
 * Props:
 * - card: card row selected from any part of the app
 * - isOpen: boolean
 * - onClose(): closes modal
 * - onAddToPack(card): add selected version to active pack
 * - onDecreaseFromPack(cardId): remove one selected version copy
 * - selectedCards: active pack cards with quantity
 * - isPackFull: disables plus button at PACK_CARD_LIMIT
 */

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
  prices,
  price_usd,
  price_usd_foil,
  price_usd_etched,
  price_eur,
  price_eur_foil,
  price_tix,
  games,
  nonfoil,
  is_token,
  is_funny,
  is_variant_printing,
  is_planechase,
  set_name,
  set_code,
  set_type,
  collector_number,
  released_at,
  has_back_face,
  mana_cost,
  image_uris,
  card_faces
`;

function getImage(card) {
  return (
    card?.image_url ||
    card?.image_uris?.normal ||
    card?.image_uris?.small ||
    card?.card_faces?.[0]?.image_uris?.normal ||
    card?.card_faces?.[0]?.image_uris?.small ||
    card?.card_faces?.[0]?.small?.normal ||
    card?.card_faces?.[0]?.small?.small ||
    null
  );
}

function getBackImage(card) {
  // Match CardBox behavior: require a true second face before showing flip.
  const secondFaceImage =
    card?.card_faces?.[1]?.image_uris?.normal ||
    card?.card_faces?.[1]?.image_uris?.small ||
    card?.card_faces?.[1]?.small?.normal ||
    card?.card_faces?.[1]?.small?.small ||
    null;

  if (secondFaceImage) {
    return secondFaceImage;
  }

  if (card?.card_faces?.length > 1) {
    return card.back_image_url || null;
  }

  return null;
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

function getCardPrice(card, priceKey) {
  return card?.[priceKey] ?? card?.prices?.[priceKey.replace("price_", "")] ?? null;
}

function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function hasDisplayPrice(card) {
  return Boolean(
    getCardPrice(card, "price_usd") ||
      getCardPrice(card, "price_usd_foil") ||
      getCardPrice(card, "price_usd_etched"),
  );
}

function getLegalFormats(legalities) {
  if (!legalities || typeof legalities !== "object") return [];

  return Object.entries(legalities)
    .filter(([, status]) => status === "legal")
    .map(([format]) => format);
}

function getVersionLabel(card) {
  // Text shown in the version picker.
  const setName = card.set_name || card.set_code?.toUpperCase() || "Set";
  const collectorNumber = card.collector_number || "?";
  const rarity = card.rarity ? `, ${card.rarity}` : "";

  return `${setName} #${collectorNumber}${rarity}`;
}

function normalizeCardVersions(versions, sourceCard) {
  return (versions || []).map((version) => ({
    ...version,
    card_search_id: sourceCard.card_search_id || null,
    variant_id: version.id,
  }));
}

export default function CardModal({
  card,
  isOpen,
  onClose,
  onAddToPack,
  onDecreaseFromPack,
  selectedCards = [],
  isPackFull,
}) {
  const versionPickerRef = useRef(null);
  const touchPreviewVersionIdRef = useRef("");
  const [versions, setVersions] = useState([]);
  const [manualSelectedCard, setManualSelectedCard] = useState({
    sourceCardId: "",
    selectedCardId: "",
  });
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [versionsError, setVersionsError] = useState("");
  const [flippedCardId, setFlippedCardId] = useState(null);
  const [livePricesByScryfallId, setLivePricesByScryfallId] = useState({});
  const [isVersionPickerOpen, setIsVersionPickerOpen] = useState(false);
  const [hoveredVersionId, setHoveredVersionId] = useState("");
  const sourceCardId = String(card?.variant_id || card?.id || "");
  const selectedCardId =
    manualSelectedCard.sourceCardId === sourceCardId
      ? manualSelectedCard.selectedCardId
      : sourceCardId;

  useEffect(() => {
    // Escape closes the modal while it is open.
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
    // Load all local printings for the same oracle card so the user can pick a
    // specific version before adding it to the pack.
    if (!isOpen || !card) return undefined;

    let isCurrent = true;

    async function loadVersions() {
      setIsLoadingVersions(true);
      setVersionsError("");

      let query = supabase
        .from("card_variants")
        .select(CARD_VERSION_COLUMNS)
        .contains("games", ["paper"])
        .eq("lang", "en")
        .lte("released_at", getTodayDateString())
        .eq("is_token", false)
        .eq("is_funny", false)
        .eq("is_planechase", false)
        .neq("set_type", "funny")
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

      const hydratedVersions = normalizeCardVersions(data || [], card);

      if (!isCurrent) return;

      setVersions(hydratedVersions.length ? hydratedVersions : [card]);
      setIsLoadingVersions(false);
    }

    loadVersions();

    return () => {
      isCurrent = false;
    };
  }, [card, isOpen]);

  const selectedCard = useMemo(
    // selectedCardId comes from a select value, so compare ids as strings.
    () =>
      versions.find((version) => String(version.id) === selectedCardId) || card,
    [card, selectedCardId, versions],
  );
  const displayedCard = useMemo(() => {
    const livePrices = livePricesByScryfallId[selectedCard?.scryfall_id];

    if (!livePrices) return selectedCard;

    return {
      ...selectedCard,
      prices: livePrices,
      price_usd: Number(livePrices.usd) || selectedCard.price_usd || null,
      price_usd_foil:
        Number(livePrices.usd_foil) || selectedCard.price_usd_foil || null,
      price_usd_etched:
        Number(livePrices.usd_etched) || selectedCard.price_usd_etched || null,
      price_eur: Number(livePrices.eur) || selectedCard.price_eur || null,
      price_eur_foil:
        Number(livePrices.eur_foil) || selectedCard.price_eur_foil || null,
      price_tix: Number(livePrices.tix) || selectedCard.price_tix || null,
    };
  }, [livePricesByScryfallId, selectedCard]);
  const hoveredVersion = useMemo(
    () =>
      versions.find((version) => String(version.id) === hoveredVersionId) ||
      null,
    [hoveredVersionId, versions],
  );
  const versionPreview = hoveredVersion || selectedCard;
  const versionPreviewImage = getImage(versionPreview);

  useEffect(() => {
    if (!isVersionPickerOpen) return undefined;

    function closeVersionPicker(event) {
      if (versionPickerRef.current?.contains(event.target)) return;

      setIsVersionPickerOpen(false);
      setHoveredVersionId("");
      touchPreviewVersionIdRef.current = "";
    }

    window.addEventListener("click", closeVersionPicker);

    return () => {
      window.removeEventListener("click", closeVersionPicker);
    };
  }, [isVersionPickerOpen]);

  useEffect(() => {
    if (!isOpen || !selectedCard?.scryfall_id || hasDisplayPrice(selectedCard)) {
      return undefined;
    }

    if (livePricesByScryfallId[selectedCard.scryfall_id]) {
      return undefined;
    }

    let isCurrent = true;

    async function loadLivePrices() {
      try {
        const response = await fetch(
          `https://api.scryfall.com/cards/${selectedCard.scryfall_id}`,
        );
        const payload = await response.json();

        if (!isCurrent || !response.ok || !payload.prices) return;

        setLivePricesByScryfallId((currentPrices) => ({
          ...currentPrices,
          [selectedCard.scryfall_id]: payload.prices,
        }));
      } catch {
        // The modal can still render database data if the live price lookup fails.
      }
    }

    loadLivePrices();

    return () => {
      isCurrent = false;
    };
  }, [isOpen, livePricesByScryfallId, selectedCard]);

  if (!isOpen || !card || !displayedCard) return null;

  const image = getImage(displayedCard);
  const backImage = getBackImage(displayedCard);
  const canFlip = Boolean(backImage);
  const isFlipped = flippedCardId === selectedCardId;
  const legalFormats = getLegalFormats(displayedCard.legalities);
  const selectedQuantity =
    selectedCards.find((selectedPackCard) => selectedPackCard.id === displayedCard.id)
      ?.quantity || 0;

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
            <div className={`cardModalFlipFrame${isFlipped ? " flipped" : ""}`}>
              <div className="cardModalFlipInner">
                <img
                  className="cardModalFace cardModalFaceFront"
                  src={image}
                  alt={displayedCard.name}
                />
                {canFlip && (
                  <img
                    className="cardModalFace cardModalFaceBack"
                    src={backImage}
                    alt={`${displayedCard.name} back face`}
                  />
                )}
              </div>

              {canFlip && (
                <button
                  // Flip state is keyed by selectedCardId, so changing versions
                  // naturally returns the newly selected version to front face.
                  type="button"
                  className="cardModalFlipButton"
                  onClick={() =>
                    setFlippedCardId((currentFlippedCardId) =>
                      currentFlippedCardId === selectedCardId
                        ? null
                        : selectedCardId,
                    )
                  }
                  aria-label={`Flip ${displayedCard.name}`}
                  aria-pressed={isFlipped}
                  title="Flip card"
                >
                  ↻
                </button>
              )}
            </div>
          ) : (
            <div className="cardModalMissingImage">No image</div>
          )}
        </div>

        <div className="cardModalDetails">
          <div className="cardModalHeader">
            <h2 id="cardModalTitle">{displayedCard.name}</h2>
            <p>{displayedCard.type_line || "Unknown type"}</p>
          </div>

          <div className="cardVersionPicker" ref={versionPickerRef}>
            <span>Version</span>
            <button
              type="button"
              className="cardVersionPickerButton"
              onClick={() => {
                touchPreviewVersionIdRef.current = "";
                setHoveredVersionId("");
                setIsVersionPickerOpen((currentIsOpen) => !currentIsOpen);
              }}
              disabled={isLoadingVersions}
              aria-expanded={isVersionPickerOpen}
              aria-haspopup="listbox"
            >
              {getVersionLabel(displayedCard)}
            </button>

            {isVersionPickerOpen && (
              <div className="cardVersionMenu">
                <div className="cardVersionList" role="listbox">
                  {versions.map((version) => {
                    const versionId = String(version.id);
                    const isSelected = versionId === selectedCardId;
                    const isPreviewed =
                      !isSelected && versionId === hoveredVersionId;

                    return (
                      <button
                        type="button"
                        key={version.id}
                        className={`cardVersionOption${
                          isSelected ? " selected" : ""
                        }${isPreviewed ? " previewed" : ""}`}
                        role="option"
                        aria-selected={isSelected}
                        onMouseEnter={() => setHoveredVersionId(versionId)}
                        onFocus={() => setHoveredVersionId(versionId)}
                        onClick={() => {
                          const isTouchVersionPicker =
                            window.matchMedia?.(
                              "(hover: none), (pointer: coarse)",
                            )?.matches || false;

                          if (
                            isTouchVersionPicker &&
                            touchPreviewVersionIdRef.current !== versionId
                          ) {
                            touchPreviewVersionIdRef.current = versionId;
                            setHoveredVersionId(versionId);
                            return;
                          }

                          touchPreviewVersionIdRef.current = "";
                          setManualSelectedCard({
                            sourceCardId,
                            selectedCardId: versionId,
                          });
                          setIsVersionPickerOpen(false);
                          setHoveredVersionId("");
                        }}
                      >
                        <span>{getVersionLabel(version)}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="cardVersionPreview" aria-hidden="true">
                  {versionPreviewImage ? (
                    <img
                      src={versionPreviewImage}
                      alt=""
                    />
                  ) : (
                    <span>No image</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {versionsError && <p className="cardModalError">{versionsError}</p>}

          <dl className="cardDataGrid">
            <div>
              <dt>Mana Value</dt>
              <dd>{displayedCard.mana_value ?? "N/A"}</dd>
            </div>
            <div>
              <dt>Color Identity</dt>
              <dd>{formatArray(displayedCard.color_identity, "Colorless")}</dd>
            </div>
            <div>
              <dt>Rarity</dt>
              <dd>{displayedCard.rarity || "N/A"}</dd>
            </div>
            <div>
              <dt>Set</dt>
              <dd>{displayedCard.set_name || displayedCard.set_code || "N/A"}</dd>
            </div>
            <div>
              <dt>Collector</dt>
              <dd>{displayedCard.collector_number || "N/A"}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>{formatMoney(getCardPrice(displayedCard, "price_usd"))}</dd>
            </div>
            <div>
              <dt>Foil</dt>
              <dd>{formatMoney(getCardPrice(displayedCard, "price_usd_foil"))}</dd>
            </div>
            <div>
              <dt>Games</dt>
              <dd>{formatArray(displayedCard.games)}</dd>
            </div>
            <div>
              <dt>Printing</dt>
              <dd>
                {displayedCard.is_default_printing ? "Default" : "Alternate"}
              </dd>
            </div>
          </dl>

          {displayedCard.oracle_text && (
            <div className="cardOracleText">
              {displayedCard.oracle_text.split("\n").map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}

          <div className="cardLegalities">
            <h3>Legal Formats</h3>
            <p>{formatArray(legalFormats, "None listed")}</p>
          </div>

          <div className="cardModalActions">
            <div
              className="cardModalQuantityControls"
              aria-label={`${displayedCard.name} pack quantity controls`}
            >
              <button
                type="button"
                onClick={() => onDecreaseFromPack?.(displayedCard.id)}
                disabled={selectedQuantity === 0}
                aria-label={`Remove one ${displayedCard.name} from pack`}
              >
                -
              </button>

              <span aria-label={`${selectedQuantity} in pack`}>
                {selectedQuantity}
              </span>

              <button
                type="button"
                onClick={() => onAddToPack?.(displayedCard)}
                disabled={isPackFull}
                aria-label={`Add one ${displayedCard.name} to pack`}
              >
                +
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
