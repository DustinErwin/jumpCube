import { useEffect, useRef, useState } from "react";
import {
  DRAFT_PACK_NAME,
  PACK_CARD_LIMIT,
} from "../../hooks/usePackBuilder";
import {
  getPrimaryCardMechanicBucket,
  PACK_MECHANIC_BUCKETS,
} from "../../utils/cardMechanics";
import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  sanitizeDescriptionInput,
  sanitizeTitleInput,
} from "../../utils/userText";
import {
  formatPackTagName,
  getPackTagStyle,
  normalizePackTagName,
  PACK_TAG_COLORS,
  PACK_TAG_LIMIT,
  validatePackTagName,
} from "../../utils/packTags";
import { getContentModerationMessage } from "../../utils/contentModeration";
import DeckConverterModal from "../DeckConverterModal/DeckConverterModal";
import "./PackBox.css";

/*
 * PackBox is the active pack editor panel.
 *
 * Props are controlled by usePackBuilder/App:
 * - packName/description/archetypeTags/visibility plus their setters
 * - selectedCards: Array<card row & { quantity, manualMechanicBucket? }>
 * - addCard(card), decreaseCardQuantity(cardId)
 * - addCurrentPackToCube(): saves current pack and inserts/updates cube item
 * - deletePack(savedPackId), newPack()
 * - moveCard(draggedCardId, targetCardId)
 * - moveCardToMechanicBucket(cardId, bucketId)
 * - isOpen/setIsOpen: side-panel collapsed state
 * - isAuthenticated/onAuthRequired: gate save/library/profile workflows
 */

// Update CARD_TYPE_COLORS/LABELS together when changing the type pie chart.
const CARD_TYPE_COLORS = {
  Artifact: "#9aa3ad",
  Creature: "#65a765",
  Enchantment: "#b084d6",
  Instant: "#5d95d6",
  Land: "#b68a58",
  Planeswalker: "#d16b6b",
  Sorcery: "#d6b85d",
};
const CARD_TYPES = Object.keys(CARD_TYPE_COLORS);
const CARD_TYPE_LABELS = {
  Artifact: "Artifacts",
  Creature: "Creatures",
  Enchantment: "Enchantments",
  Instant: "Instants",
  Land: "Lands",
  Planeswalker: "Planeswalkers",
  Sorcery: "Sorceries",
};
const PACK_STATS_TYPE_ORDER = [
  "Creature",
  "Land",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Planeswalker",
  "Battle",
];
const PACK_STATS_TYPE_LABELS = {
  ...CARD_TYPE_LABELS,
  Battle: "Battles",
  Other: "Other",
};
const PACK_STATS_TABLE_MODES = [
  { id: "function", label: "Function" },
  { id: "type", label: "Card Type" },
  { id: "mana", label: "Mana Value" },
];
const IDEAL_MANA_CURVE = [1, 4, 3, 2, 1, 1];
const SWIPE_REMOVE_THRESHOLD = 88;
const SWIPE_REMOVE_CANCEL_THRESHOLD = 56;
const SWIPE_REMOVE_MAX_DISTANCE = 124;
const SWIPE_REMOVE_HOLD_MS = 450;
const MOBILE_REORDER_HOLD_MS = 400;
const MOBILE_GESTURE_MOVE_TOLERANCE = 8;
const DEFAULT_PACK_ACTION_HINT = "";

function parsePrice(price) {
  if (price === null || price === undefined || price === "") return null;

  const normalizedPrice =
    typeof price === "string"
      ? Number(price.replace(/[$,]/g, ""))
      : Number(price);

  return Number.isFinite(normalizedPrice) ? normalizedPrice : null;
}

function getCardScryfallId(card) {
  return (
    card.scryfall_id ||
    card.variation_id ||
    card.default_variant_scryfall_id ||
    null
  );
}

