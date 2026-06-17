import { useEffect, useRef, useState } from "react";
import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  sanitizeDescriptionInput,
  sanitizeTitleInput,
} from "../../utils/userText";
import { getContentModerationMessage } from "../../utils/contentModeration";
import {
  getPackTagColor,
  normalizePackTags,
} from "../../utils/packTags";
import "./JumpCubeBox.css";

/*
 * JumpCubeBox is the active cube editor panel.
 *
 * Props:
 * - cubeName/cubeDescription plus setters: controlled cube metadata
 * - selectedPacks: Array<pack summary> from App/useUserCubes
 * - onOpenCubes(): opens CubeLibraryModal
 * - onOpenPack(packId): loads a cube pack into PackBox
 * - removePackFromCube(packId): removes relationship from current cube
 * - newCube(): resets active cube editor state
 * - saveStatus: "saving" | "saved" | "error" | ""
 * - isOpen/setIsOpen: side-panel collapsed state
 * - isAuthenticated/onAuthRequired: gate account-backed cube workflows
 */

// Colors used for the mana-pip percentage backdrop on each pack item.
const MANA_COLORS = {
  W: "#eee0b3",
  U: "#3560c6",
  B: "#60086f",
  R: "#bd1616",
  G: "#1e8514",
  C: "#9ea3a6",
};
const MANA_ORDER = ["W", "U", "B", "R", "G", "C"];
const MANA_LABELS = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};
const CUBE_MANA_CURVE_VALUES = [1, 2, 3, 4, 5, 6];
const CUBE_TAG_CHART_LIMIT = 6;
const CUBE_OTHER_TAG_COLOR = "#6f7782";
const MOBILE_PACK_REORDER_HOLD_MS = 400;
const MOBILE_PACK_REMOVE_HOLD_MS = 1500;
const MOBILE_PACK_REMOVE_THRESHOLD = 88;
const MOBILE_PACK_REMOVE_CANCEL_THRESHOLD = 56;
const MOBILE_PACK_REMOVE_MAX_DISTANCE = 124;
const MOBILE_PACK_GESTURE_TOLERANCE = 8;
const CUBE_COLOR_COLUMNS = [
  // Stats view groups packs by overall color identity, not mana-cost pips.
  { id: "W", label: "White" },
  { id: "U", label: "Blue" },
  { id: "B", label: "Black" },
  { id: "R", label: "Red" },
  { id: "G", label: "Green" },
  { id: "C", label: "Colorless" },
  { id: "M", label: "Multicolor" },
];

function getManaCost(card) {
  return card.mana_cost || "";
}

function getCardManaPips(card) {
  // Counts colored/colorless symbols in mana_cost only. Generic costs are
  // intentionally ignored.
  const pips = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
    C: 0,
  };
  const manaCost = getManaCost(card);
  const symbols = manaCost.match(/\{[^}]+\}/g) || [];

  symbols.forEach((symbol) => {
    MANA_ORDER.forEach((color) => {
      if (symbol.includes(color)) {
        pips[color] += 1;
      }
    });
  });

  return pips;
}

function getPackManaPipSegments(pack) {
  /*
   * Converts all card mana pips in a pack into percentage segments.
   * Segments are sorted ascending by count so the largest color lands on the
   * right side after CSS positioning.
   */
  const totals = MANA_ORDER.reduce(
    (counts, color) => ({ ...counts, [color]: 0 }),
    {},
  );

  (pack.cards || []).forEach((card) => {
    const cardPips = getCardManaPips(card);
    const quantity = card.quantity || 1;

    MANA_ORDER.forEach((color) => {
      totals[color] += cardPips[color] * quantity;
    });
  });

  const totalPips = MANA_ORDER.reduce((sum, color) => sum + totals[color], 0);

  if (totalPips === 0) {
    return [
      {
        color: "C",
        start: 0,
        end: 100,
        percentage: 100,
      },
    ];
  }

  let currentOffset = 0;

  return MANA_ORDER.map((color) => ({
    color,
    count: totals[color],
    percentage: (totals[color] / totalPips) * 100,
  }))
    .filter((segment) => segment.count > 0)
    .sort((segmentA, segmentB) => {
      if (segmentA.count !== segmentB.count) {
        return segmentA.count - segmentB.count;
      }

      return MANA_ORDER.indexOf(segmentA.color) - MANA_ORDER.indexOf(segmentB.color);
    })
    .map((segment) => {
      const start = currentOffset;
      const end = currentOffset + segment.percentage;

      currentOffset = end;

      return {
        ...segment,
        start,
        end,
      };
    });
}

