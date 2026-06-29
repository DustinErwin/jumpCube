import { useEffect, useMemo, useRef, useState } from "react";
import { searchScryfallCards } from "../../services/scryfallApi";
import { normalizeScryfallCards } from "../../services/scryfallCardModel";
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
 * - canAddCard(card): optional per-card rule check
 */

const SCRYFALL_FORMATS = [
  { key: "alchemy", label: "Alchemy" },
  { key: "brawl", label: "Brawl" },
  { key: "commander", label: "Commander" },
  { key: "competitivebrawl", label: "Competitive Brawl" },
  { key: "duel", label: "Duel" },
  { key: "gladiator", label: "Gladiator" },
  { key: "historic", label: "Historic" },
  { key: "legacy", label: "Legacy" },
  { key: "modern", label: "Modern" },
  { key: "oathbreaker", label: "Oathbreaker" },
  { key: "oldschool", label: "Old School" },
  { key: "pauper", label: "Pauper" },
  { key: "paupercommander", label: "Pauper EDH" },
  { key: "penny", label: "Penny" },
  { key: "pioneer", label: "Pioneer" },
  { key: "predh", label: "PreEDH" },
  { key: "premodern", label: "Premodern" },
  { key: "standard", label: "Standard" },
  { key: "standardbrawl", label: "Standard Brawl" },
  { key: "timeless", label: "Timeless" },
  { key: "tlr", label: "TLR" },
  { key: "vintage", label: "Vintage" },
];

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

function formatMoney(value) {
  const number = Number(value);

  return Number.isFinite(number) ? `$${number.toFixed(2)}` : "N/A";
}

function getCardPrice(card, priceKey) {
  return card?.[priceKey] ?? card?.prices?.[priceKey.replace("price_", "")] ?? null;
}

function hasDisplayPrice(card) {
  return Boolean(
    getCardPrice(card, "price_usd") ||
      getCardPrice(card, "price_usd_foil") ||
      getCardPrice(card, "price_usd_etched"),
  );
}

function normalizeLegalities(legalities) {
  if (!legalities) return {};

  if (typeof legalities === "string") {
    try {
      return normalizeLegalities(JSON.parse(legalities));
    } catch {
      return {};
    }
  }

  return typeof legalities === "object" && !Array.isArray(legalities)
    ? legalities
    : {};
}

function hasLegalityData(legalities) {
  return Object.keys(normalizeLegalities(legalities)).length > 0;
}