function getCardPrice(card, livePrices = null) {
  // Prefer the normal nonfoil USD price, with legacy/raw JSON fallbacks.
  // Some imported rows represent missing prices as 0, so keep looking for a
  // positive fallback before settling on zero.
  const priceCandidates = [
    livePrices?.usd,
    card.price_usd,
    card.prices?.usd,
    card.prices?.price_usd,
    card.prices?.nonfoil,
    card.price,
    livePrices?.usd_foil,
    card.price_usd_foil,
    card.prices?.usd_foil,
    card.prices?.price_usd_foil,
    livePrices?.usd_etched,
    card.price_usd_etched,
    card.prices?.usd_etched,
    card.prices?.price_usd_etched,
  ];
  const numericPrices = priceCandidates
    .map(parsePrice)
    .filter((price) => price !== null);
  const positivePrice = numericPrices.find((price) => price > 0);

  return positivePrice ?? numericPrices[0] ?? 0;
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function getCardTypes(card) {
  // Type matching avoids accidental substring hits inside longer words.
  const typeLine = card.type_line || "";

  return CARD_TYPES.filter((type) =>
    new RegExp(`(^|[^A-Za-z])${type}([^A-Za-z]|$)`, "i").test(typeLine),
  );
}

function getPrimaryPackStatsType(card) {
  const typeLine = card.type_line || "";
  const matchedType = PACK_STATS_TYPE_ORDER.find((type) =>
    new RegExp(`(^|[^A-Za-z])${type}([^A-Za-z]|$)`, "i").test(typeLine),
  );

  return matchedType || "Other";
}

function isCommanderEligible(card) {
  const typeLine = card?.type_line || "";
  const isLegendary = /\blegendary\b/i.test(typeLine);
  const isCreatureOrPlaneswalker =
    /\bcreature\b/i.test(typeLine) || /\bplaneswalker\b/i.test(typeLine);

  return isLegendary && isCreatureOrPlaneswalker;
}

export default function PackBox({
  packName,
  setPackName,
  selectedCards,
  addCard,
  decreaseCardQuantity,
  onCardOpen,
  addCurrentPackToCube,
  isCubeActive = false,
  onOpenPacks,
  deletePack,
  savedPackId,
  onSharePack,
  packDescription,
  setPackDescription,
  packArchetypeTags = [],
  setPackArchetypeTags,
  availablePackTags = [],
  createPackTag,
  packTagLimit = PACK_TAG_LIMIT,
  packVisibility = "private",
  setPackVisibility,
  packFormatId = "jumpstart",
  setPackFormat,
  packFormats = {},
  packCardLimit = PACK_CARD_LIMIT,
  commanderCard,
  commanderCardId,
  setCommanderCard,
  hasValidCommander = true,
  isPackActive = false,
  newPack,
  onConvertDeck,
  onFinalizeConvertedDeck,
  saveStatus,
  saveErrorMessage = "",
  showRenameChoice,
  pendingSaveAction,
  setIsEditingText,
  moveCard,
  moveCardToMechanicBucket,
  initialShowStats = false,
  onStatsClose,
  onStatsOpenChange,
  isDraggingCard,
  isOpen,
  setIsOpen,
  isAuthenticated = false,
  onAuthRequired,
}) {
  const [livePricesByScryfallId, setLivePricesByScryfallId] = useState({});
  // Drag state controls normal pack-stack reordering and stats-column moves.
  const [draggedCardId, setDraggedCardId] = useState(null);
  const [dragOverCardId, setDragOverCardId] = useState(null);
  const [draggedStatsCardId, setDraggedStatsCardId] = useState(null);
  const [suppressStackHover, setSuppressStackHover] = useState(false);
  const droppedInsidePackRef = useRef(false);
  const [isDragOverPack, setIsDragOverPack] = useState(false);
  const cardDragStartedRef = useRef(false);
  const swipeRemoveGestureRef = useRef({
    stackId: null,
    cardId: null,
    pointerId: null,
    startX: 0,
    offset: 0,
    holding: false,
    armed: false,
  });
  const swipeRemoveTimeoutRef = useRef(null);
  const mobileReorderTimeoutRef = useRef(null);
  const suppressCardClickRef = useRef(false);
  const mobileReorderRef = useRef({
    stackId: null,
    cardId: null,
    pointerId: null,
    targetCardId: null,
    startX: 0,
    startY: 0,
    lastY: 0,
    armed: false,
    cardElement: null,
  });
  const [swipeRemoveState, setSwipeRemoveState] = useState({
    stackId: null,
    offset: 0,
    holding: false,
    armed: false,
  });

  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [confirmingDeletePack, setConfirmingDeletePack] = useState(false);
  const [isArchetypeMenuOpen, setIsArchetypeMenuOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [newTagColor, setNewTagColor] = useState("gray");
  const [tagMessage, setTagMessage] = useState("");
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [showPackStats, setShowPackStats] = useState(initialShowStats);
  const [isDeckConverterOpen, setIsDeckConverterOpen] = useState(false);
  const [packStatsTableMode, setPackStatsTableMode] = useState("function");
  const [visibilityMessage, setVisibilityMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [packActionHint, setPackActionHint] = useState(
    DEFAULT_PACK_ACTION_HINT,
  );
  const visibilityMessageTimeoutRef = useRef(null);
  const shareMessageTimeoutRef = useRef(null);
  const pendingTouchActionRef = useRef(null);
  const blockedTouchClickRef = useRef(null);
  // const [showManaCurve, setShowManaCurve] = useState(false);

  function getPackActionHintProps(hint, actionId = hint) {
    return {
      onMouseEnter: () => setPackActionHint(hint),
      onFocus: () => setPackActionHint(hint),
      onTouchStart: (event) => {
        setPackActionHint(hint);

        if (pendingTouchActionRef.current !== actionId) {
          pendingTouchActionRef.current = actionId;
          blockedTouchClickRef.current = actionId;
          event.preventDefault();
        }
      },
      onClickCapture: (event) => {
        if (blockedTouchClickRef.current === actionId) {
          blockedTouchClickRef.current = null;
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (pendingTouchActionRef.current === actionId) {
          pendingTouchActionRef.current = null;
        }
      },
      onMouseLeave: () => {
        if (
          pendingTouchActionRef.current === actionId ||
          blockedTouchClickRef.current === actionId
        ) {
          pendingTouchActionRef.current = null;
          blockedTouchClickRef.current = null;
        }

        if (pendingTouchActionRef.current === null) {
          setPackActionHint(DEFAULT_PACK_ACTION_HINT);
        }
      },
      onBlur: () => {
        if (
          pendingTouchActionRef.current !== actionId &&
          blockedTouchClickRef.current !== actionId
        ) {
          return;
        }

        pendingTouchActionRef.current = null;
        blockedTouchClickRef.current = null;
        setPackActionHint(DEFAULT_PACK_ACTION_HINT);
      },
    };
  }

  function clearSwipeRemoveTimer() {
    if (swipeRemoveTimeoutRef.current) {
      window.clearTimeout(swipeRemoveTimeoutRef.current);
      swipeRemoveTimeoutRef.current = null;
    }
  }

  function clearMobileReorderTimer() {
    if (mobileReorderTimeoutRef.current) {
      window.clearTimeout(mobileReorderTimeoutRef.current);
      mobileReorderTimeoutRef.current = null;
    }
  }

  function resetSwipeRemove() {
    clearSwipeRemoveTimer();
    swipeRemoveGestureRef.current = {
      stackId: null,
      cardId: null,
      pointerId: null,
      startX: 0,
      offset: 0,
      holding: false,
      armed: false,
    };
    setSwipeRemoveState({
      stackId: null,
      offset: 0,
      holding: false,
      armed: false,
    });
  }

  function handleSwipeRemoveStart(event, card) {
    const isMobileViewport = window.matchMedia("(max-width: 760px)").matches;
    if (!isMobileViewport || event.pointerType === "mouse") return;

    clearSwipeRemoveTimer();
    event.currentTarget.setPointerCapture(event.pointerId);
    swipeRemoveGestureRef.current = {
      stackId: card.stackId,
      cardId: card.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      offset: 0,
      holding: false,
      armed: false,
    };
    setSwipeRemoveState({
      stackId: card.stackId,
      offset: 0,
      holding: false,
      armed: false,
    });

    clearMobileReorderTimer();
    mobileReorderRef.current = {
      stackId: card.stackId,
      cardId: card.id,
      pointerId: event.pointerId,
      targetCardId: card.id,
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      armed: false,
      cardElement: event.currentTarget.closest(".stackedPackCard"),
    };
    mobileReorderTimeoutRef.current = window.setTimeout(() => {
      const reorder = mobileReorderRef.current;

      if (reorder.pointerId !== event.pointerId) return;

      reorder.armed = true;
      reorder.cardElement?.classList.add("mobileReordering");
      suppressCardClickRef.current = true;
      resetSwipeRemove();
      setDraggedCardId(card.id);
      setDragOverCardId(card.id);
    }, MOBILE_REORDER_HOLD_MS);
  }

  function handleSwipeRemoveMove(event) {
    const reorder = mobileReorderRef.current;

    if (reorder.armed && reorder.pointerId === event.pointerId) {
      event.preventDefault();
      reorder.cardElement?.style.setProperty(
        "--mobile-reorder-offset",
        `${event.clientY - reorder.startY}px`,
      );
      const targetCard = [...document.querySelectorAll(".stackedPackCard")]
        .filter((element) => element !== reorder.cardElement)
        .map((element) => ({
          id: element.dataset.cardId,
          distance: Math.abs(
            event.clientY -
              (element.getBoundingClientRect().top +
                element.getBoundingClientRect().height / 2),
          ),
        }))
        .sort((a, b) => a.distance - b.distance)[0];

      if (targetCard?.id) {
        reorder.targetCardId = targetCard.id;
        setDragOverCardId(targetCard.id);
      }

      return;
    }

    const gesture = swipeRemoveGestureRef.current;
    if (gesture.pointerId !== event.pointerId) return;

    const horizontalDistance = event.clientX - reorder.startX;
    const verticalDistance = event.clientY - reorder.startY;

    if (
      Math.abs(verticalDistance) > MOBILE_GESTURE_MOVE_TOLERANCE &&
      Math.abs(verticalDistance) > Math.abs(horizontalDistance)
    ) {
      clearMobileReorderTimer();
      event.preventDefault();
      const scrollArea = event.currentTarget.closest(".packCardScrollArea");

      if (scrollArea) {
        scrollArea.scrollTop += reorder.lastY - event.clientY;
      }

      reorder.lastY = event.clientY;
      return;
    }

    if (
      Math.abs(horizontalDistance) > MOBILE_GESTURE_MOVE_TOLERANCE ||
      Math.abs(verticalDistance) > MOBILE_GESTURE_MOVE_TOLERANCE
    ) {
      clearMobileReorderTimer();
    }

    const offset = Math.min(
      SWIPE_REMOVE_MAX_DISTANCE,
      Math.max(0, event.clientX - gesture.startX),
    );
    gesture.offset = offset;

    if (offset >= SWIPE_REMOVE_THRESHOLD && !gesture.holding) {
      gesture.holding = true;
      clearSwipeRemoveTimer();
      swipeRemoveTimeoutRef.current = window.setTimeout(() => {
        const activeGesture = swipeRemoveGestureRef.current;

        if (
          activeGesture.stackId === gesture.stackId &&
          activeGesture.offset >= SWIPE_REMOVE_THRESHOLD
        ) {
          activeGesture.armed = true;
          setSwipeRemoveState({
            stackId: activeGesture.stackId,
            offset: activeGesture.offset,
            holding: true,
            armed: true,
          });
        }
      }, SWIPE_REMOVE_HOLD_MS);
    } else if (offset < SWIPE_REMOVE_CANCEL_THRESHOLD && gesture.holding) {
      gesture.holding = false;
      gesture.armed = false;
      clearSwipeRemoveTimer();
    }

    setSwipeRemoveState({
      stackId: gesture.stackId,
      offset,
      holding: gesture.holding,
      armed: gesture.armed,
    });
  }

  function handleSwipeRemoveEnd(event) {
    const reorder = mobileReorderRef.current;

    if (reorder.armed && reorder.pointerId === event.pointerId) {
      if (reorder.targetCardId && reorder.targetCardId !== reorder.cardId) {
        moveCard(reorder.cardId, reorder.targetCardId);
      }

      resetMobileReorder();
      resetSwipeRemove();
      return;
    }

    const gesture = swipeRemoveGestureRef.current;
    if (gesture.pointerId !== event.pointerId) return;

    suppressCardClickRef.current = gesture.offset > 6;

    if (gesture.armed && gesture.offset >= SWIPE_REMOVE_THRESHOLD) {
      decreaseCardQuantity(gesture.cardId);
    }

    resetSwipeRemove();
    resetMobileReorder();
  }

  function handleSwipeRemoveCancel(event) {
    if (
      swipeRemoveGestureRef.current.pointerId !== event.pointerId &&
      mobileReorderRef.current.pointerId !== event.pointerId
    ) {
      return;
    }

    suppressCardClickRef.current = true;
    resetSwipeRemove();
    resetMobileReorder();
  }

  function resetMobileReorder() {
    clearMobileReorderTimer();
    mobileReorderRef.current.cardElement?.classList.remove("mobileReordering");
    mobileReorderRef.current.cardElement?.style.removeProperty(
      "--mobile-reorder-offset",
    );
    mobileReorderRef.current = {
      stackId: null,
      cardId: null,
      pointerId: null,
      targetCardId: null,
      startX: 0,
      startY: 0,
      lastY: 0,
      armed: false,
      cardElement: null,
    };
    setDraggedCardId(null);
    setDragOverCardId(null);
  }

  useEffect(
    () => () => {
      clearSwipeRemoveTimer();
      clearMobileReorderTimer();
    },
    [],
  );

  const selectedScryfallIdKey = [
    ...new Set(selectedCards.map(getCardScryfallId).filter(Boolean)),
  ].join(",");

  useEffect(() => {
    const scryfallIds = selectedScryfallIdKey
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (scryfallIds.length === 0) {
      return undefined;
    }

    let isCurrent = true;

    async function loadLivePrices() {
      try {
        const response = await fetch(
          "https://api.scryfall.com/cards/collection",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              identifiers: scryfallIds.map((id) => ({ id })),
            }),
          },
        );

        if (!response.ok) return;

        const payload = await response.json();
        const nextPricesByScryfallId = {};

        (payload.data || []).forEach((card) => {
          if (card.id && card.prices) {
            nextPricesByScryfallId[card.id] = card.prices;
          }
        });

        if (isCurrent) {
          setLivePricesByScryfallId(nextPricesByScryfallId);
        }
      } catch {
        // Local database prices remain the fallback if the live lookup fails.
      }
    }

    loadLivePrices();

    return () => {
      isCurrent = false;
    };
  }, [selectedScryfallIdKey]);

  const totalCards = selectedCards.reduce(
    (sum, card) => sum + card.quantity,
    0,
  );
  const totalPrice = selectedCards.reduce(
    (sum, card) =>
      sum +
      getCardPrice(card, livePricesByScryfallId[getCardScryfallId(card)]) *
        card.quantity,
    0,
  );
  const packNameModerationMessage = getContentModerationMessage(packName);
  const packDescriptionModerationMessage =
    getContentModerationMessage(packDescription);
  const usesDraftNamePlaceholder =
    !savedPackId && packName === DRAFT_PACK_NAME;

  const packColorIdentity = [
    ...new Set(selectedCards.flatMap((card) => card.color_identity || [])),
  ];

  const colorOrder = ["W", "U", "B", "R", "G"];

  const sortedPackColors = colorOrder.filter((color) =>
    packColorIdentity.includes(color),
  );

  // Expand quantities into visual copies so stats/stack views reflect the
  // actual pack count while still saving one row per card id.
  const displayedCards = selectedCards.flatMap((card) =>
    Array.from({ length: card.quantity }, (_, index) => ({
      ...card,
      stackId: `${card.id}-${index}`,
      copyNumber: index + 1,
    })),
  );
  const packFormat = packFormats[packFormatId] || packFormats.jumpstart || {};
  const isCommanderPack = Boolean(packFormat.commanderSlot);
  const commanderOptions = selectedCards.filter(isCommanderEligible);
  // Stats-view columns are mechanic buckets. Manual user placement is handled
  // by getPrimaryCardMechanicBucket().
  const mechanicColumns = PACK_MECHANIC_BUCKETS.map((bucket) => ({
    ...bucket,
    cards: displayedCards.filter((card) => {
      return getPrimaryCardMechanicBucket(card)?.id === bucket.id;
    }),
  }));
  const typeColumns = [...PACK_STATS_TYPE_ORDER, "Other"].map((type) => ({
    id: type.toLowerCase(),
    label: PACK_STATS_TYPE_LABELS[type],
    cards: displayedCards.filter(
      (card) => getPrimaryPackStatsType(card) === type,
    ),
  }));
  const manaValueColumns = [0, 1, 2, 3, 4, 5, 6].map((manaValue) => ({
    id: `mana-${manaValue}`,
    label: manaValue === 6 ? "6+" : String(manaValue),
    cards: displayedCards.filter((card) => {
      if (/\bland\b/i.test(card.type_line || "")) return false;

      const cardManaValue = Number(card.mana_value || 0);
      const bucket = cardManaValue >= 6 ? 6 : Math.max(0, cardManaValue);

      return bucket === manaValue;
    }),
  }));
  const activeStatsColumns =
    packStatsTableMode === "type"
      ? typeColumns
      : packStatsTableMode === "mana"
        ? manaValueColumns
        : mechanicColumns;
  const activeStatsTableLabel =
    PACK_STATS_TABLE_MODES.find((mode) => mode.id === packStatsTableMode)
      ?.label || "Function";
  const canMoveStatsCards = packStatsTableMode === "function";
  const mechanicBucketCounts = mechanicColumns.map((column) => ({
    id: column.id,
    label: column.label,
    shortLabel: column.shortLabel,
    color: column.color,
    count: column.cards.length,
  }));
  // Bar chart buckets use 6+ as the final bucket.
  const manaCurveChartColumns = [1, 2, 3, 4, 5, 6].map((manaValue, index) => ({
    manaValue,
    idealCount: IDEAL_MANA_CURVE[index],
    label: manaValue === 6 ? "6+" : String(manaValue),
    cards: displayedCards.filter((card) => {
      const cardManaValue = Number(card.mana_value || 0);
      const bucket = cardManaValue >= 6 ? 6 : Math.max(0, cardManaValue);

      return bucket === manaValue;
    }),
  }));
  const largestManaCurveChartCount = Math.max(
    1,
    ...manaCurveChartColumns.map((column) =>
      Math.max(column.cards.length, column.idealCount),
    ),
  );
  const manaCurveLevelLines = Array.from(
    { length: largestManaCurveChartCount },
    (_, index) => largestManaCurveChartCount - index,
  );
  const cardTypeCounts = CARD_TYPES.map((type) => ({
    type,
    count: displayedCards.filter((card) => getCardTypes(card).includes(type))
      .length,
  }));
  const totalTypeCount = cardTypeCounts.reduce(
    (sum, typeCount) => sum + typeCount.count,
    0,
  );
  // Conic-gradient segments for the type pie chart.
  const typeChartSegments = cardTypeCounts.reduce((segments, typeCount) => {
    const percentage =
      totalTypeCount === 0 ? 0 : (typeCount.count / totalTypeCount) * 100;
    const start = segments.reduce(
      (sum, segment) => sum + segment.percentage,
      0,
    );
    const end = start + percentage;

    return [
      ...segments,
      {
        ...typeCount,
        percentage,
        start,
        end,
      },
    ];
  }, []);
  const typeChartBackground =
    totalTypeCount === 0
      ? "#252525"
      : `conic-gradient(${typeChartSegments
          .filter((segment) => segment.count > 0)
          .map(
            (segment) =>
              `${CARD_TYPE_COLORS[segment.type]} ${segment.start}% ${segment.end}%`,
          )
          .join(", ")})`;
  const largestMechanicCount = Math.max(
    1,
    ...mechanicBucketCounts.map((mechanic) => mechanic.count),
  );
  const mechanicChartWidth = 520;
  const mechanicChartHeight = 150;
  const mechanicChartPadding = 18;
  const mechanicChartInnerWidth = mechanicChartWidth - mechanicChartPadding * 2;
  const mechanicChartInnerHeight =
    mechanicChartHeight - mechanicChartPadding * 2;
  const mechanicChartPoints = mechanicBucketCounts.map((mechanic, index) => {
    const x =
      mechanicBucketCounts.length === 1
        ? mechanicChartWidth / 2
        : mechanicChartPadding +
          (index / (mechanicBucketCounts.length - 1)) * mechanicChartInnerWidth;
    const y =
      mechanicChartPadding +
      mechanicChartInnerHeight -
      (mechanic.count / largestMechanicCount) * mechanicChartInnerHeight;

    return {
      ...mechanic,
      x,
      y,
    };
  });
  const mechanicPolylinePoints = mechanicChartPoints
    .map((point) => `${point.x},${point.y}`)
    .join(" ");

  function getManaClass(color) {
    const classes = {
      W: "ms-w",
      U: "ms-u",
      B: "ms-b",
      R: "ms-r",
      G: "ms-g",
      C: "ms-c",
    };

    return classes[color] || "";
  }

  function deleteConfirmedPack() {
    // Actual delete lives in usePackBuilder so database and current pack state
    // are reset together.
    if (!savedPackId) return;

    deletePack(savedPackId);
    setConfirmingDeletePack(false);
  }

  function requireAuth() {
    if (isAuthenticated) return true;

    onAuthRequired?.();
    return false;
  }

  function toggleArchetypeTag(tag) {
    if (!requireAuth()) return;

    const isSelected = packArchetypeTags.some(
      (currentTag) => currentTag.normalizedName === tag.normalizedName,
    );

    if (isSelected) {
      setPackArchetypeTags(
        packArchetypeTags.filter(
          (currentTag) => currentTag.normalizedName !== tag.normalizedName,
        ),
      );
      setTagMessage("");
      return;
    }

    if (packArchetypeTags.length >= packTagLimit) {
      setTagMessage(`Packs can have up to ${packTagLimit} tags.`);
      return;
    }

    setPackArchetypeTags([...packArchetypeTags, tag]);
    setTagMessage("");
  }

  async function handleCreateTag() {
    if (!requireAuth() || isCreatingTag) return;

    const validationMessage = validatePackTagName(tagSearch);

    if (validationMessage) {
      setTagMessage(validationMessage);
      return;
    }

    if (packArchetypeTags.length >= packTagLimit) {
      setTagMessage(`Packs can have up to ${packTagLimit} tags.`);
      return;
    }

    setIsCreatingTag(true);
    const createdTag = await createPackTag?.(tagSearch, newTagColor);
    setIsCreatingTag(false);

    if (!createdTag || createdTag.error) {
      setTagMessage(createdTag?.error || "Tag could not be created.");
      return;
    }

    toggleArchetypeTag(createdTag);
    setTagSearch("");
  }

  const normalizedTagSearch = normalizePackTagName(tagSearch);
  const filteredPackTags = availablePackTags.filter((tag) => {
    const isSelected = packArchetypeTags.some(
      (selectedTag) => selectedTag.normalizedName === tag.normalizedName,
    );

    return (
      !isSelected &&
      (!normalizedTagSearch || tag.normalizedName.includes(normalizedTagSearch))
    );
  });
  const exactTagMatch = availablePackTags.some(
    (tag) => tag.normalizedName === normalizedTagSearch,
  );
  const tagValidationMessage = tagSearch ? validatePackTagName(tagSearch) : "";
  const canOfferTagCreation =
    normalizedTagSearch &&
    !exactTagMatch &&
    !tagValidationMessage &&
    packArchetypeTags.length < packTagLimit;

  function togglePackVisibility() {
    if (!requireAuth()) return;

    // Visibility autosaves through usePackBuilder; the message is only local UI.
    const nextVisibility = packVisibility === "public" ? "private" : "public";

    setPackVisibility(nextVisibility);
    setVisibilityMessage(nextVisibility === "public" ? "Public" : "Private");

    if (visibilityMessageTimeoutRef.current) {
      window.clearTimeout(visibilityMessageTimeoutRef.current);
    }

    visibilityMessageTimeoutRef.current = window.setTimeout(() => {
      setVisibilityMessage("");
      visibilityMessageTimeoutRef.current = null;
    }, 1800);
  }

  useEffect(() => {
    onStatsOpenChange?.(showPackStats);

    return () => {
      onStatsOpenChange?.(false);
    };
  }, [onStatsOpenChange, showPackStats]);

  useEffect(() => {
    return () => {
      if (visibilityMessageTimeoutRef.current) {
        window.clearTimeout(visibilityMessageTimeoutRef.current);
      }

      if (shareMessageTimeoutRef.current) {
        window.clearTimeout(shareMessageTimeoutRef.current);
      }
    };
  }, []);

  async function shareCurrentPack() {
    if (!savedPackId || packVisibility !== "public") return;

    const copied = await onSharePack?.(savedPackId);
    setShareMessage(copied ? "Link copied" : "Copy link opened");

    if (shareMessageTimeoutRef.current) {
      window.clearTimeout(shareMessageTimeoutRef.current);
    }

    shareMessageTimeoutRef.current = window.setTimeout(() => {
      setShareMessage("");
      shareMessageTimeoutRef.current = null;
    }, 1800);
  }

  useEffect(() => {
    if (!confirmingDeletePack) return undefined;

    function cancelDeleteConfirmation(event) {
      if (
        event.target.closest(".confirmDeletePackButton") ||
        event.target.closest(".deletePackButton")
      ) {
        return;
      }

      setConfirmingDeletePack(false);
    }

    window.addEventListener("click", cancelDeleteConfirmation);

    return () => {
      window.removeEventListener("click", cancelDeleteConfirmation);
    };
  }, [confirmingDeletePack]);

  useEffect(() => {
    if (!isArchetypeMenuOpen) return undefined;

    function closeTagMenu(event) {
      if (
        event.target.closest(".archetypeMenu") ||
        event.target.closest(".archetypeMenuButton")
      ) {
        return;
      }

      setIsArchetypeMenuOpen(false);
    }

    window.addEventListener("click", closeTagMenu);

    return () => {
      window.removeEventListener("click", closeTagMenu);
    };
  }, [isArchetypeMenuOpen]);

  return (
    <aside
      className={`packBox 
        ${isDragOverPack ? "dragOverPack" : ""}
        ${isDraggingCard ? "isDragging" : ""}
        ${isOpen ? "open" : "closed"}
        ${showPackStats ? "statsOpen" : ""}
        ${suppressStackHover ? "suppressStackHover" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setSuppressStackHover(true);
      }}
      onDragLeave={() => {
        setIsDragOverPack(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setSuppressStackHover(false);

        const cardData = e.dataTransfer.getData("application/json");

        if (!cardData) return;

        addCard(JSON.parse(cardData));
      }}
    >
      <button
        className="packBoxToggle"
        onClick={() => {
          setShowPackStats(false);
          setIsOpen((prev) => !prev);
        }}
        title={isOpen ? "Hide pack" : "Show pack"}
        aria-label={isOpen ? "Hide pack" : "Show pack"}
        aria-expanded={isOpen}
      >
        {isOpen ? ">" : "<"}
      </button>

      <p
        className="packActionHint"
        aria-live="polite"
        aria-label="Pack action hint"
      >
        {packActionHint}
      </p>

      <div className="packActionToolbar" aria-label="Pack actions">
        <button
          className={`packVisibilitySwitch ${packVisibility}`}
          type="button"
          onClick={togglePackVisibility}
          disabled={!isPackActive}
          {...getPackActionHintProps(
            "Set pack visibility. (required to share)",
          )}
          aria-label={`Pack visibility: ${
            packVisibility === "public" ? "Public" : "Private"
          }`}
          aria-pressed={packVisibility === "public"}
        >
          <span aria-hidden="true" />
        </button>

        <span
          className="packActionHintTarget"
          {...getPackActionHintProps("Open your saved packs.")}
        >
          <button
            className="packActionButton openPacksButton"
            type="button"
            onClick={() => {
              if (!requireAuth()) return;

              setConfirmingDeletePack(false);
              onOpenPacks();
            }}
            aria-label="Open my packs"
          >
            <svg
              aria-hidden="true"
              className="actionIcon"
              viewBox="0 0 24 24"
              focusable="false"
            >
              <path d="M3.5 6.5h6l2 2h10v2h-18z" />
              <path d="M2.5 9.5h21l-2 11h-19z" />
            </svg>
          </button>
        </span>

        <span
          className="packActionHintTarget"
          {...getPackActionHintProps("Start a new empty pack.")}
        >
          <button
            className="packActionButton newPackButton"
            type="button"
            onClick={() => {
              if (!requireAuth()) return;

              setConfirmingDeletePack(false);
              newPack();
            }}
            aria-label="New pack"
          >
            <span aria-hidden="true">+</span>
          </button>
        </span>

        <button
          className="packActionButton deletePackButton"
          type="button"
          {...getPackActionHintProps(
            savedPackId
              ? "Delete this saved pack."
              : "Save this pack before deleting it.",
          )}
          onClick={(event) => {
            event.stopPropagation();
            if (!requireAuth()) return;

            setConfirmingDeletePack((current) => !current);
          }}
          disabled={!savedPackId}
          aria-label={
            savedPackId ? "Delete pack" : "Save this pack before deleting"
          }
        >
          <svg
            aria-hidden="true"
            className="actionIcon"
            viewBox="0 0 24 24"
            focusable="false"
          >
            <path d="M9 3h6l1 2h5v2H3V5h5z" />
            <path d="M6 9h12l-1 12H7z" />
            <path className="actionIconInset" d="M10 11h2v8h-2z" />
            <path className="actionIconInset" d="M14 11h2v8h-2z" />
          </svg>
          <span aria-hidden="true">Ã—</span>
        </button>

        <button
          className="packActionButton addPackToCubeButton"
          type="button"
          {...getPackActionHintProps(
            !isCubeActive
              ? "Create or open a cube before adding this pack."
              : selectedCards.length === 0
              ? "Add cards before saving this pack to your cube."
              : "Save this pack and add it to the current cube.",
          )}
          onClick={() => {
            if (!requireAuth()) return;

            setConfirmingDeletePack(false);
            addCurrentPackToCube();
          }}
          disabled={
            !isCubeActive ||
            selectedCards.length === 0 ||
            saveStatus === "saving"
          }
          aria-label="Save and add pack to cube"
        >
          <svg
            aria-hidden="true"
            className="actionIcon"
            viewBox="0 0 24 24"
            focusable="false"
          >
            <path d="M4 5h7v7H4z" />
            <path d="M13 5h7v7h-7z" />
            <path d="M4 14h7v7H4z" />
            <path d="M15 14h3v3h3v2h-3v3h-2v-3h-3v-2h3z" />
          </svg>
          <span aria-hidden="true">âŠž</span>
        </button>

        <button
          className="packActionButton convertDeckButton"
          type="button"
          {...getPackActionHintProps("Convert an Arena deck into a jump pack.")}
          onClick={() => {
            setConfirmingDeletePack(false);
            setIsDeckConverterOpen(true);
          }}
          aria-label="Convert Arena deck"
        >
          <svg
            aria-hidden="true"
            className="actionIcon"
            viewBox="0 0 24 24"
            focusable="false"
          >
            <path d="M4 3h11l5 5v13H4z" />
            <path className="actionIconInset" d="M14 4v5h5" />
            <path className="actionIconInset" d="M7 12h10v2H7zM7 16h7v2H7z" />
          </svg>
        </button>

        <button
          className="packActionButton archetypeMenuButton"
          type="button"
          {...getPackActionHintProps(
            "Add or create an archetype tag for this pack.",
          )}
          onClick={() => {
            if (!requireAuth()) return;

            setConfirmingDeletePack(false);
            setIsArchetypeMenuOpen((current) => !current);
          }}
          aria-label="Add archetype tag"
          aria-expanded={isArchetypeMenuOpen}
        >
          <span aria-hidden="true">#</span>
        </button>

        <button
          className="packActionButton packStatsButton"
          type="button"
          {...getPackActionHintProps("Show stats panel.")}
          onClick={() => {
            if (!requireAuth()) return;

            setConfirmingDeletePack(false);
            setShowPackStats(true);
          }}
          disabled={selectedCards.length === 0}
          aria-label="Show pack statistics"
        >
          <span aria-hidden="true">%</span>
        </button>

        <button
          className="packActionButton sharePackButton"
          type="button"
          {...getPackActionHintProps(
            savedPackId && packVisibility === "public"
              ? "Copy a share link for this public pack."
              : "Save this pack as public before sharing.",
          )}
          onClick={() => {
            setConfirmingDeletePack(false);
            shareCurrentPack();
          }}
          disabled={!savedPackId || packVisibility !== "public"}
          aria-label={
            savedPackId && packVisibility === "public"
              ? "Copy public pack link"
              : "Save this pack as public before sharing"
          }
        >
          <svg
            aria-hidden="true"
            className="actionIcon"
            viewBox="0 0 24 24"
            focusable="false"
          >
            <path d="M6 5h7v2H8v9h9v-5h2v7H6z" />
            <path d="M14 4h6v6h-2V7.4l-6.3 6.3-1.4-1.4L16.6 6H14z" />
          </svg>
        </button>
      </div>

      {visibilityMessage && (
        <p
          className={`visibilityMessage ${
            visibilityMessage === "Public" ? "public" : "private"
          }`}
        >
          {visibilityMessage}
        </p>
      )}

      {shareMessage && <p className="shareMessage">{shareMessage}</p>}

      {saveStatus === "saving" && <p className="saveMessage">Saving...</p>}

      {saveStatus === "saved" && (
        <p className="saveMessage success">Pack saved ✓</p>
      )}

      {saveStatus === "error" && (
        <p className="saveMessage error">{saveErrorMessage || "Save failed"}</p>
      )}

      {saveStatus === "blocked" && (
        <p className="saveMessage error">Text needs review</p>
      )}

      {confirmingDeletePack && (
        <button
          className="confirmDeletePackButton"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            deleteConfirmedPack();
          }}
          aria-label={`Confirm delete ${packName}`}
        >
          Delete {packName}
        </button>
      )}

      {!isPackActive ? (
        <div className="packEmptyState">
          <h2>No active pack</h2>
          <p>Click the New Pack button to start a pack.</p>
        </div>
      ) : editingName ? (
        <input
          className="packNameInput"
          value={usesDraftNamePlaceholder ? "" : packName}
          aria-invalid={Boolean(packNameModerationMessage)}
          maxLength={TITLE_MAX_LENGTH}
          placeholder="Unnamed Pack"
          autoFocus
          onChange={(e) => setPackName(sanitizeTitleInput(e.target.value))}
          onBlur={() => {
            if (!packNameModerationMessage) {
              if (!packName.trim() && !savedPackId) {
                setPackName(DRAFT_PACK_NAME);
              }
              setEditingName(false);
              setIsEditingText?.(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !packNameModerationMessage) {
              if (!packName.trim() && !savedPackId) {
                setPackName(DRAFT_PACK_NAME);
              }
              setEditingName(false);
              setIsEditingText?.(false);
            }
          }}
        />
      ) : (
        <h2
          className="packTitle"
          onClick={() => {
            if (!requireAuth()) return;
            setIsEditingText?.(true);
            setEditingName(true);
          }}
        >
          {usesDraftNamePlaceholder ? (
            <span className="placeholderText">Unnamed Pack</span>
          ) : (
            packName
          )}
        </h2>
      )}
      {isPackActive && packNameModerationMessage && (
        <p className="contentModerationMessage" role="alert">
          {packNameModerationMessage}
        </p>
      )}
      {isPackActive && editingDescription ? (
        <textarea
          className="packDescriptionInput"
          value={packDescription}
          aria-invalid={Boolean(packDescriptionModerationMessage)}
          maxLength={DESCRIPTION_MAX_LENGTH}
          placeholder="Click to add a description..."
          autoFocus
          onChange={(e) =>
            setPackDescription(sanitizeDescriptionInput(e.target.value))
          }
          onBlur={() => {
            if (!packDescriptionModerationMessage) {
              setEditingDescription(false);
              setIsEditingText?.(false);
            }
          }}
        />
      ) : isPackActive ? (
        <p
          className="packDescription"
          onClick={() => {
            if (!requireAuth()) return;
            setIsEditingText?.(true);
            setEditingDescription(true);
          }}
          title="Click to edit description"
        >
          {packDescription || (
            <span className="placeholderText">
              Click to add a description...
            </span>
          )}
        </p>
      ) : null}
      {isPackActive && packDescriptionModerationMessage && (
        <p className="contentModerationMessage" role="alert">
          {packDescriptionModerationMessage}
        </p>
      )}
      {isPackActive && <div className="packSummary">
        <div className="packMetadata" aria-label="Pack color identity">
          <div className="packColorIdentity">
            {sortedPackColors.length === 0 ? (
              <i className="ms ms-c manaSymbol manaSymbolC" title="Colorless" />
            ) : (
              sortedPackColors.map((color) => (
                <i
                  className={`ms ${getManaClass(color)} manaSymbol manaSymbol${color}`}
                  key={color}
                  title={color}
                />
              ))
            )}
          </div>
        </div>

        <p className="packCount">
          <strong>{totalCards}</strong>
          <span> / {packCardLimit} cards</span>
        </p>

        <p className="packTotalPrice">
          <span>Total</span>
          <strong>{formatUsd(totalPrice)}</strong>
        </p>

        {totalCards >= packCardLimit && (
          <p className="packLimitMessage">Pack limit reached</p>
        )}
      </div>}

      {isPackActive && (
        <div className="packFormatPanel">
          <label>
            Format
            <select
              value={packFormatId}
              onChange={(event) => setPackFormat?.(event.target.value)}
            >
              {Object.values(packFormats).map((format) => (
                <option value={format.id} key={format.id}>
                  {format.name}
                </option>
              ))}
            </select>
          </label>

          {isCommanderPack && (
            <label className="commanderSlotControl">
              Commander
              <select
                value={commanderCard?.id || commanderCardId || ""}
                onChange={(event) => setCommanderCard?.(event.target.value)}
              >
                <option value="">Choose a commander</option>
                {commanderOptions.map((card) => (
                  <option value={card.id} key={card.id}>
                    {card.name}
                  </option>
                ))}
              </select>
              {!hasValidCommander && (
                <span role="alert">Add an eligible commander for this slot.</span>
              )}
            </label>
          )}
        </div>
      )}

      <div className="packVisibilityToggle" aria-label="Pack visibility">
        <span>Visibility</span>
        <button
          type="button"
          className={packVisibility === "public" ? "public" : "private"}
          onClick={() => {
            if (!requireAuth()) return;
            setPackVisibility((currentVisibility) =>
              currentVisibility === "public" ? "private" : "public",
            );
          }}
          disabled={!isPackActive}
          aria-pressed={packVisibility === "public"}
        >
          {packVisibility === "public" ? "Public" : "Private"}
        </button>
      </div>

      <div className="packActionToolbar" aria-label="Pack actions">
        <button
          className="packActionButton openPacksButton"
          type="button"
          onClick={() => {
            if (!requireAuth()) return;

            setConfirmingDeletePack(false);
            onOpenPacks();
          }}
          title="Open my packs"
          aria-label="Open my packs"
        >
          <svg
            aria-hidden="true"
            className="actionIcon"
            viewBox="0 0 24 24"
            focusable="false"
          >
            <path d="M3.5 6.5h6l2 2h10v2h-18z" />
            <path d="M2.5 9.5h21l-2 11h-19z" />
          </svg>
        </button>

        <button
          className="packActionButton newPackButton"
          type="button"
          onClick={() => {
            if (!requireAuth()) return;

            setConfirmingDeletePack(false);
            newPack();
          }}
          title="New pack"
          aria-label="New pack"
        >
          <span aria-hidden="true">+</span>
        </button>

        <button
          className="packActionButton deletePackButton"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (!requireAuth()) return;

            setConfirmingDeletePack((current) => !current);
          }}
          disabled={!savedPackId}
          title={savedPackId ? "Delete pack" : "Save this pack before deleting"}
          aria-label={
            savedPackId ? "Delete pack" : "Save this pack before deleting"
          }
        >
          <span aria-hidden="true">×</span>
        </button>

        <button
          className="packActionButton addPackToCubeButton"
          type="button"
          onClick={() => {
            if (!requireAuth()) return;

            setConfirmingDeletePack(false);
            addCurrentPackToCube();
          }}
          disabled={
            !isCubeActive ||
            selectedCards.length === 0 ||
            saveStatus === "saving"
          }
          title="Save and add pack to cube"
          aria-label="Save and add pack to cube"
        >
          <span aria-hidden="true">⊞</span>
        </button>
        <button
          className="packActionButton convertDeckButton"
          type="button"
          onClick={() => {
            setConfirmingDeletePack(false);
            setIsDeckConverterOpen(true);
          }}
          title="Convert Arena deck"
          aria-label="Convert Arena deck"
        >
          <svg
            aria-hidden="true"
            className="actionIcon"
            viewBox="0 0 24 24"
            focusable="false"
          >
            <path d="M4 3h11l5 5v13H4z" />
            <path className="actionIconInset" d="M14 4v5h5" />
            <path className="actionIconInset" d="M7 12h10v2H7zM7 16h7v2H7z" />
          </svg>
        </button>

        <button
          className="packActionButton archetypeMenuButton"
          type="button"
          onClick={() => {
            if (!requireAuth()) return;

            setConfirmingDeletePack(false);
            setIsArchetypeMenuOpen((current) => !current);
          }}
          disabled={!isPackActive}
          title="Add archetype tag"
          aria-label="Add archetype tag"
          aria-expanded={isArchetypeMenuOpen}
        >
          <span aria-hidden="true">#</span>
        </button>

        <button
          className="packActionButton packStatsButton"
          type="button"
          onClick={() => {
            if (!requireAuth()) return;

            setConfirmingDeletePack(false);
            setShowPackStats(true);
          }}
          disabled={!isPackActive || selectedCards.length === 0}
          title="Show pack statistics"
          aria-label="Show pack statistics"
        >
          <span aria-hidden="true">%</span>
        </button>
      </div>

      {packArchetypeTags.length > 0 && (
        <div className="packArchetypeTags" aria-label="Selected archetypes">
          {packArchetypeTags.map((tag) => (
            <button
              type="button"
              className="packArchetypeTag"
              key={tag.id || tag.normalizedName}
              style={getPackTagStyle(tag)}
              onClick={() => toggleArchetypeTag(tag)}
              title={`Remove ${tag.name}`}
            >
              {tag.name}
              <span aria-hidden="true">&times;</span>
            </button>
          ))}
        </div>
      )}

      <DeckConverterModal
        isOpen={isDeckConverterOpen}
        onClose={() => setIsDeckConverterOpen(false)}
        onConvert={onConvertDeck}
        onFinalize={onFinalizeConvertedDeck}
      />

      {isArchetypeMenuOpen && (
        <div className="archetypeMenu" aria-label="Archetype tags">
          <div className="archetypeMenuHeader">
            <span>
              Tags ({packArchetypeTags.length}/{packTagLimit})
            </span>
            <button
              type="button"
              onClick={() => {
                if (!requireAuth()) return;
                setPackArchetypeTags([]);
              }}
              disabled={packArchetypeTags.length === 0}
            >
              Clear
            </button>
          </div>

          <input
            className="tagSearchInput"
            type="text"
            value={tagSearch}
            onChange={(event) => {
              setTagSearch(event.target.value);
              setTagMessage("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canOfferTagCreation) {
                event.preventDefault();
                handleCreateTag();
              }
            }}
            placeholder="Search or create a tag"
            autoComplete="off"
          />

          <div className="archetypeOptions">
            {filteredPackTags.slice(0, 8).map((tag) => (
              <button
                type="button"
                className="archetypeOption"
                key={tag.id || tag.normalizedName}
                onClick={() => toggleArchetypeTag(tag)}
                disabled={packArchetypeTags.length >= packTagLimit}
              >
                <span className="tagColorDot" style={getPackTagStyle(tag)} />
                <span>{tag.name}</span>
                {tag.usageCount > 0 && <small>{tag.usageCount}</small>}
              </button>
            ))}
          </div>

          {canOfferTagCreation && (
            <div className="tagCreationPanel">
              <p>
                Create <strong>{formatPackTagName(tagSearch)}</strong>
              </p>
              <div className="tagColorOptions" aria-label="Tag color">
                {PACK_TAG_COLORS.map((color) => (
                  <button
                    type="button"
                    key={color.id}
                    className={newTagColor === color.id ? "selected" : ""}
                    style={{ "--pack-tag-color": color.value }}
                    onClick={() => setNewTagColor(color.id)}
                    aria-label={color.label}
                    title={color.label}
                  />
                ))}
              </div>
              <button
                type="button"
                className="createTagButton"
                onClick={handleCreateTag}
                disabled={isCreatingTag}
              >
                {isCreatingTag ? "Creating..." : "Create Tag"}
              </button>
            </div>
          )}

          {(tagMessage || tagValidationMessage) && (
            <p className="tagMessage" role="alert">
              {tagMessage || tagValidationMessage}
            </p>
          )}
          <p className="tagGuidance">
            Letters only. Up to three words; one idea per tag.
          </p>
        </div>
      )}

      {showPackStats && (
        <div className="packStatsOverlay" role="dialog" aria-modal="true">
          <div className="packStatsHeader">
            <div>
              <h2>{packName}</h2>
              <p>
                {totalCards} / {packCardLimit} cards selected
              </p>
            </div>

            <button
              className="packStatsCloseButton"
              type="button"
              onClick={() => {
                if (onStatsClose) {
                  onStatsClose();
                  return;
                }

                setShowPackStats(false);
              }}
              aria-label="Close pack statistics"
              title="Close pack statistics"
            >
              x
            </button>
          </div>

          <div
            className="packStatsTableModeToggle"
            role="group"
            aria-label="Card stack sorting table"
          >
            {PACK_STATS_TABLE_MODES.map((mode) => (
              <button
                type="button"
                key={mode.id}
                className={packStatsTableMode === mode.id ? "active" : ""}
                aria-pressed={packStatsTableMode === mode.id}
                onClick={() => {
                  setPackStatsTableMode(mode.id);
                  setDraggedStatsCardId(null);
                }}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <div className="packStatsBody">
            <div
              className={`packStatsColumns packStatsColumns-${packStatsTableMode}`}
              aria-label={`Cards by ${activeStatsTableLabel.toLowerCase()}`}
            >
              {activeStatsColumns.map((column) => (
                <section
                  className={`packStatsColumn ${
                    canMoveStatsCards && draggedStatsCardId
                      ? "canDropStatsCard"
                      : ""
                  }`}
                  key={column.id}
                  onDragOver={(e) => {
                    if (!canMoveStatsCards || !draggedStatsCardId) return;

                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    if (!canMoveStatsCards) return;

                    e.preventDefault();
                    e.stopPropagation();

                    const statsCardId =
                      draggedStatsCardId ||
                      e.dataTransfer.getData("text/pack-stats-card");

                    moveCardToMechanicBucket?.(statsCardId, column.id);
                    setDraggedStatsCardId(null);
                  }}
                >
                  <header className="packStatsColumnHeader">
                    <span>{column.label}</span>
                    <span className="packStatsColumnCount">
                      {column.cards.length}
                    </span>
                  </header>

                  <div
                    className="packStatsStack"
                    onDragOver={(e) => {
                      if (!canMoveStatsCards || !draggedStatsCardId) return;

                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      if (!canMoveStatsCards) return;

                      e.preventDefault();
                      e.stopPropagation();

                      const statsCardId =
                        draggedStatsCardId ||
                        e.dataTransfer.getData("text/pack-stats-card");

                      moveCardToMechanicBucket?.(statsCardId, column.id);
                      setDraggedStatsCardId(null);
                    }}
                  >
                    {column.cards.length === 0 ? (
                      <p className="packStatsEmpty">No cards</p>
                    ) : (
                      column.cards.map((card) => (
                        <div
                          className="packStatsCard"
                          draggable={canMoveStatsCards}
                          key={card.stackId}
                          onClick={() => onCardOpen?.(card)}
                          onDragStart={(e) => {
                            if (!canMoveStatsCards) {
                              e.preventDefault();
                              return;
                            }

                            e.stopPropagation();
                            setDraggedStatsCardId(card.id);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData(
                              "text/pack-stats-card",
                              String(card.id),
                            );
                          }}
                          onDragEnd={(e) => {
                            e.stopPropagation();
                            setDraggedStatsCardId(null);
                          }}
                        >
                          <img
                            src={card.image_url}
                            alt={card.name}
                            draggable={false}
                          />
                        </div>
                      ))
                    )}
                  </div>
                </section>
              ))}
            </div>

            <section
              className="packStatsVisualArea"
              aria-label="Pack statistics"
            >
              <div className="packManaCurveChart">
                <h3 className="packManaCurveTitle">Mana Curve</h3>

                <div className="packManaCurveLegend">
                  <span>
                    <i className="packManaCurveLegendSwatch current" />
                    Current
                  </span>
                  <span>
                    <i className="packManaCurveLegendSwatch ideal" />
                    Ideal
                  </span>
                </div>

                <div className="packManaCurveBars">
                  <div className="packManaCurveGrid" aria-hidden="true">
                    {manaCurveLevelLines.map((level) => (
                      <div
                        className="packManaCurveGridLine"
                        key={level}
                        style={{
                          bottom: `${(level / largestManaCurveChartCount) * 100}%`,
                        }}
                      >
                        <span>{level}</span>
                      </div>
                    ))}
                  </div>

                  {manaCurveChartColumns.map((column) => (
                    <div className="packManaCurveBarGroup" key={column.label}>
                      <div className="packManaCurveBarTrack">
                        <div
                          className="packManaCurveIdealBar"
                          style={{
                            height: `${Math.max(
                              4,
                              (column.idealCount / largestManaCurveChartCount) *
                                100,
                            )}%`,
                          }}
                        />
                        <div
                          className="packManaCurveBar"
                          style={{
                            height:
                              column.cards.length === 0
                                ? "0%"
                                : `${Math.max(
                                    4,
                                    (column.cards.length /
                                      largestManaCurveChartCount) *
                                      100,
                                  )}%`,
                          }}
                        />
                      </div>
                      <span>{column.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="packTypeChart" aria-label="Card type percentages">
                <div
                  className="packTypePie"
                  style={{ "--type-chart": typeChartBackground }}
                />

                <div className="packTypeLegend">
                  {typeChartSegments.map((segment) => (
                    <div className="packTypeLegendItem" key={segment.type}>
                      <span
                        className="packTypeSwatch"
                        style={{
                          "--type-color": CARD_TYPE_COLORS[segment.type],
                        }}
                      />
                      <span className="packTypeCount">{segment.count}</span>
                      <span>{CARD_TYPE_LABELS[segment.type]}</span>
                      <strong>{Math.round(segment.percentage)}%</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div
                className="packMechanicChart"
                aria-label="Card mechanics profile"
              >
                <svg
                  className="packMechanicSvg"
                  viewBox={`0 0 ${mechanicChartWidth} ${mechanicChartHeight}`}
                  role="img"
                  aria-label="Mechanical action counts"
                >
                  <polyline
                    className="packMechanicLine"
                    points={mechanicPolylinePoints}
                  />
                  {mechanicChartPoints.map((point) => (
                    <g key={point.id}>
                      <line
                        className="packMechanicGuide"
                        x1={point.x}
                        x2={point.x}
                        y1={mechanicChartPadding}
                        y2={mechanicChartHeight - mechanicChartPadding}
                      />
                      <circle
                        className="packMechanicDot"
                        cx={point.x}
                        cy={point.y}
                        r="4.5"
                        style={{ "--mechanic-color": point.color }}
                      />
                      <text
                        className="packMechanicCount"
                        x={point.x}
                        y={Math.max(12, point.y - 8)}
                      >
                        {point.count}
                      </text>
                    </g>
                  ))}
                </svg>

                <div className="packMechanicLabels">
                  {mechanicChartPoints.map((point) => (
                    <span key={point.id} title={point.label}>
                      {point.shortLabel}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {showRenameChoice && (
        <div className="renameChoiceBox">
          <p className="renameTitle">Pack name changed</p>

          <p className="renameText">
            Update existing pack or create a new version?
          </p>

          <button
            className="renameButton"
            onClick={pendingSaveAction?.renameExisting}
          >
            Update Existing
          </button>

          <button
            className="renameButton secondary"
            onClick={pendingSaveAction?.saveAsNew}
          >
            Save As New
          </button>
        </div>
      )}
      {/* <button
        className="manaCurveToggle"
        onClick={() => setShowManaCurve((prev) => !prev)}
      >
        {showManaCurve ? "Mana Curve ▲" : "Mana Curve ▼"}
      </button>

      {showManaCurve && (
        <div className="manaCurve">
          <h3>Mana Curve</h3>

          {[0, 1, 2, 3, 4, 5, 6, 7].map((mv) => {
            const count = selectedCards.reduce((sum, card) => {
              const cardMv = Number(card.mana_value);
              const bucket = cardMv >= 7 ? 7 : cardMv;

              return bucket === mv ? sum + card.quantity : sum;
            }, 0);

            const maxCount = Math.max(
              1,
              ...[0, 1, 2, 3, 4, 5, 6, 7].map((curveMv) =>
                selectedCards.reduce((sum, card) => {
                  const cardMv = Number(card.mana_value);
                  const bucket = cardMv >= 7 ? 7 : cardMv;

                  return bucket === curveMv ? sum + card.quantity : sum;
                }, 0),
              ),
            );

            return (
              <div className="curveRow" key={mv}>
                <span className="curveLabel">{mv === 7 ? "7+" : mv}</span>

                <div className="curveBarWrap">
                  <div
                    className="curveBar"
                    style={{ width: `${(count / maxCount) * 100}%` }}
                  />
                </div>

                <span className="curveCount">{count}</span>
              </div>
            );
          })}
        </div>
      )} */}
      <div className="packCardScrollArea">
        {!isPackActive ? (
          <p className="emptyPack">Create or open a pack to begin.</p>
        ) : selectedCards.length === 0 ? (
          <p className="emptyPack">Add cards to start your pack.</p>
        ) : (
          <div className="stackedPackCards">
            {displayedCards.map((card) => (
              <div
                className={`stackedPackCard ${
                  dragOverCardId === card.id ? "dragOver" : ""
                }${
                  swipeRemoveState.stackId === card.stackId
                    ? " isSwipeRemoving"
                    : ""
                }${
                  swipeRemoveState.stackId === card.stackId &&
                  swipeRemoveState.holding
                    ? " swipeRemoveHolding"
                    : ""
                }`}
                key={card.stackId}
                data-card-id={card.id}
                draggable
                style={{
                  touchAction: "none",
                  ...(swipeRemoveState.stackId === card.stackId
                    ? {
                        "--swipe-remove-offset": `${swipeRemoveState.offset}px`,
                      }
                    : {}),
                }}
                onDragStart={(e) => {
                  if (window.matchMedia("(max-width: 760px)").matches) {
                    e.preventDefault();
                    return;
                  }

                  if (swipeRemoveGestureRef.current.stackId === card.stackId) {
                    e.preventDefault();
                    return;
                  }

                  cardDragStartedRef.current = true;
                  setDraggedCardId(card.id);
                  setSuppressStackHover(true);

                  droppedInsidePackRef.current = false;

                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/pack-card", String(card.id));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverCardId(card.id);
                }}
                onDragLeave={() => setDragOverCardId(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setSuppressStackHover(false);
                  droppedInsidePackRef.current = true;

                  const internalPackCard =
                    e.dataTransfer.getData("text/pack-card");
                  if (internalPackCard) return;

                  const cardData = e.dataTransfer.getData("application/json");
                  if (!cardData) return;

                  addCard(JSON.parse(cardData));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  droppedInsidePackRef.current = true;

                  const internalPackCard =
                    e.dataTransfer.getData("text/pack-card");
                  const externalCardData =
                    e.dataTransfer.getData("application/json");

                  // Reordering an existing card already in the pack
                  if (internalPackCard) {
                    moveCard(draggedCardId, card.id);
                    setDraggedCardId(null);
                    setDragOverCardId(null);
                    setSuppressStackHover(false);
                    return;
                  }

                  // Dragging a card from the search/card grid into the pack
                  if (externalCardData) {
                    addCard(JSON.parse(externalCardData));
                    setDraggedCardId(null);
                    setDragOverCardId(null);
                    setSuppressStackHover(false);
                    return;
                  }
                }}
                onDragEnd={() => {
                  if (window.matchMedia("(max-width: 760px)").matches) {
                    cardDragStartedRef.current = false;
                    droppedInsidePackRef.current = false;
                    return;
                  }

                  if (
                    cardDragStartedRef.current &&
                    !droppedInsidePackRef.current
                  ) {
                    decreaseCardQuantity(card.id);
                  }

                  cardDragStartedRef.current = false;
                  droppedInsidePackRef.current = false;
                  setDraggedCardId(null);
                  setDragOverCardId(null);
                  setSuppressStackHover(false);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();

                  if (window.matchMedia("(max-width: 760px)").matches) {
                    return;
                  }

                  decreaseCardQuantity(card.id);
                }}
                onClick={() => {
                  if (suppressCardClickRef.current) {
                    suppressCardClickRef.current = false;
                    return;
                  }

                  if (cardDragStartedRef.current) return;

                  onCardOpen?.(card);
                }}
              >
                <img src={card.image_url} alt={card.name} />
                <button
                  type="button"
                  className="mobileCardGestureLayer"
                  aria-label={`${card.name}: hold and drag to reorder, or swipe right to remove`}
                  onPointerDown={(event) => handleSwipeRemoveStart(event, card)}
                  onPointerMove={handleSwipeRemoveMove}
                  onPointerUp={handleSwipeRemoveEnd}
                  onPointerCancel={handleSwipeRemoveCancel}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