function getPackManaBackdrop(pack) {
  // Returns layered spans whose CSS variables draw the slanted color divisions.
  return (
    <span className="cubePackManaBackdrop" aria-hidden="true">
      {getPackManaPipSegments(pack).map((segment, index, segments) => (
        <span
          className="cubePackManaSegment"
          key={segment.color}
          style={{
            "--segment-color": MANA_COLORS[segment.color],
            "--segment-start": `${segment.start}%`,
            "--segment-end": `${segment.end}%`,
            "--segment-left-slope": index === 0 ? "0px" : "8px",
            "--segment-right-slope":
              index === segments.length - 1 ? "0px" : "8px",
          }}
        />
      ))}
    </span>
  );
}

function getCardCurveColors(card) {
  const cardColors = Array.isArray(card.colors) ? card.colors : [];
  const recognizedColors = MANA_ORDER.filter((color) =>
    cardColors.includes(color),
  );

  return recognizedColors.length > 0 ? recognizedColors : ["C"];
}

function getCubeManaCurveColumns(packs) {
  return CUBE_MANA_CURVE_VALUES.map((manaValue) => {
    const packSegments = packs
      .map((pack) => {
        const colorCounts = MANA_ORDER.reduce(
          (counts, color) => ({ ...counts, [color]: 0 }),
          {},
        );
        let cardCount = 0;

        (pack.cards || []).forEach((card) => {
          const cardManaValue = Number(card.mana_value || 0);
          const bucket = cardManaValue >= 6 ? 6 : Math.max(0, cardManaValue);

          if (bucket !== manaValue) return;

          const quantity = Number(card.quantity) || 1;
          const colors = getCardCurveColors(card);
          const colorShare = quantity / colors.length;

          cardCount += quantity;
          colors.forEach((color) => {
            colorCounts[color] += colorShare;
          });
        });

        return {
          id: pack.savedPackId || pack.id,
          name: pack.name || "Untitled Pack",
          cardCount,
          colors: MANA_ORDER.map((color) => ({
            color,
            count: colorCounts[color],
          })).filter((color) => color.count > 0),
        };
      })
      .filter((pack) => pack.cardCount > 0);

    return {
      manaValue,
      label: manaValue === 6 ? "6+" : String(manaValue),
      packSegments,
      cardCount: packSegments.reduce(
        (total, pack) => total + pack.cardCount,
        0,
      ),
    };
  });
}

function getCubeTagChart(packs) {
  const tagCounts = new Map();

  packs.forEach((pack) => {
    normalizePackTags(pack.archetypeTags).forEach((tag) => {
      const currentTag = tagCounts.get(tag.normalizedName);

      tagCounts.set(tag.normalizedName, {
        ...tag,
        count: (currentTag?.count || 0) + 1,
      });
    });
  });

  const rankedTags = [...tagCounts.values()].sort(
    (tagA, tagB) =>
      tagB.count - tagA.count || tagA.name.localeCompare(tagB.name),
  );
  const visibleTags = rankedTags.slice(0, CUBE_TAG_CHART_LIMIT).map((tag) => ({
    ...tag,
    colorValue: getPackTagColor(tag.color).value,
  }));
  const otherCount = rankedTags
    .slice(CUBE_TAG_CHART_LIMIT)
    .reduce((total, tag) => total + tag.count, 0);
  const chartTags =
    otherCount > 0
      ? [
          ...visibleTags,
          {
            normalizedName: "other",
            name: "Other",
            count: otherCount,
            colorValue: CUBE_OTHER_TAG_COLOR,
          },
        ]
      : visibleTags;
  const totalCount = chartTags.reduce((total, tag) => total + tag.count, 0);
  let currentOffset = 0;
  const segments = chartTags.map((tag) => {
    const percentage = totalCount === 0 ? 0 : (tag.count / totalCount) * 100;
    const start = currentOffset;
    const end = start + percentage;

    currentOffset = end;
    return { ...tag, percentage, start, end };
  });

  return {
    totalCount,
    segments,
    background:
      totalCount === 0
        ? "#252525"
        : `conic-gradient(${segments
            .map(
              (segment) =>
                `${segment.colorValue} ${segment.start}% ${segment.end}%`,
            )
            .join(", ")})`,
  };
}

