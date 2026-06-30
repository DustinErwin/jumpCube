import { useEffect, useRef, useState } from "react";
import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  sanitizeDescriptionInput,
  sanitizeTitleInput,
} from "../../utils/userText";
import { getContentModerationMessage } from "../../utils/contentModeration";
import { normalizePackTags } from "../../utils/packTags";
import {
  getPrimaryCardMechanicBucket,
  PACK_MECHANIC_BUCKETS,
} from "../../utils/cardMechanics";
import {
  normalizeColorIdentity,
  normalizeColorPercentages,
  normalizeStoredPackCubeStats,
} from "../../utils/packCubeStats";
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
const CUBE_TAG_CHART_COLORS = [
  "#4e9bd8",
  "#df6b63",
  "#6fba74",
  "#d7ae4d",
  "#9a73cc",
  "#4fb8ad",
  "#8a929c",
];
const CUBE_CARD_TYPES = [
  { id: "Creature", label: "Creatures", color: "#65a765" },
  { id: "Land", label: "Lands", color: "#b68a58" },
  { id: "Instant", label: "Instants", color: "#5d95d6" },
  { id: "Sorcery", label: "Sorceries", color: "#d6b85d" },
  { id: "Artifact", label: "Artifacts", color: "#9aa3ad" },
  { id: "Enchantment", label: "Enchantments", color: "#b084d6" },
  { id: "Planeswalker", label: "Planeswalkers", color: "#d16b6b" },
  { id: "Battle", label: "Battles", color: "#58a9a5" },
  { id: "Other", label: "Other", color: "#6f7782" },
];
const MOBILE_PACK_REORDER_HOLD_MS = 400;
const MOBILE_PACK_REMOVE_HOLD_MS = 450;
const MOBILE_PACK_REMOVE_THRESHOLD = 88;
const MOBILE_PACK_REMOVE_CANCEL_THRESHOLD = 56;
const MOBILE_PACK_REMOVE_MAX_DISTANCE = 124;
const MOBILE_PACK_GESTURE_TOLERANCE = 8;
const DEFAULT_CUBE_ACTION_HINT = "";

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

function getPackCubeStats(pack) {
  const stats =
    normalizeStoredPackCubeStats(pack?.cubeStats) ||
    normalizeStoredPackCubeStats(pack?.cube_stats) ||
    pack?.cubeStats ||
    pack?.cube_stats;

  return stats && Object.keys(stats).length > 0 ? stats : null;
}

function getZeroManaCounts(includeColorless = true) {
  return MANA_ORDER.filter((color) => includeColorless || color !== "C").reduce(
    (counts, color) => ({ ...counts, [color]: 0 }),
    {},
  );
}

function getPackColorPercentages(pack) {
  const stats = getPackCubeStats(pack);
  const candidates = [
    normalizeColorPercentages(stats?.colorPercentages),
    normalizeColorPercentages(pack?.colorPercentages),
    normalizeColorPercentages(pack?.color_percentages),
  ];

  return candidates.find(Boolean) || null;
}

