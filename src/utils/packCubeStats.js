import {
  getPrimaryCardMechanicBucket,
  PACK_MECHANIC_BUCKETS,
} from "./cardMechanics";

export const PACK_STATS_MANA_ORDER = ["W", "U", "B", "R", "G", "C"];
export const PACK_STATS_COLORED_MANA_ORDER = ["W", "U", "B", "R", "G"];
export const PACK_STATS_CURVE_VALUES = [1, 2, 3, 4, 5, 6];
export const PACK_STATS_CARD_TYPES = [
  "Creature",
  "Land",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Planeswalker",
  "Battle",
  "Other",
];

export function normalizeColorIdentity(colors) {
  if (Array.isArray(colors)) {
    return [
      ...new Set(
        colors
          .map((color) => String(color).trim().toUpperCase())
          .filter((color) => PACK_STATS_COLORED_MANA_ORDER.includes(color)),
      ),
    ].sort();
  }

  if (typeof colors !== "string") return [];

  return [
    ...new Set(
      colors
        .replace(/[{}[\]"']/g, " ")
        .split(/[,\s]+/)
        .map((color) => color.trim().toUpperCase())
        .filter((color) => PACK_STATS_COLORED_MANA_ORDER.includes(color)),
    ),
  ].sort();
}

export function normalizeColorPercentages(percentages) {
  if (!percentages || typeof percentages !== "object") return null;

  const normalized = Object.fromEntries(
    PACK_STATS_COLORED_MANA_ORDER.map((color) => [
      color,
      Number(percentages[color]) || 0,
    ]),
  );

  return Object.values(normalized).some((value) => value > 0)
    ? normalized
    : null;
}

function getZeroCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function getManaCost(card) {
  return card?.mana_cost || "";
}

function getCardManaPips(card) {
  const pips = getZeroCounts(PACK_STATS_MANA_ORDER);
  const symbols = getManaCost(card).match(/\{[^}]+\}/g) || [];

  symbols.forEach((symbol) => {
    PACK_STATS_MANA_ORDER.forEach((color) => {
      if (symbol.includes(color)) {
        pips[color] += 1;
      }
    });
  });

  return pips;
}

function getCardCurveColors(card) {
  const cardColors = Array.isArray(card?.colors) ? card.colors : [];
  const recognizedColors = PACK_STATS_MANA_ORDER.filter((color) =>
    cardColors.includes(color),
  );

  return recognizedColors.length > 0 ? recognizedColors : ["C"];
}

function getPrimaryCardType(card) {
  const typeLine = card?.type_line || "";

  return (
    PACK_STATS_CARD_TYPES.find(
      (type) =>
        type !== "Other" &&
        new RegExp(`(^|[^A-Za-z])${type}([^A-Za-z]|$)`, "i").test(typeLine),
    ) || "Other"
  );
}

function getLandSourceColors(card) {
  if (!/\bland\b/i.test(card?.type_line || "")) return [];

  const typeLine = card?.type_line || "";
  const oracleText = [
    card?.oracle_text,
    ...(card?.card_faces || []).map((face) => face.oracle_text),
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

  return PACK_STATS_COLORED_MANA_ORDER.filter(
    (color) =>
      new RegExp(`\\b${basicLandTypes[color]}\\b`, "i").test(typeLine) ||
      new RegExp(`add[^.\\n]*\\{${color}\\}`, "i").test(oracleText),
  );
}

export function buildPackCubeStats(cards = []) {
  const colorIdentity = new Set();
  const colorPipCounts = getZeroCounts(PACK_STATS_COLORED_MANA_ORDER);
  const allPipCounts = getZeroCounts(PACK_STATS_MANA_ORDER);
  const cardTypes = getZeroCounts(PACK_STATS_CARD_TYPES);
  const cardFunctions = getZeroCounts(
    PACK_MECHANIC_BUCKETS.map((bucket) => bucket.id),
  );
  const colorSources = {
    pips: getZeroCounts(PACK_STATS_COLORED_MANA_ORDER),
    sources: getZeroCounts(PACK_STATS_COLORED_MANA_ORDER),
  };
  const manaCurve = Object.fromEntries(
    PACK_STATS_CURVE_VALUES.map((manaValue) => [
      manaValue,
      {
        cardCount: 0,
        colorCounts: getZeroCounts(PACK_STATS_MANA_ORDER),
      },
    ]),
  );
  let cardCount = 0;

  cards.forEach((card) => {
    const quantity = Number(card?.quantity) || 1;
    const cardPips = getCardManaPips(card);
    const cardManaValue = Number(card?.mana_value || 0);
    const curveBucket = cardManaValue >= 6 ? 6 : Math.max(0, cardManaValue);
    const type = getPrimaryCardType(card);
    const bucket = getPrimaryCardMechanicBucket(card);

    cardCount += quantity;
    normalizeColorIdentity(card?.color_identity).forEach((color) => {
      colorIdentity.add(color);
    });

    PACK_STATS_MANA_ORDER.forEach((color) => {
      allPipCounts[color] += cardPips[color] * quantity;
    });
    PACK_STATS_COLORED_MANA_ORDER.forEach((color) => {
      colorPipCounts[color] += cardPips[color] * quantity;
    });

    cardTypes[type] += quantity;
    if (bucket?.id && Object.prototype.hasOwnProperty.call(cardFunctions, bucket.id)) {
      cardFunctions[bucket.id] += quantity;
    }

    if (PACK_STATS_CURVE_VALUES.includes(curveBucket)) {
      const curveColors = getCardCurveColors(card);
      const colorShare = quantity / curveColors.length;

      manaCurve[curveBucket].cardCount += quantity;
      curveColors.forEach((color) => {
        manaCurve[curveBucket].colorCounts[color] += colorShare;
      });
    }

    if (/\bland\b/i.test(card?.type_line || "")) {
      getLandSourceColors(card).forEach((color) => {
        colorSources.sources[color] += quantity;
      });
      return;
    }

    PACK_STATS_COLORED_MANA_ORDER.forEach((color) => {
      colorSources.pips[color] += cardPips[color] * quantity;
    });
  });

  const coloredPipTotal = PACK_STATS_COLORED_MANA_ORDER.reduce(
    (sum, color) => sum + colorPipCounts[color],
    0,
  );
  const colorPercentages = Object.fromEntries(
    PACK_STATS_COLORED_MANA_ORDER.map((color) => [
      color,
      coloredPipTotal === 0 ? 0 : (colorPipCounts[color] / coloredPipTotal) * 100,
    ]),
  );

  return {
    cardCount,
    colorIdentity: normalizeColorIdentity([...colorIdentity]),
    colorPercentages,
    colorPipCounts,
    allPipCounts,
    manaCurve,
    cardTypes,
    cardFunctions,
    colorSources,
  };
}

export function normalizeStoredPackCubeStats(stats) {
  if (!stats || typeof stats !== "object") return null;
  if (!Number.isFinite(Number(stats.cardCount))) return null;
  if (!stats.manaCurve || !stats.cardTypes || !stats.cardFunctions) return null;

  return {
    ...stats,
    colorIdentity: normalizeColorIdentity(stats.colorIdentity),
    colorPercentages:
      normalizeColorPercentages(stats.colorPercentages) || stats.colorPercentages,
  };
}