export default function JumpCubeBox({
  cubeName,
  setCubeName,
  cubeDescription,
  setCubeDescription,
  cubeVisibility = "private",
  setCubeVisibility,
  selectedPacks,
  onOpenCubes,
  onOpenPack,
  removePackFromCube,
  movePackInCube,
  newCube,
  savedCubeId,
  onShareCube,
  saveStatus,
  saveErrorMessage = "",
  isOpen,
  setIsOpen,
  isAuthenticated = false,
  onAuthRequired,
}) {
  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [confirmingDeleteCube, setConfirmingDeleteCube] = useState(false);
  const [pendingRemovePackId, setPendingRemovePackId] = useState(null);
  const [showCubeStats, setShowCubeStats] = useState(false);
  const [visibilityMessage, setVisibilityMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const visibilityMessageTimeoutRef = useRef(null);
  const shareMessageTimeoutRef = useRef(null);
  const mobilePackGestureRef = useRef(null);
  const mobilePackReorderTimerRef = useRef(null);
  const mobilePackRemoveTimerRef = useRef(null);
  const suppressPackClickRef = useRef(false);
  const [mobilePackGestureState, setMobilePackGestureState] = useState({
    packId: null,
    offsetX: 0,
    removing: false,
    reordering: false,
  });
  const cubeNameModerationMessage = getContentModerationMessage(cubeName);
  const cubeDescriptionModerationMessage =
    getContentModerationMessage(cubeDescription);

  function toggleCubeVisibility() {
    if (!requireAuth()) return;

    const nextVisibility = cubeVisibility === "public" ? "private" : "public";

    setCubeVisibility(nextVisibility);
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
    return () => {
      if (visibilityMessageTimeoutRef.current) {
        window.clearTimeout(visibilityMessageTimeoutRef.current);
      }

      if (shareMessageTimeoutRef.current) {
        window.clearTimeout(shareMessageTimeoutRef.current);
      }
    };
  }, []);

  async function shareCurrentCube() {
    if (!savedCubeId || cubeVisibility !== "public") return;

    const copied = await onShareCube?.(savedCubeId);
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
    // Pack removal is a two-step right-click flow: first right-click arms the
    // item, second right-click removes it. Left/click elsewhere cancels.
    if (!pendingRemovePackId) return undefined;

    function cancelPendingRemove(event) {
      const packItem = event.target.closest(".cubePackItem");

      if (packItem?.dataset.packId === pendingRemovePackId) return;

      setPendingRemovePackId(null);
    }

    window.addEventListener("click", cancelPendingRemove);

    return () => {
      window.removeEventListener("click", cancelPendingRemove);
    };
  }, [pendingRemovePackId]);

  useEffect(() => {
    // Cube delete confirmation behaves like pack delete: any outside click
    // cancels the pending action.
    if (!confirmingDeleteCube) return undefined;

    function cancelDeleteConfirmation(event) {
      if (
        event.target.closest(".confirmDeleteCubeButton") ||
        event.target.closest(".deleteCubeButton")
      ) {
        return;
      }

      setConfirmingDeleteCube(false);
    }

    window.addEventListener("click", cancelDeleteConfirmation);

    return () => {
      window.removeEventListener("click", cancelDeleteConfirmation);
    };
  }, [confirmingDeleteCube]);

  function clearMobilePackTimers() {
    window.clearTimeout(mobilePackReorderTimerRef.current);
    window.clearTimeout(mobilePackRemoveTimerRef.current);
    mobilePackReorderTimerRef.current = null;
    mobilePackRemoveTimerRef.current = null;
  }

  function resetMobilePackGesture() {
    clearMobilePackTimers();
    mobilePackGestureRef.current = null;
    setMobilePackGestureState({ packId: null, offsetX: 0, removing: false, reordering: false });
  }

  function handleMobilePackPointerDown(event, pack) {
    if (!window.matchMedia("(max-width: 760px)").matches || event.pointerType === "mouse") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    clearMobilePackTimers();
    mobilePackGestureRef.current = {
      packId: String(pack.id), pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, lastY: event.clientY,
      offsetX: 0, targetPackId: String(pack.id), removing: false,
      removeArmed: false, reordering: false,
    };
    mobilePackReorderTimerRef.current = window.setTimeout(() => {
      const gesture = mobilePackGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gesture.reordering = true;
      suppressPackClickRef.current = true;
      setMobilePackGestureState({ packId: gesture.packId, offsetX: 0, removing: false, reordering: true });
    }, MOBILE_PACK_REORDER_HOLD_MS);
  }

  function updateMobilePackRemoval(gesture) {
    if (gesture.offsetX >= MOBILE_PACK_REMOVE_THRESHOLD && !gesture.removing) {
      gesture.removing = true;
      mobilePackRemoveTimerRef.current = window.setTimeout(() => {
        const active = mobilePackGestureRef.current;
        if (active?.offsetX >= MOBILE_PACK_REMOVE_THRESHOLD) active.removeArmed = true;
      }, MOBILE_PACK_REMOVE_HOLD_MS);
    } else if (gesture.offsetX < MOBILE_PACK_REMOVE_CANCEL_THRESHOLD && gesture.removing) {
      gesture.removing = false;
      gesture.removeArmed = false;
      window.clearTimeout(mobilePackRemoveTimerRef.current);
    }
    setMobilePackGestureState({
      packId: gesture.packId, offsetX: gesture.offsetX,
      removing: gesture.removing, reordering: false,
    });
  }

  function handleMobilePackPointerMove(event) {
    const gesture = mobilePackGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    if (gesture.reordering) {
      event.preventDefault();
      const target = [...document.querySelectorAll(".cubePackItem")]
        .filter((item) => item.dataset.packId !== gesture.packId)
        .map((item) => ({
          id: item.dataset.packId,
          distance: Math.abs(event.clientY - (item.getBoundingClientRect().top + item.offsetHeight / 2)),
        }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (target?.id) gesture.targetPackId = target.id;
      setMobilePackGestureState({
        packId: gesture.packId, offsetX: 0, offsetY: event.clientY - gesture.startY,
        targetPackId: gesture.targetPackId, removing: false, reordering: true,
      });
      return;
    }

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (Math.abs(deltaY) > MOBILE_PACK_GESTURE_TOLERANCE && Math.abs(deltaY) > Math.abs(deltaX)) {
      clearMobilePackTimers();
      event.preventDefault();
      suppressPackClickRef.current = true;
      const scrollArea = event.currentTarget.closest(".cubePackScrollArea");
      if (scrollArea) scrollArea.scrollTop += gesture.lastY - event.clientY;
      gesture.lastY = event.clientY;
      return;
    }

    if (Math.abs(deltaX) > MOBILE_PACK_GESTURE_TOLERANCE) {
      window.clearTimeout(mobilePackReorderTimerRef.current);
    }
    gesture.offsetX = Math.min(MOBILE_PACK_REMOVE_MAX_DISTANCE, Math.max(0, deltaX));
    updateMobilePackRemoval(gesture);
  }

  function handleMobilePackPointerEnd(event) {
    const gesture = mobilePackGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    suppressPackClickRef.current = gesture.reordering || gesture.offsetX > 6;

    if (gesture.reordering && gesture.targetPackId !== gesture.packId) {
      movePackInCube?.(gesture.packId, gesture.targetPackId);
    } else if (
      gesture.removeArmed &&
      gesture.offsetX >= MOBILE_PACK_REMOVE_THRESHOLD
    ) {
      removePackFromCube(gesture.packId);
    }

    resetMobilePackGesture();
  }

  function handleMobilePackPointerCancel(event) {
    if (mobilePackGestureRef.current?.pointerId !== event.pointerId) return;

    suppressPackClickRef.current = true;
    resetMobilePackGesture();
  }

  function requireAuth() {
    if (isAuthenticated) return true;

    onAuthRequired?.();
    return false;
  }

  function deleteConfirmedCube() {
    if (!requireAuth()) return;

    newCube();
    setConfirmingDeleteCube(false);
  }

  function getPackColorIdentity(pack) {
    // Loaded cubes and live-added packs use slightly different property names;
    // cards fallback keeps older summaries displayable.
    const colors =
      pack.colorIdentity ||
      pack.color_identity ||
      pack.cards?.flatMap((card) => card.color_identity || []) ||
      [];

    return [...new Set(colors)].sort();
  }

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

  function getPackColorColumnId(pack) {
    // Used only by cube stats view columns.
    const colors = getPackColorIdentity(pack);

    if (colors.length === 0) return "C";
    if (colors.length > 1) return "M";

    return colors[0];
  }

  const colorIdentityColumns = CUBE_COLOR_COLUMNS.map((column) => ({
    ...column,
    packs: selectedPacks.filter(
      (pack) => getPackColorColumnId(pack) === column.id,
    ),
  }));
  const largestColorColumn = Math.max(
    1,
    ...colorIdentityColumns.map((column) => column.packs.length),
  );
  const cubeManaCurveColumns = getCubeManaCurveColumns(selectedPacks);
  const largestCubeManaCurveCount = Math.max(
    1,
    ...cubeManaCurveColumns.map((column) => column.cardCount),
  );
  const cubeManaCurveLevels = Array.from(
    { length: Math.min(largestCubeManaCurveCount, 6) },
    (_, index) =>
      Math.round(
        (largestCubeManaCurveCount * (index + 1)) /
          Math.min(largestCubeManaCurveCount, 6),
      ),
  ).filter((level, index, levels) => index === 0 || level !== levels[index - 1]);
  const cubeTagChart = getCubeTagChart(selectedPacks);

  function handlePackContextMenu(event, packId) {
    // Right-click/touch context menu removal flow.
    event.preventDefault();

    if (!requireAuth()) return;

    if (pendingRemovePackId === packId) {
      removePackFromCube(packId);
      setPendingRemovePackId(null);
      return;
    }

    setPendingRemovePackId(packId);
  }

  function handlePackClick(pack) {
    if (suppressPackClickRef.current) {
      suppressPackClickRef.current = false;
      return;
    }

    // Left click opens the saved pack in PackBox.
    const packId = pack.savedPackId || pack.id;

    if (!packId) return;
    if (!requireAuth()) return;

    setPendingRemovePackId(null);
    onOpenPack(packId);
  }

  return (
    <aside
      className={`jumpCubeBox ${isOpen ? "open" : "closed"} ${
        showCubeStats ? "statsOpen" : ""
      }`}
    >
      <button
        className="jumpCubeToggle"
        onClick={() => {
          setShowCubeStats(false);
          setIsOpen((prev) => !prev);
        }}
        title={isOpen ? "Hide cube" : "Show cube"}
        aria-label={isOpen ? "Hide cube" : "Show cube"}
        aria-expanded={isOpen}
      >
        {isOpen ? "<" : ">"}
      </button>

      {editingName ? (
        <input
          className="cubeNameInput"
          value={cubeName}
          aria-invalid={Boolean(cubeNameModerationMessage)}
          maxLength={TITLE_MAX_LENGTH}
          autoFocus
          onChange={(e) =>
            setCubeName(sanitizeTitleInput(e.target.value))
          }
          onBlur={() => {
            if (!cubeNameModerationMessage) setEditingName(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") setEditingName(false);
          }}
        />
      ) : (
        <h2
          className="cubeTitle"
          onClick={() => {
            if (!requireAuth()) return;
            setEditingName(true);
          }}
        >
          {cubeName}
        </h2>
      )}
      {cubeNameModerationMessage && (
        <p className="contentModerationMessage" role="alert">
          {cubeNameModerationMessage}
        </p>
      )}

      {editingDescription ? (
        <textarea
          className="cubeDescriptionInput"
          value={cubeDescription}
          aria-invalid={Boolean(cubeDescriptionModerationMessage)}
          maxLength={DESCRIPTION_MAX_LENGTH}
          placeholder="Click to add a cube description..."
          autoFocus
          onChange={(e) =>
            setCubeDescription(sanitizeDescriptionInput(e.target.value))
          }
          onBlur={() => {
            if (!cubeDescriptionModerationMessage) setEditingDescription(false);
          }}
        />
      ) : (
        <p
          className="cubeDescription"
          onClick={() => {
            if (!requireAuth()) return;
            setEditingDescription(true);
          }}
          title="Click to edit description"
        >
          {cubeDescription || (
            <span className="placeholderText">
              Click to add a cube description...
            </span>
          )}
        </p>
      )}
      {cubeDescriptionModerationMessage && (
        <p className="contentModerationMessage" role="alert">
          {cubeDescriptionModerationMessage}
        </p>
      )}

      <p className="cubeCount">{selectedPacks.length} packs selected</p>

      <div className="cubeVisibilityToggle" aria-label="Cube visibility">
        <span>Visibility</span>
        <button
          type="button"
          className={cubeVisibility === "public" ? "public" : "private"}
          onClick={toggleCubeVisibility}
          aria-pressed={cubeVisibility === "public"}
        >
          {cubeVisibility === "public" ? "Public" : "Private"}
        </button>
      </div>

      <div className="cubeActionToolbar" aria-label="Cube actions">
        <button
          className={`cubeVisibilitySwitch ${cubeVisibility}`}
          type="button"
          onClick={toggleCubeVisibility}
          aria-label={`Cube visibility: ${
            cubeVisibility === "public" ? "Public" : "Private"
          }`}
          aria-pressed={cubeVisibility === "public"}
          title={
            cubeVisibility === "public"
              ? "Cube is public"
              : "Cube is private"
          }
        >
          <span aria-hidden="true" />
        </button>

        <button
          className="cubeActionButton openCubesButton"
          type="button"
          onClick={() => {
            if (!requireAuth()) return;

            setConfirmingDeleteCube(false);
            onOpenCubes();
          }}
          title="Open my cubes"
          aria-label="Open my cubes"
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
          className="cubeActionButton newCubeButton"
          type="button"
          onClick={() => {
            if (!requireAuth()) return;

            setConfirmingDeleteCube(false);
            newCube();
          }}
          title="New cube"
          aria-label="New cube"
        >
          <span aria-hidden="true">+</span>
        </button>

        <button
          className="cubeActionButton deleteCubeButton"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (!requireAuth()) return;

            setConfirmingDeleteCube((current) => !current);
          }}
          disabled={selectedPacks.length === 0 && !cubeDescription.trim()}
          title="Clear cube"
          aria-label="Clear cube"
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
          <span aria-hidden="true">×</span>
        </button>

        <button
          className="cubeActionButton cubeStatsButton"
          type="button"
          onClick={() => {
            if (!requireAuth()) return;

            setConfirmingDeleteCube(false);
            setShowCubeStats(true);
          }}
          disabled={selectedPacks.length === 0}
          title="Show cube statistics"
          aria-label="Show cube statistics"
        >
          <span aria-hidden="true">%</span>
        </button>

        <button
          className="cubeActionButton shareCubeButton"
          type="button"
          onClick={() => {
            setConfirmingDeleteCube(false);
            shareCurrentCube();
          }}
          disabled={!savedCubeId || cubeVisibility !== "public"}
          title={
            savedCubeId && cubeVisibility === "public"
              ? "Copy public cube link"
              : "Save this cube as public before sharing"
          }
          aria-label={
            savedCubeId && cubeVisibility === "public"
              ? "Copy public cube link"
              : "Save this cube as public before sharing"
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

      {confirmingDeleteCube && (
        <button
          className="confirmDeleteCubeButton"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            deleteConfirmedCube();
          }}
          aria-label={`Confirm clear ${cubeName}`}
        >
          Clear {cubeName}
        </button>
      )}

      {saveStatus === "saving" && <p className="saveMessage">Saving...</p>}

      {saveStatus === "saved" && (
        <p className="saveMessage success">Cube saved ✓</p>
      )}

      {saveStatus === "error" && (
        <p className="saveMessage error">
          {saveErrorMessage || "Save failed"}
        </p>
      )}

      {showCubeStats && (
        <div className="cubeStatsOverlay" role="dialog" aria-modal="true">
          <div className="cubeStatsHeader">
            <div>
              <h2>{cubeName}</h2>
              <p>{selectedPacks.length} packs selected</p>
            </div>

            <button
              className="cubeStatsCloseButton"
              type="button"
              onClick={() => setShowCubeStats(false)}
              aria-label="Close cube statistics"
              title="Close cube statistics"
            >
              x
            </button>
          </div>

          <div className="cubeStatsVisuals">
            <section
              className="cubeManaCurve"
              aria-label="Cube mana curve by pack and color"
            >
              <div className="cubeManaCurveHeading">
                <div>
                  <h3>Mana Curve</h3>
                  <p>Card colors stacked by pack</p>
                </div>

                <div
                  className="cubeManaCurveLegend"
                  aria-label="Card color legend"
                >
                  {MANA_ORDER.map((color) => (
                    <span key={color}>
                      <i style={{ "--mana-color": MANA_COLORS[color] }} />
                      {MANA_LABELS[color]}
                    </span>
                  ))}
                </div>
              </div>

              <div className="cubeManaCurveChart">
                <div className="cubeManaCurveGrid" aria-hidden="true">
                  {cubeManaCurveLevels.map((level) => (
                    <div
                      className="cubeManaCurveGridLine"
                      key={level}
                      style={{
                        bottom: `${(level / largestCubeManaCurveCount) * 100}%`,
                      }}
                    >
                      <span>{level}</span>
                    </div>
                  ))}
                </div>

                {cubeManaCurveColumns.map((column) => (
                  <div className="cubeManaCurveColumn" key={column.manaValue}>
                    <span className="cubeManaCurveCount">
                      {column.cardCount}
                    </span>
                    <div className="cubeManaCurveTrack">
                      <div
                        className="cubeManaCurveBar"
                        style={{
                          height:
                            column.cardCount === 0
                              ? "0%"
                              : `${(column.cardCount / largestCubeManaCurveCount) * 100}%`,
                        }}
                      >
                        {column.packSegments.map((pack, packIndex) => (
                          <div
                            className={`cubeManaCurvePack ${
                              packIndex > 0 ? "separated" : ""
                            }`}
                            key={pack.id}
                            style={{ flexGrow: pack.cardCount }}
                            tabIndex={0}
                          >
                            {pack.colors.map((color) => (
                              <span
                                className="cubeManaCurveColor"
                                key={color.color}
                                style={{
                                  "--mana-color": MANA_COLORS[color.color],
                                  flexGrow: color.count,
                                }}
                              />
                            ))}
                            <span
                              className="cubeManaCurveTooltip"
                              role="tooltip"
                            >
                              <strong>{pack.name}</strong>
                              <small>
                                {pack.cardCount}{" "}
                                {pack.cardCount === 1 ? "card" : "cards"} at{" "}
                                {column.label} mana
                              </small>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <strong className="cubeManaCurveLabel">
                      {column.label}
                    </strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="cubeTagChart" aria-label="Most common pack tags">
              <div
                className="cubeTagPie"
                style={{ "--tag-chart": cubeTagChart.background }}
                role="img"
                aria-label={`${cubeTagChart.totalCount} tag assignments across included packs`}
              />

              <div className="cubeTagChartDetails">
                <div>
                  <h3>Pack Tags</h3>
                  <p>Top tags across this cube</p>
                </div>

                {cubeTagChart.segments.length === 0 ? (
                  <p className="cubeTagChartEmpty">No tags assigned</p>
                ) : (
                  <div className="cubeTagLegend">
                    {cubeTagChart.segments.map((tag) => (
                      <div className="cubeTagLegendItem" key={tag.normalizedName}>
                        <span
                          className="cubeTagSwatch"
                          style={{ "--tag-color": tag.colorValue }}
                        />
                        <span className="cubeTagCount">{tag.count}</span>
                        <span className="cubeTagName">{tag.name}</span>
                        <strong>{Math.round(tag.percentage)}%</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="cubeStatsColumns" aria-label="Packs by color identity">
            {colorIdentityColumns.map((column) => (
              <section className="cubeStatsColumn" key={column.id}>
                <header className="cubeStatsColumnHeader">
                  <span>{column.label}</span>
                  <strong>{column.packs.length}</strong>
                </header>

                <div className="cubeStatsStack">
                  {column.packs.length === 0 ? (
                    <p className="cubeStatsEmpty">No packs</p>
                  ) : (
                    column.packs.map((pack) => (
                      <button
                        className="cubeStatsPack"
                        type="button"
                        key={pack.id}
                        onClick={() => {
                          setShowCubeStats(false);
                          handlePackClick(pack);
                        }}
                      >
                        {getPackManaBackdrop(pack)}
                        <span className="cubeStatsPackName">{pack.name}</span>
                      </button>
                    ))
                  )}
                </div>

                <dl className="cubeStatsData">
                  <div>
                    <dt>Packs</dt>
                    <dd>{column.packs.length}</dd>
                  </div>
                  <div>
                    <dt>Share</dt>
                    <dd>
                      {selectedPacks.length === 0
                        ? "0%"
                        : `${Math.round(
                            (column.packs.length / selectedPacks.length) * 100,
                          )}%`}
                    </dd>
                  </div>
                  <div>
                    <dt>Curve</dt>
                    <dd>
                      {Math.round(
                        (column.packs.length / largestColorColumn) * 100,
                      )}
                      %
                    </dd>
                  </div>
                </dl>
              </section>
            ))}
          </div>
        </div>
      )}

      <div className="cubePackScrollArea">
        {selectedPacks.length === 0 ? (
          <p className="emptyCube">Add packs to build your Jump Cube.</p>
        ) : (
          <div className="cubePackList">
            {selectedPacks.map((pack) => (
              <button
                type="button"
                className={`cubePackItem ${
                  pendingRemovePackId === pack.id ? "pendingRemove" : ""
                }${
                  mobilePackGestureState.packId === String(pack.id) &&
                  mobilePackGestureState.removing
                    ? " mobileRemoving"
                    : ""
                }${
                  mobilePackGestureState.packId === String(pack.id) &&
                  mobilePackGestureState.reordering
                    ? " mobileReordering"
                    : ""
                }${
                  mobilePackGestureState.targetPackId === String(pack.id)
                    ? " mobileReorderTarget"
                    : ""
                }`}
                data-pack-id={pack.id}
                key={pack.id}
                style={
                  mobilePackGestureState.packId === String(pack.id)
                    ? {
                        "--cube-pack-remove-offset": `${mobilePackGestureState.offsetX || 0}px`,
                        "--cube-pack-reorder-offset": `${mobilePackGestureState.offsetY || 0}px`,
                      }
                    : undefined
                }
                onClick={() => handlePackClick(pack)}
                onContextMenu={(event) =>
                  handlePackContextMenu(event, pack.id)
                }
                title={
                  pendingRemovePackId === pack.id
                    ? `Right-click again to remove ${pack.name}`
                    : pack.name
                }
              >
                {getPackManaBackdrop(pack)}
                <span className="cubePackName">{pack.name}</span>
                <span className="cubePackPips" aria-label="Color identity">
                  {getPackColorIdentity(pack).length === 0 ? (
                    <i
                      className="ms ms-c cubeManaSymbol cubeManaSymbolC"
                      title="Colorless"
                    />
                  ) : (
                    getPackColorIdentity(pack).map((color) => (
                      <i
                        className={`ms ${getManaClass(color)} cubeManaSymbol cubeManaSymbol${color}`}
                        key={color}
                        title={color}
                      />
                    ))
                  )}
                </span>
                <span
                  className="cubePackGestureLayer"
                  aria-hidden="true"
                  onPointerDown={(event) =>
                    handleMobilePackPointerDown(event, pack)
                  }
                  onPointerMove={handleMobilePackPointerMove}
                  onPointerUp={handleMobilePackPointerEnd}
                  onPointerCancel={handleMobilePackPointerCancel}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