function formatFormatName(format) {
  return String(format)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getFormatLegalities(legalities) {
  const normalizedLegalities = normalizeLegalities(legalities);

  return SCRYFALL_FORMATS.map(({ key, label }) => ({
    format: key,
    label,
    status: normalizedLegalities[key]
      ? String(normalizedLegalities[key]).toLowerCase()
      : "unknown",
  }));
}

function getOracleText(card, showBack = false) {
  const activeFace = card?.card_faces?.[showBack ? 1 : 0];

  if (activeFace?.oracle_text) return activeFace.oracle_text;
  if (card?.oracle_text) return card.oracle_text;

  return (card?.card_faces || [])
    .map((face) => face.oracle_text)
    .filter(Boolean)
    .join("\n\n");
}

function getVersionLabel(card) {
  // Text shown in the version picker.
  const setName = card.set_name || card.set_code?.toUpperCase() || "Set";
  const collectorNumber = card.collector_number || "?";
  const rarity = card.rarity ? `, ${card.rarity}` : "";

  return `${setName} #${collectorNumber}${rarity}`;
}

function normalizeCardVersions(versions, sourceCard) {
  return normalizeScryfallCards(versions || []).map((version) => ({
    ...version,
    legalities: hasLegalityData(version.legalities)
      ? version.legalities
      : sourceCard.legalities,
    card_search_id: version.scryfall_id,
    variant_id: version.scryfall_id,
    variation_id: version.scryfall_id,
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
  canAddCard,
  readOnly = false,
}) {
  const versionPickerRef = useRef(null);
  const touchPreviewVersionIdRef = useRef("");
  const versionRequestIdRef = useRef(0);
  const nextVersionsPageRef = useRef("");
  const [versions, setVersions] = useState(() => (card ? [card] : []));
  const [manualSelectedCard, setManualSelectedCard] = useState({
    sourceCardId: "",
    selectedCardId: "",
  });
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [hasLoadedVersions, setHasLoadedVersions] = useState(false);
  const [hasMoreVersions, setHasMoreVersions] = useState(false);
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

  useEffect(
    () => () => {
      versionRequestIdRef.current += 1;
    },
    [],
  );

  async function loadVersions({ append = false } = {}) {
    if (!card || readOnly || isLoadingVersions) return;

    const requestId = versionRequestIdRef.current + 1;
    versionRequestIdRef.current = requestId;
    setIsLoadingVersions(true);
    setVersionsError("");

    try {
      const query = card.oracle_id
        ? `oracleid:${card.oracle_id} game:paper -is:extra`
        : `!"${card.name}" game:paper -is:extra`;
      const payload = await searchScryfallCards(query, {
        pageUrl: append ? nextVersionsPageRef.current : "",
        unique: "prints",
        order: "released",
      });

      if (requestId !== versionRequestIdRef.current) return;

      const hydratedVersions = normalizeCardVersions(payload.data || [], card);

      setVersions((currentVersions) => {
        const nextVersions = append
          ? [...currentVersions, ...hydratedVersions]
          : hydratedVersions;
        const versionsById = new Map(
          nextVersions.map((version) => [String(version.id), version]),
        );

        if (!versionsById.has(sourceCardId)) {
          versionsById.set(sourceCardId, card);
        }

        return [...versionsById.values()];
      });
      setHasLoadedVersions(true);
      setHasMoreVersions(Boolean(payload.has_more && payload.next_page));
      nextVersionsPageRef.current = payload.next_page || "";
    } catch (error) {
      if (requestId !== versionRequestIdRef.current) return;

      console.error("Error loading card versions:", error);
      setVersionsError("Could not load versions.");
    } finally {
      if (requestId === versionRequestIdRef.current) {
        setIsLoadingVersions(false);
      }
    }
  }

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
  const formatLegalities = getFormatLegalities(displayedCard.legalities);
  const oracleText = getOracleText(displayedCard, isFlipped);
  const selectedQuantity =
    selectedCards.find(
      (selectedPackCard) => selectedPackCard.id === displayedCard.id,
    )?.quantity || 0;
  const isAddDisabled =
    isPackFull || (canAddCard && !canAddCard(displayedCard));
  function renderQuantityControls() {
    return (
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
          disabled={isAddDisabled}
          aria-label={`Add one ${displayedCard.name} to pack`}
        >
          +
        </button>
      </div>
    );
  }

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
            <div
              className={`cardModalFlipFrame${isFlipped ? " flipped" : ""}`}
            >
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
                  onClick={(event) => {
                    event.stopPropagation();
                    setFlippedCardId((currentFlippedCardId) =>
                      currentFlippedCardId === selectedCardId
                        ? null
                        : selectedCardId,
                    );
                  }}
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

          {!readOnly && (
            <div className="cardModalActions">
              {renderQuantityControls()}
            </div>
          )}

          <p className="cardModalPrices" aria-label="Card prices">
            <span>{formatMoney(getCardPrice(displayedCard, "price_usd"))}</span>
            <span aria-hidden="true">/</span>
            <span className="cardModalFoilPrice">
              {formatMoney(getCardPrice(displayedCard, "price_usd_foil"))}
            </span>
          </p>
        </div>

        <div className="cardModalDetails">
          <div className="cardModalHeader">
            <h2 id="cardModalTitle">{displayedCard.name}</h2>
            <p>{displayedCard.type_line || "Unknown type"}</p>
          </div>

          {!readOnly && (
            <div className="cardVersionPicker" ref={versionPickerRef}>
              <span>Version</span>
              <button
                type="button"
                className="cardVersionPickerButton"
                onClick={() => {
                  touchPreviewVersionIdRef.current = "";
                  setHoveredVersionId("");
                  setIsVersionPickerOpen((currentIsOpen) => !currentIsOpen);
                  if (!hasLoadedVersions) {
                    loadVersions();
                  }
                }}
                aria-expanded={isVersionPickerOpen}
                aria-haspopup="listbox"
              >
                {getVersionLabel(displayedCard)}
              </button>

              {isVersionPickerOpen && (
                <div className="cardVersionMenu">
                  <div className="cardVersionList" role="listbox">
                    {isLoadingVersions && !hasLoadedVersions && (
                      <p className="cardVersionStatus">Loading versions...</p>
                    )}
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
                    {hasMoreVersions && (
                      <button
                        type="button"
                        className="cardVersionLoadMore"
                        onClick={() => loadVersions({ append: true })}
                        disabled={isLoadingVersions}
                      >
                        {isLoadingVersions ? "Loading..." : "Load more"}
                      </button>
                    )}
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
          )}

          {versionsError && <p className="cardModalError">{versionsError}</p>}

          {oracleText && (
            <div className="cardOracleText">
              {oracleText.split("\n").map((line, index) => (
                <p key={`${line}:${index}`}>{line || "\u00a0"}</p>
              ))}
            </div>
          )}

          <div className="cardLegalities">
            <h3>Format Legality</h3>
            <div className="cardLegalityList">
              {formatLegalities.map(({ format, label, status }) => (
                <span
                  key={format}
                  className={
                    status === "legal"
                      ? "isLegal"
                      : status === "unknown"
                        ? "isUnknown"
                        : "isNotLegal"
                  }
                  title={`${label}: ${formatFormatName(status)}`}
                  aria-label={`${label}: ${formatFormatName(status)}`}
                >
                  <span className="cardLegalityName">{label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