function getPackManaPipSegments(pack) {
  /*
   * Converts all card mana pips in a pack into percentage segments.
   * Segments are sorted ascending by count so the largest color lands on the
   * right side after CSS positioning.
   */
  const stats = getPackCubeStats(pack);
  const totals = stats?.allPipCounts
    ? { ...getZeroManaCounts(), ...stats.allPipCounts }
    : getZeroManaCounts();

  if (!stats?.allPipCounts) {
    const percentages = getPackColorPercentages(pack);

    if (percentages) {
      MANA_ORDER.forEach((color) => {
        totals[color] = Number(percentages[color]) || 0;
      });
    }
  }

  if (!stats?.allPipCounts && !getPackColorPercentages(pack)) {
    (pack.cards || []).forEach((card) => {
      const cardPips = getCardManaPips(card);
      const quantity = card.quantity || 1;

      MANA_ORDER.forEach((color) => {
        totals[color] += cardPips[color] * quantity;
      });
    });
  }

  if (MANA_ORDER.reduce((sum, color) => sum + totals[color], 0) === 0) {
    const identityColors = [
      normalizeColorIdentity(pack?.colorIdentity),
      normalizeColorIdentity(pack?.color_identity),
      normalizeColorIdentity(stats?.colorIdentity),
    ].find((candidate) => candidate.length > 0);

    (identityColors || []).forEach((color) => {
      if (Object.prototype.hasOwnProperty.call(totals, color)) {
        totals[color] = 1;
      }
    });
  }

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
        const stats = getPackCubeStats(pack);
        const cachedCurveBucket = stats?.manaCurve?.[manaValue];
        const colorCounts = cachedCurveBucket?.colorCounts
          ? { ...getZeroManaCounts(), ...cachedCurveBucket.colorCounts }
          : getZeroManaCounts();
        let cardCount = 0;

        if (cachedCurveBucket) {
          cardCount = Number(cachedCurveBucket.cardCount) || 0;
        } else {
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
        }

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
  const visibleTags = rankedTags
    .slice(0, CUBE_TAG_CHART_LIMIT)
    .map((tag, index) => ({
      ...tag,
      colorValue: CUBE_TAG_CHART_COLORS[index],
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
            colorValue: CUBE_TAG_CHART_COLORS[CUBE_TAG_CHART_LIMIT],
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

function getPackColoredManaPips(pack) {
  const stats = getPackCubeStats(pack);
  const totals = stats?.colorPipCounts
    ? { ...getZeroManaCounts(false), ...stats.colorPipCounts }
    : getZeroManaCounts(false);

  if (!stats?.colorPipCounts) {
    const percentages = getPackColorPercentages(pack);

    if (percentages) {
      Object.keys(totals).forEach((color) => {
        totals[color] = Number(percentages[color]) || 0;
      });
      return totals;
    }

    (pack.cards || []).forEach((card) => {
      const cardPips = getCardManaPips(card);
      const quantity = Number(card.quantity) || 1;

      Object.keys(totals).forEach((color) => {
        totals[color] += cardPips[color] * quantity;
      });
    });

  }

  if (Object.values(totals).every((count) => count <= 0)) {
    const identityColors = [
      normalizeColorIdentity(pack?.colorIdentity),
      normalizeColorIdentity(pack?.color_identity),
      normalizeColorIdentity(stats?.colorIdentity),
    ].find((candidate) => candidate.length > 0);

    (identityColors || []).forEach((color) => {
      if (Object.prototype.hasOwnProperty.call(totals, color)) {
        totals[color] = 1;
      }
    });
  }

  return totals;
}

function getPrimaryCubeCardType(card) {
  const typeLine = card.type_line || "";

  return (
    CUBE_CARD_TYPES.find(
      (type) =>
        type.id !== "Other" &&
        new RegExp(`(^|[^A-Za-z])${type.id}([^A-Za-z]|$)`, "i").test(typeLine),
    ) || CUBE_CARD_TYPES[CUBE_CARD_TYPES.length - 1]
  );
}

function getCubeCardTypeChart(packs) {
  const counts = new Map(CUBE_CARD_TYPES.map((type) => [type.id, 0]));

  packs.forEach((pack) => {
    const stats = getPackCubeStats(pack);

    if (stats?.cardTypes) {
      CUBE_CARD_TYPES.forEach((type) => {
        counts.set(type.id, counts.get(type.id) + (Number(stats.cardTypes[type.id]) || 0));
      });
      return;
    }

    (pack.cards || []).forEach((card) => {
      const type = getPrimaryCubeCardType(card);
      const quantity = Number(card.quantity) || 1;

      counts.set(type.id, counts.get(type.id) + quantity);
    });
  });

  const totalCount = [...counts.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  let currentOffset = 0;
  const segments = CUBE_CARD_TYPES.map((type) => ({
    ...type,
    count: counts.get(type.id),
  }))
    .filter((type) => type.count > 0)
    .map((type) => {
      const percentage =
        totalCount === 0 ? 0 : (type.count / totalCount) * 100;
      const start = currentOffset;
      const end = start + percentage;

      currentOffset = end;

      return { ...type, percentage, start, end };
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
                `${segment.color} ${segment.start}% ${segment.end}%`,
            )
            .join(", ")})`,
  };
}

function getCubeCardFunctionChart(packs) {
  const counts = new Map(
    PACK_MECHANIC_BUCKETS.map((bucket) => [bucket.id, 0]),
  );

  packs.forEach((pack) => {
    const stats = getPackCubeStats(pack);

    if (stats?.cardFunctions) {
      PACK_MECHANIC_BUCKETS.forEach((bucket) => {
        counts.set(
          bucket.id,
          (counts.get(bucket.id) || 0) +
            (Number(stats.cardFunctions[bucket.id]) || 0),
        );
      });
      return;
    }

    (pack.cards || []).forEach((card) => {
      const bucket = getPrimaryCardMechanicBucket(card);

      if (!bucket) return;

      counts.set(
        bucket.id,
        (counts.get(bucket.id) || 0) + (Number(card.quantity) || 1),
      );
    });
  });

  const totalCount = [...counts.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  let currentOffset = 0;
  const segments = PACK_MECHANIC_BUCKETS.map((bucket) => ({
    ...bucket,
    count: counts.get(bucket.id) || 0,
  }))
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => {
      const percentage =
        totalCount === 0 ? 0 : (bucket.count / totalCount) * 100;
      const start = currentOffset;
      const end = start + percentage;

      currentOffset = end;

      return { ...bucket, percentage, start, end };
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
                `${segment.color} ${segment.start}% ${segment.end}%`,
            )
            .join(", ")})`,
  };
}

function getCubePrimaryPackColorChart(packs) {
  const counts = MANA_ORDER.filter((color) => color !== "C").reduce(
    (totals, color) => ({ ...totals, [color]: 0 }),
    {},
  );

  packs.forEach((pack) => {
    const pips = getPackColoredManaPips(pack);
    const highestPipCount = Math.max(...Object.values(pips));

    if (highestPipCount <= 0) return;

    Object.entries(pips).forEach(([color, count]) => {
      if (count === highestPipCount) {
        counts[color] += 1;
      }
    });
  });

  const totalCount = Object.values(counts).reduce(
    (sum, count) => sum + count,
    0,
  );
  let currentOffset = 0;
  const segments = MANA_ORDER.filter((color) => color !== "C")
    .map((color) => ({
      id: color,
      label: MANA_LABELS[color],
      color: MANA_COLORS[color],
      count: counts[color],
    }))
    .filter((segment) => segment.count > 0)
    .map((segment) => {
      const percentage =
        totalCount === 0 ? 0 : (segment.count / totalCount) * 100;
      const start = currentOffset;
      const end = start + percentage;

      currentOffset = end;

      return { ...segment, percentage, start, end };
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
                `${segment.color} ${segment.start}% ${segment.end}%`,
            )
            .join(", ")})`,
  };
}

function getLandSourceColors(card) {
  if (!/\bland\b/i.test(card.type_line || "")) return [];

  const typeLine = card.type_line || "";
  const oracleText = [
    card.oracle_text,
    ...(card.card_faces || []).map((face) => face.oracle_text),
  ]
    .filter(Boolean)
    .join(" ");
  const basicLandTypes = {
    W: "Plains",
    U: "Island",
    B: "Swamp",
    R: "Mountain",
    G: "Forest",
  };

  return MANA_ORDER.filter((color) => {
    if (color === "C") return false;

    return (
      new RegExp(`\\b${basicLandTypes[color]}\\b`, "i").test(typeLine) ||
      new RegExp(`add[^.\\n]*\\{${color}\\}`, "i").test(oracleText)
    );
  });
}

function getCubeColorSourceChart(packs) {
  const pips = Object.fromEntries(
    MANA_ORDER.filter((color) => color !== "C").map((color) => [color, 0]),
  );
  const sources = Object.fromEntries(
    MANA_ORDER.filter((color) => color !== "C").map((color) => [color, 0]),
  );

  packs.forEach((pack) => {
    const stats = getPackCubeStats(pack);

    if (stats?.colorSources) {
      Object.keys(pips).forEach((color) => {
        pips[color] += Number(stats.colorSources.pips?.[color]) || 0;
        sources[color] += Number(stats.colorSources.sources?.[color]) || 0;
      });
      return;
    }

    (pack.cards || []).forEach((card) => {
      const quantity = Number(card.quantity) || 1;

      if (/\bland\b/i.test(card.type_line || "")) {
        getLandSourceColors(card).forEach((color) => {
          sources[color] += quantity;
        });
        return;
      }

      const cardPips = getCardManaPips(card);

      Object.keys(pips).forEach((color) => {
        pips[color] += cardPips[color] * quantity;
      });
    });
  });

  const totalPips = Object.values(pips).reduce((sum, count) => sum + count, 0);
  const totalSources = Object.values(sources).reduce(
    (sum, count) => sum + count,
    0,
  );
  const rows = Object.keys(pips).map((color) => {
    const pipPercentage =
      totalPips === 0 ? 0 : (pips[color] / totalPips) * 100;
    const sourcePercentage =
      totalSources === 0 ? 0 : (sources[color] / totalSources) * 100;

    return {
      color,
      label: MANA_LABELS[color],
      colorValue: MANA_COLORS[color],
      pips: pips[color],
      sources: sources[color],
      differencePercentage: sourcePercentage - pipPercentage,
    };
  });
  const largestValue = Math.max(
    1,
    ...rows.flatMap((row) => [row.pips, row.sources]),
  );

  return { rows, largestValue };
}

export default function JumpCubeBox({
  cubeName,
  setCubeName,
  cubeDescription,
  setCubeDescription,
  cubeVisibility = "private",
  setCubeVisibility,
  isCubeActive = false,
  selectedPacks,
  onOpenCubes,
  onOpenPack,
  removePackFromCube,
  movePackInCube,
  newCube,
  savedCubeId,
  onShareCube,
  onSampleDraft,
  initialShowStats = false,
  onStatsClose,
  onStatsOpenChange,
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
  const [showCubeStats, setShowCubeStats] = useState(initialShowStats);
  const [filteredManaCurvePackId, setFilteredManaCurvePackId] = useState(null);
  const [visibilityMessage, setVisibilityMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [cubeActionHint, setCubeActionHint] = useState(DEFAULT_CUBE_ACTION_HINT);
  const visibilityMessageTimeoutRef = useRef(null);
  const shareMessageTimeoutRef = useRef(null);
  const pendingTouchActionRef = useRef(null);
  const blockedTouchClickRef = useRef(null);
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

  useEffect(() => {
    onStatsOpenChange?.(showCubeStats);

    return () => {
      onStatsOpenChange?.(false);
    };
  }, [onStatsOpenChange, showCubeStats]);

  function getCubeActionHintProps(hint, actionId = hint) {
    return {
      onMouseEnter: () => setCubeActionHint(hint),
      onFocus: () => setCubeActionHint(hint),
      onTouchStart: (event) => {
        setCubeActionHint(hint);

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
          setCubeActionHint(DEFAULT_CUBE_ACTION_HINT);
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
        setCubeActionHint(DEFAULT_CUBE_ACTION_HINT);
      },
    };
  }

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
    const stats = getPackCubeStats(pack);
    const colors = [
      normalizeColorIdentity(pack.colorIdentity),
      normalizeColorIdentity(pack.color_identity),
      normalizeColorIdentity(stats?.colorIdentity),
      normalizeColorIdentity(
        pack.cards?.flatMap((card) => card.color_identity || []),
      ),
    ].find((candidate) => candidate.length > 0) || [];

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

  const filteredManaCurvePack =
    selectedPacks.find(
      (pack) =>
        String(pack.savedPackId || pack.id) ===
        String(filteredManaCurvePackId),
    ) || null;
  const cubeManaCurvePacks = filteredManaCurvePack
    ? [filteredManaCurvePack]
    : selectedPacks;
  const cubeManaCurveColumns = getCubeManaCurveColumns(cubeManaCurvePacks);
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
  const cubeCardTypeChart = getCubeCardTypeChart(selectedPacks);
  const cubeCardFunctionChart = getCubeCardFunctionChart(selectedPacks);
  const cubePrimaryPackColorChart =
    getCubePrimaryPackColorChart(selectedPacks);
  const cubeColorSourceChart = getCubeColorSourceChart(selectedPacks);
  const draftablePackCount = selectedPacks.filter(
    (pack) =>
      (Number(getPackCubeStats(pack)?.cardCount) || Number(pack.cardCount) || 0) >
        0 || (pack.cards || []).length > 0,
  ).length;

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

      {!isCubeActive ? (
        <div className="cubeEmptyState">
          <h2>No active cube</h2>
          <p>Click the New Cube button to start a cube.</p>
        </div>
      ) : editingName ? (
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
          {cubeName || "Unnamed Cube"}
        </h2>
      )}
      {isCubeActive && cubeNameModerationMessage && (
        <p className="contentModerationMessage" role="alert">
          {cubeNameModerationMessage}
        </p>
      )}

      {isCubeActive && editingDescription ? (
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
      ) : isCubeActive ? (
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
      ) : null}
      {isCubeActive && cubeDescriptionModerationMessage && (
        <p className="contentModerationMessage" role="alert">
          {cubeDescriptionModerationMessage}
        </p>
      )}

      {isCubeActive && (
        <p className="cubeCount">{selectedPacks.length} packs selected</p>
      )}

      <div className="cubeVisibilityToggle" aria-label="Cube visibility">
        <span>Visibility</span>
        <button
          type="button"
          className={cubeVisibility === "public" ? "public" : "private"}
          onClick={toggleCubeVisibility}
          disabled={!isCubeActive}
          aria-pressed={cubeVisibility === "public"}
        >
          {cubeVisibility === "public" ? "Public" : "Private"}
        </button>
      </div>

      <p className="cubeActionHint" aria-live="polite" aria-label="Cube action hint">
        {cubeActionHint}
      </p>

      <div className="cubeActionToolbar" aria-label="Cube actions">
        <button
          className={`cubeVisibilitySwitch ${cubeVisibility}`}
          type="button"
          onClick={toggleCubeVisibility}
          disabled={!isCubeActive}
          {...getCubeActionHintProps("Set Cube Visibility (required to share)")}
          aria-label={`Cube visibility: ${
            cubeVisibility === "public" ? "Public" : "Private"
          }`}
          aria-pressed={cubeVisibility === "public"}
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
          {...getCubeActionHintProps("Open your saved cubes.")}
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
          {...getCubeActionHintProps("Start a new empty cube.")}
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
          disabled={
            !isCubeActive ||
            (selectedPacks.length === 0 && !cubeDescription.trim())
          }
          {...getCubeActionHintProps("Clear the current cube.")}
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
          disabled={!isCubeActive || selectedPacks.length === 0}
          {...getCubeActionHintProps("Show stats panel.")}
          aria-label="Show cube statistics"
        >
          <span aria-hidden="true">%</span>
        </button>

        <button
          className="cubeActionButton sampleDraftButton"
          type="button"
          onClick={() => {
            if (!requireAuth()) return;

            setConfirmingDeleteCube(false);
            onSampleDraft?.();
          }}
          disabled={!isCubeActive || draftablePackCount < 4}
          {...getCubeActionHintProps(
            draftablePackCount >= 4
              ? "Run a sample two-pack draft."
              : "Add at least four nonempty packs to sample draft.",
          )}
          aria-label="Run sample draft"
        >
          <svg
            aria-hidden="true"
            className="actionIcon"
            viewBox="0 0 24 24"
            focusable="false"
          >
            <path d="M4 5h8v11H4z" />
            <path d="M12 8h8v11h-8z" />
            <path className="actionIconInset" d="M7 8h2v5H7z" />
            <path className="actionIconInset" d="M15 11h2v5h-2z" />
          </svg>
        </button>

        <button
          className="cubeActionButton shareCubeButton"
          type="button"
          onClick={() => {
            setConfirmingDeleteCube(false);
            shareCurrentCube();
          }}
          disabled={!savedCubeId || cubeVisibility !== "public"}
          {...getCubeActionHintProps(
            savedCubeId && cubeVisibility === "public"
              ? "Copy a share link for this public cube."
              : "Save this cube as public before sharing.",
          )}
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

      {saveStatus === "saving" && <p className="saveMessage">Saving...</p>}

      {saveStatus === "saved" && (
        <p className="saveMessage success">Cube saved ✓</p>
      )}

      {saveStatus === "error" && (
        <p className="saveMessage error">
          {saveErrorMessage || "Save failed"}
        </p>
      )}

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
              onClick={() => {
                if (onStatsClose) {
                  onStatsClose();
                  return;
                }

                setShowCubeStats(false);
              }}
              aria-label="Close cube statistics"
              title="Close cube statistics"
            >
              x
            </button>
          </div>

          <div className="cubeStatsVisuals">
            <div className="cubeInlineCharts">
              <section
                className="cubeTagChart"
                aria-label="Most common pack tags"
              >
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

              <section
                className="cubeTagChart cubeCardTypeChart"
                aria-label="Card types across the cube"
              >
              <div
                className="cubeTagPie"
                style={{ "--tag-chart": cubeCardTypeChart.background }}
                role="img"
                aria-label={`${cubeCardTypeChart.totalCount} cards grouped by primary card type`}
              />

              <div className="cubeTagChartDetails">
                <div>
                  <h3>Card Types</h3>
                  <p>Primary type across all packs</p>
                </div>

                {cubeCardTypeChart.segments.length === 0 ? (
                  <p className="cubeTagChartEmpty">No cards available</p>
                ) : (
                  <div className="cubeTagLegend">
                    {cubeCardTypeChart.segments.map((type) => (
                      <div className="cubeTagLegendItem" key={type.id}>
                        <span
                          className="cubeTagSwatch"
                          style={{ "--tag-color": type.color }}
                        />
                        <span className="cubeTagCount">{type.count}</span>
                        <span className="cubeTagName">{type.label}</span>
                        <strong>{Math.round(type.percentage)}%</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </section>

              <section
                className="cubeTagChart cubeCardFunctionChart"
                aria-label="Card functions across the cube"
              >
              <div
                className="cubeTagPie"
                style={{ "--tag-chart": cubeCardFunctionChart.background }}
                role="img"
                aria-label={`${cubeCardFunctionChart.totalCount} cards grouped by primary function`}
              />

              <div className="cubeTagChartDetails">
                <div>
                  <h3>Card Functions</h3>
                  <p>Primary role across all packs</p>
                </div>

                {cubeCardFunctionChart.segments.length === 0 ? (
                  <p className="cubeTagChartEmpty">No cards available</p>
                ) : (
                  <div className="cubeTagLegend">
                    {cubeCardFunctionChart.segments.map((functionGroup) => (
                      <div
                        className="cubeTagLegendItem"
                        key={functionGroup.id}
                      >
                        <span
                          className="cubeTagSwatch"
                          style={{ "--tag-color": functionGroup.color }}
                        />
                        <span className="cubeTagCount">
                          {functionGroup.count}
                        </span>
                        <span className="cubeTagName">
                          {functionGroup.label}
                        </span>
                        <strong>
                          {Math.round(functionGroup.percentage)}%
                        </strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </section>

              <section
                className="cubeTagChart cubePrimaryColorChart"
                aria-label="Primary pack colors across the cube"
              >
              <div
                className="cubeTagPie"
                style={{ "--tag-chart": cubePrimaryPackColorChart.background }}
                role="img"
                aria-label={`${cubePrimaryPackColorChart.totalCount} primary pack color assignments`}
              />

              <div className="cubeTagChartDetails">
                <div>
                  <h3>Primary Colors</h3>
                  <p>Highest pip color per pack</p>
                </div>

                {cubePrimaryPackColorChart.segments.length === 0 ? (
                  <p className="cubeTagChartEmpty">No colored pips available</p>
                ) : (
                  <div className="cubeTagLegend">
                    {cubePrimaryPackColorChart.segments.map((color) => (
                      <div className="cubeTagLegendItem" key={color.id}>
                        <span
                          className="cubeTagSwatch"
                          style={{ "--tag-color": color.color }}
                        />
                        <span className="cubeTagCount">{color.count}</span>
                        <span className="cubeTagName">{color.label}</span>
                        <strong>{Math.round(color.percentage)}%</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </section>

              <section
                className="cubeColorSourceChart"
                aria-label="Colored mana requirements and land sources"
              >
              <div className="cubeColorSourceSummary">
                <div>
                  <h3>Color Sources</h3>
                  <p>Colored pips compared with land sources</p>
                </div>

                <div
                  className="cubeColorSourceDifferences"
                  aria-label="Source share minus colored pip share"
                >
                  {cubeColorSourceChart.rows.map((row) => {
                    const roundedDifference = Math.round(
                      row.differencePercentage,
                    );

                    return (
                      <span
                        className={
                          roundedDifference > 0
                            ? "positive"
                            : roundedDifference < 0
                              ? "negative"
                              : ""
                        }
                        key={row.color}
                        title={`${row.label}: source share minus pip share`}
                      >
                        <i
                          style={{ "--source-color": row.colorValue }}
                          aria-hidden="true"
                        />
                        <strong>
                          {roundedDifference > 0 ? "+" : ""}
                          {roundedDifference}%
                        </strong>
                        <small>{row.label}</small>
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="cubeColorSourcePlot">
                <div className="cubeColorSourceLegend">
                  <span>
                    <i className="pips" />
                    Pips
                  </span>
                  <span>
                    <i className="sources" />
                    Sources
                  </span>
                </div>

                <div className="cubeColorSourceRows">
                  {cubeColorSourceChart.rows.map((row) => (
                    <div className="cubeColorSourceRow" key={row.color}>
                      <span
                        className="cubeColorSourceSwatch"
                        style={{ "--source-color": row.colorValue }}
                        aria-hidden="true"
                      />
                      <strong>{row.label}</strong>

                      <div className="cubeColorSourceBars">
                        <div>
                          <span
                            className="cubeColorSourceBar pips"
                            style={{
                              width: `${(row.pips / cubeColorSourceChart.largestValue) * 100}%`,
                              "--source-color": row.colorValue,
                            }}
                          />
                          <small>{row.pips}</small>
                        </div>
                        <div>
                          <span
                            className="cubeColorSourceBar sources"
                            style={{
                              width: `${(row.sources / cubeColorSourceChart.largestValue) * 100}%`,
                              "--source-color": row.colorValue,
                            }}
                          />
                          <small>{row.sources}</small>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              </section>
            </div>

            <section
              className="cubeManaCurve"
              aria-label="Cube mana curve by pack and color"
            >
              <div className="cubeManaCurveHeading">
                <div>
                  <h3>Mana Curve</h3>
                  <p>
                    {filteredManaCurvePack
                      ? filteredManaCurvePack.name
                      : "Card colors stacked by pack"}
                  </p>
                </div>

                {filteredManaCurvePack && (
                  <button
                    type="button"
                    className="cubeManaCurveClearFilter"
                    onClick={() => setFilteredManaCurvePackId(null)}
                  >
                    Remove Filter
                  </button>
                )}

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
                            role="button"
                            aria-label={`Filter mana curve to ${pack.name}`}
                            onClick={() =>
                              setFilteredManaCurvePackId(pack.id)
                            }
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" ||
                                event.key === " "
                              ) {
                                event.preventDefault();
                                setFilteredManaCurvePackId(pack.id);
                              }
                            }}
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
          </div>
        </div>
      )}

      <div className="cubePackScrollArea">
        {selectedPacks.length === 0 ? (
          <p className="emptyCube">
            {isCubeActive
              ? "Add packs to build your Jump Cube."
              : "Create or open a cube to begin."}
          </p>
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
