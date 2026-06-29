import {
  formatPackTagName,
  normalizePackTagName,
} from "./packTags";

const THEME_RULES = [
  {
    name: "Tokens",
    color: "green",
    weight: 2,
    patterns: [/create(s|d)? .*token/i, /\btokens?\b/i, /\bpopulate\b/i],
  },
  {
    name: "Sacrifice",
    color: "red",
    weight: 2,
    patterns: [/\bsacrifice\b/i, /\bdies\b/i, /\bwhen .* dies\b/i],
  },
  {
    name: "Graveyard",
    color: "black",
    fallbackColor: "purple",
    weight: 2,
    patterns: [
      /\bgraveyard\b/i,
      /\breturn .* from your graveyard\b/i,
      /\breanimate\b/i,
      /\bescape\b/i,
      /\bflashback\b/i,
      /\bdelirium\b/i,
    ],
  },
  {
    name: "Artifacts",
    color: "gray",
    typePattern: /\bartifact\b/i,
    patterns: [/\bartifact\b/i, /\btreasure\b/i, /\bclue\b/i, /\bfood\b/i],
  },
  {
    name: "Lifegain",
    color: "white",
    fallbackColor: "gold",
    weight: 2,
    patterns: [/\bgain [0-9x]? ?life\b/i, /\byou gain life\b/i, /\blifelink\b/i],
  },
  {
    name: "Counters",
    color: "green",
    weight: 2,
    patterns: [/\+1\/\+1 counter/i, /\bcounters?\b/i, /\bproliferate\b/i],
  },
  {
    name: "Spells",
    color: "blue",
    patterns: [
      /\binstant\b/i,
      /\bsorcery\b/i,
      /\bprowess\b/i,
      /\bcopy .* spell\b/i,
      /\bwhenever you cast\b/i,
    ],
  },
  {
    name: "Ramp",
    color: "green",
    weight: 2,
    patterns: [
      /\badd .*mana\b/i,
      /\bsearch your library .* land\b/i,
      /\btreasure\b/i,
    ],
  },
  {
    name: "Removal",
    color: "black",
    fallbackColor: "red",
    patterns: [
      /\bdestroy target\b/i,
      /\bexile target\b/i,
      /\bdeals? .* damage\b/i,
      /-\d+\/-\d+/i,
      /\bcounter target\b/i,
    ],
  },
  {
    name: "Draw",
    color: "blue",
    patterns: [/\bdraw (a|two|three|x) cards?\b/i, /\bscry\b/i, /\bsurveil\b/i],
  },
  {
    name: "Blink",
    color: "white",
    fallbackColor: "blue",
    weight: 2,
    patterns: [/\bexile .* return\b/i, /\bflicker\b/i, /\bblink\b/i],
  },
  {
    name: "Equipment",
    color: "red",
    typePattern: /\bequipment\b/i,
    patterns: [/\bequip\b/i, /\bequipment\b/i],
  },
  {
    name: "Auras",
    color: "white",
    fallbackColor: "purple",
    typePattern: /\baura\b/i,
    patterns: [/\baura\b/i, /\benchant creature\b/i],
  },
  {
    name: "Discard",
    color: "black",
    patterns: [/\bdiscard\b/i],
  },
  {
    name: "Mill",
    color: "blue",
    patterns: [/\bmill\b/i, /\bput .* library .* graveyard\b/i],
  },
  {
    name: "Flyers",
    color: "blue",
    patterns: [/\bflying\b/i],
  },
  {
    name: "Burn",
    color: "red",
    patterns: [/\bdeals? .* damage\b/i],
  },
  {
    name: "Lands",
    color: "green",
    patterns: [/\blandfall\b/i, /\bplay an additional land\b/i],
  },
  {
    name: "Enchantments",
    color: "purple",
    typePattern: /\benchantment\b/i,
    patterns: [/\benchantment\b/i],
  },
  {
    name: "Aggro",
    color: "red",
    patterns: [/\bhaste\b/i, /\bmenace\b/i, /\battack\b/i],
  },
  {
    name: "Control",
    color: "blue",
    patterns: [/\bcounter target\b/i, /\btap target\b/i, /\bcan't attack\b/i],
  },
];

const COLOR_FALLBACKS = {
  black: "purple",
  white: "gold",
};

const IGNORED_TYPAL_SUBTYPES = new Set([
  "advisor",
  "ally",
  "citizen",
  "cleric",
  "human",
  "mercenary",
  "minion",
  "rebel",
  "scout",
  "soldier",
  "survivor",
  "warrior",
]);

const TYPAL_THEME_COLORS = {
  angel: "gold",
  artifact: "gray",
  bird: "blue",
  cleric: "gold",
  demon: "purple",
  dinosaur: "green",
  dragon: "red",
  elemental: "red",
  elf: "green",
  faerie: "blue",
  goblin: "red",
  horror: "purple",
  knight: "gold",
  merfolk: "blue",
  pirate: "red",
  rogue: "purple",
  sliver: "green",
  spirit: "gold",
  vampire: "purple",
  wizard: "blue",
  zombie: "purple",
};

function getCardText(card) {
  return [
    card.name,
    card.type_line,
    card.oracle_text,
    ...(card.card_faces || []).flatMap((face) => [
      face.type_line,
      face.oracle_text,
    ]),
  ]
    .filter(Boolean)
    .join("\n");
}

function getCardQuantity(card) {
  const quantity = Number(card.quantity);

  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function isCardType(card, type) {
  return new RegExp(`(^|[^A-Za-z])${type}([^A-Za-z]|$)`, "i").test(
    card.type_line || "",
  );
}

function isBasicLand(card) {
  return /basic\s+land/i.test(card.type_line || "");
}

function getCreatureSubtypes(card) {
  const typeLine = card.type_line || "";

  if (!/\bcreature\b/i.test(typeLine) || !/(?:\u2014|-)/.test(typeLine)) {
    return [];
  }

  const subtypeText = typeLine.split(/(?:\u2014|-)/).slice(1).join(" ");

  return subtypeText
    .split(/\s+/)
    .map((subtype) => subtype.trim().toLowerCase())
    .filter(Boolean)
    .filter((subtype) => !IGNORED_TYPAL_SUBTYPES.has(subtype));
}

function pluralizeSubtype(subtype) {
  if (subtype.endsWith("y")) return `${subtype.slice(0, -1)}ies`;
  if (subtype.endsWith("s")) return subtype;

  return `${subtype}s`;
}

function getManaValue(card) {
  const manaValue = Number(card.mana_value ?? card.cmc);

  return Number.isFinite(manaValue) ? manaValue : 0;
}

function getThemeScore(rule, card) {
  const text = getCardText(card);
  let score = 0;

  if (rule.typePattern?.test(card.type_line || "")) {
    score += 1.4;
  }

  (rule.patterns || []).forEach((pattern) => {
    if (pattern.test(text)) {
      score += rule.weight || 1;
    }
  });

  return score * getCardQuantity(card);
}

function getThemeScores(cards) {
  const ruleScores = THEME_RULES.map((rule) => ({
    name: formatPackTagName(rule.name),
    normalizedName: normalizePackTagName(rule.name),
    color: rule.fallbackColor || COLOR_FALLBACKS[rule.color] || rule.color,
    score: (cards || []).reduce(
      (total, card) => total + getThemeScore(rule, card),
      0,
    ),
  }));
  const typalCounts = (cards || []).reduce((counts, card) => {
    getCreatureSubtypes(card).forEach((subtype) => {
      counts[subtype] = (counts[subtype] || 0) + getCardQuantity(card);
    });

    return counts;
  }, {});
  const typalScores = Object.entries(typalCounts)
    .filter(([, count]) => count >= 4)
    .map(([subtype, count]) => ({
      name: formatPackTagName(pluralizeSubtype(subtype)),
      normalizedName: normalizePackTagName(pluralizeSubtype(subtype)),
      color: TYPAL_THEME_COLORS[subtype] || "gray",
      score: count * 2.4,
    }));

  return [...ruleScores, ...typalScores].sort(
    (themeA, themeB) =>
      themeB.score - themeA.score || themeA.name.localeCompare(themeB.name),
  );
}

function getCurveRating(cards) {
  const nonlandCards = (cards || []).filter((card) => !isCardType(card, "Land"));
  const totalNonlands = nonlandCards.reduce(
    (total, card) => total + getCardQuantity(card),
    0,
  );

  if (totalNonlands === 0) return { label: "Sparse", score: 35 };

  const earlyCount = nonlandCards.reduce((total, card) => {
    const manaValue = getManaValue(card);

    return manaValue > 0 && manaValue <= 3
      ? total + getCardQuantity(card)
      : total;
  }, 0);
  const highCount = nonlandCards.reduce((total, card) => {
    const manaValue = getManaValue(card);

    return manaValue >= 5 ? total + getCardQuantity(card) : total;
  }, 0);
  const earlyRatio = earlyCount / totalNonlands;
  const highRatio = highCount / totalNonlands;
  const score = Math.round(
    Math.max(20, Math.min(100, 70 + (earlyRatio - 0.48) * 70 - highRatio * 34)),
  );

  if (score >= 78) return { label: "Good", score };
  if (score >= 58) return { label: "Playable", score };
  return { label: "Heavy", score };
}

function getRoleCounts(cards) {
  return (cards || []).reduce(
    (counts, card) => {
      const text = getCardText(card);
      const quantity = getCardQuantity(card);

      if (isCardType(card, "Creature")) counts.creatures += quantity;
      if (isCardType(card, "Land")) counts.lands += quantity;
      if (isBasicLand(card)) counts.basicLands += quantity;
      if (/\bdraw (a|two|three|x) cards?\b/i.test(text) || /\bscry\b/i.test(text)) {
        counts.cardFlow += quantity;
      }
      if (
        /\bdestroy target\b/i.test(text) ||
        /\bexile target\b/i.test(text) ||
        /\bdeals? .* damage\b/i.test(text) ||
        /\bcounter target\b/i.test(text) ||
        /-\d+\/-\d+/i.test(text)
      ) {
        counts.interaction += quantity;
      }
      if (
        /\badd .*mana\b/i.test(text) ||
        /\bsearch your library .* land\b/i.test(text) ||
        /\btreasure\b/i.test(text)
      ) {
        counts.fixing += quantity;
      }

      return counts;
    },
    {
      basicLands: 0,
      cardFlow: 0,
      creatures: 0,
      fixing: 0,
      interaction: 0,
      lands: 0,
    },
  );
}

function getPowerScore(cards, roleCounts, curveScore) {
  const nonBasicCards = (cards || []).filter((card) => !isBasicLand(card));
  const averageRank =
    nonBasicCards.reduce((total, card) => {
      const rank = Number(card.edhrec_rank);

      return total + (Number.isFinite(rank) && rank > 0 ? rank : 30000);
    }, 0) / Math.max(1, nonBasicCards.length);
  const rankScore = Math.max(
    25,
    Math.min(76, 78 - Math.sqrt(averageRank) * 0.22),
  );
  const roleScore =
    Math.min(6, roleCounts.interaction * 1.5) +
    Math.min(6, roleCounts.cardFlow * 1.5) +
    Math.min(5, roleCounts.fixing * 1.25);
  const curveAdjustment = Math.max(-8, Math.min(8, (curveScore - 65) / 5));

  return Math.round(
    Math.max(20, Math.min(100, rankScore + roleScore + curveAdjustment)),
  );
}

function getWarnings(roleCounts, curveRating, totalCards) {
  const warnings = [];

  if (roleCounts.interaction < 2) warnings.push("Light on interaction");
  if (roleCounts.cardFlow < 2) warnings.push("Low card flow");
  if (curveRating.score < 58) warnings.push("Curve may be top-heavy");
  if (totalCards >= 30 && roleCounts.fixing < 2) warnings.push("May need fixing");
  if (roleCounts.creatures < Math.max(4, totalCards * 0.25)) {
    warnings.push("Creature count is low");
  }

  return warnings.slice(0, 3);
}

export function getPackThemeSuggestions(cards, existingTags = [], limit = 3) {
  const existingNames = new Set(
    existingTags.map((tag) => normalizePackTagName(tag.name)),
  );
  const suggestions = getThemeScores(cards)
    .filter((suggestion) => suggestion.score >= 2)
    .filter((suggestion) => !existingNames.has(suggestion.normalizedName))
    .sort((suggestionA, suggestionB) => suggestionB.score - suggestionA.score);

  return suggestions.slice(0, limit);
}

export function analyzePackThemes(cards) {
  const themeScores = getThemeScores(cards).filter((theme) => theme.score >= 2);
  const topThemes = themeScores.slice(0, 4);
  const totalCards = (cards || []).reduce(
    (total, card) => total + getCardQuantity(card),
    0,
  );
  const roleCounts = getRoleCounts(cards);
  const curveRating = getCurveRating(cards);
  const topThemeScore = topThemes[0]?.score || 0;
  const secondaryThemeScore = topThemes[1]?.score || 0;
  const themeDensity = totalCards > 0 ? topThemeScore / totalCards : 0;
  const secondaryThemeDensity =
    totalCards > 0 ? secondaryThemeScore / totalCards : 0;
  const themeBreadthBonus = Math.min(5, topThemes.length * 1.25);
  const extremeCohesionBonus =
    themeDensity >= 1.5 && secondaryThemeDensity >= 0.8 && topThemes.length >= 3
      ? 2
      : 0;
  const synergy = Math.round(
    Math.max(
      20,
      Math.min(
        100,
        26 +
          Math.min(36, Math.sqrt(topThemeScore) * 6.2) +
          Math.min(15, Math.sqrt(secondaryThemeScore) * 2.4) +
          Math.min(14, themeDensity * 10) +
          Math.min(6, secondaryThemeDensity * 4) +
          themeBreadthBonus +
          extremeCohesionBonus,
      ),
    ),
  );
  const power = getPowerScore(cards, roleCounts, curveRating.score);

  return {
    curve: curveRating.label,
    curveScore: curveRating.score,
    power,
    roleCounts,
    suggestedTags: topThemes.slice(0, 3),
    synergy,
    themes: topThemes,
    topTheme: topThemes[0]?.name || "Mixed",
    warnings: getWarnings(roleCounts, curveRating, totalCards),
  };
}
