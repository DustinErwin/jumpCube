const ROLE_ALIASES = {
  "card-flow": "card-draw",
};

export const CARD_ROLE_BUCKETS = [
  {
    id: "threats",
    label: "Threats",
    shortLabel: "Threats",
    color: "#d88f5f",
  },
  {
    id: "synergy",
    label: "Synergy",
    shortLabel: "Synergy",
    color: "#d6a35d",
  },
  {
    id: "interaction",
    label: "Interaction",
    shortLabel: "Interact",
    color: "#d87979",
  },
  {
    id: "card-draw",
    label: "Card Flow",
    shortLabel: "Flow",
    color: "#84b8d8",
  },
  {
    id: "ramp",
    label: "Ramp / Fixing",
    shortLabel: "Ramp",
    color: "#75b86f",
  },
  {
    id: "protection",
    label: "Protection",
    shortLabel: "Protect",
    color: "#d8d0ad",
  },
  {
    id: "utility",
    label: "Utility",
    shortLabel: "Utility",
    color: "#9a8fd8",
  },
  {
    id: "land",
    label: "Land",
    shortLabel: "Land",
    color: "#b68a58",
  },
];

const ROLE_BUCKET_BY_ID = CARD_ROLE_BUCKETS.reduce((bucketMap, bucket) => {
  bucketMap[bucket.id] = bucket;

  return bucketMap;
}, {});

function getText(card) {
  const faceText = card.card_faces
    ?.flatMap((face) => [face.type_line, face.oracle_text])
    .filter(Boolean)
    .join("\n");

  return [card.name, card.type_line, card.oracle_text, faceText]
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ");
}

function getManaValue(card) {
  const manaValue = Number(card.mana_value ?? card.cmc);

  return Number.isFinite(manaValue) ? manaValue : 0;
}

function isType(card, type) {
  return new RegExp(`(^|[^A-Za-z])${type}([^A-Za-z]|$)`, "i").test(
    card.type_line || "",
  );
}

function hasKeyword(card, keyword) {
  return (card.keywords || []).some(
    (cardKeyword) => cardKeyword.toLowerCase() === keyword.toLowerCase(),
  );
}

function addScore(scores, details, roleId, points, detail) {
  scores[roleId] = (scores[roleId] || 0) + points;

  if (detail) details[roleId].add(detail);
}

function normalizeRoleId(roleId) {
  return ROLE_ALIASES[roleId] || roleId;
}

export function analyzeCardRoles(card) {
  const normalizedManualBucket = normalizeRoleId(card.manualMechanicBucket);

  if (normalizedManualBucket && ROLE_BUCKET_BY_ID[normalizedManualBucket]) {
    return {
      confidence: 1,
      details: {
        [normalizedManualBucket]: ["Manual placement"],
      },
      primaryRole: normalizedManualBucket,
      secondaryRoles: [],
    };
  }

  if (isType(card, "Land")) {
    return {
      confidence: 1,
      details: { land: ["Land"] },
      primaryRole: "land",
      secondaryRoles: [],
    };
  }

  const text = getText(card);
  const scores = {
    "card-draw": 0,
    interaction: 0,
    land: 0,
    protection: 0,
    ramp: 0,
    synergy: 0,
    threats: 0,
    utility: 0,
  };
  const details = Object.fromEntries(
    Object.keys(scores).map((roleId) => [roleId, new Set()]),
  );
  const manaValue = getManaValue(card);
  const isCreature = isType(card, "Creature");

  if (isCreature) {
    addScore(scores, details, "threats", 2, "Creature");

    if (manaValue > 0 && manaValue <= 3) {
      addScore(scores, details, "threats", 2, "Low-cost threat");
    }

    if (
      /\b(flying|menace|trample|first strike|double strike|deathtouch|haste|vigilance)\b/i.test(
        text,
      ) ||
      ["Flying", "Menace", "Trample", "Haste"].some((keyword) =>
        hasKeyword(card, keyword),
      )
    ) {
      addScore(scores, details, "threats", 1.5, "Combat keyword");
    }

    if (/\bpower and toughness are each\b/i.test(text) || /\bgets \+\d+\/\+\d+\b/i.test(text)) {
      addScore(scores, details, "threats", 1, "Scales in combat");
    }
  }

  if (
    /\bdestroy (?:all|each)\b/i.test(text) ||
    /\bexile (?:all|each)\b/i.test(text) ||
    /\bdeals? \d+ damage to each\b/i.test(text)
  ) {
    addScore(scores, details, "interaction", 5, "Board control");
  }

  if (
    /\bdestroy target\b/i.test(text) ||
    /\bexile target\b/i.test(text) ||
    /\bcounter target\b/i.test(text) ||
    /\bdeals? .* damage to target\b/i.test(text) ||
    /\bfights? target\b/i.test(text) ||
    /\bgets -\d+\/-\d+\b/i.test(text)
  ) {
    addScore(scores, details, "interaction", 4, "Interaction");
  }

  if (/\bcan't attack\b/i.test(text) || /\btap target\b/i.test(text)) {
    addScore(scores, details, "interaction", 2.5, "Soft interaction");
  }

  if (
    /\bdraw (?:a|two|three|four|x|that many|\d+) cards?\b/i.test(text) ||
    /\blook at the top\b/i.test(text) ||
    /\bimpulse draw\b/i.test(text)
  ) {
    addScore(scores, details, "card-draw", 4, "Card advantage");
  }

  if (/\bscry\b/i.test(text) || /\bsurveil\b/i.test(text) || /\bconnive\b/i.test(text)) {
    addScore(scores, details, "card-draw", 2, "Card selection");
  }

  if (/\bsearch your library for .* card\b/i.test(text) && !/\bland card\b/i.test(text)) {
    addScore(scores, details, "card-draw", 3, "Tutor");
  }

  if (
    /\breturn .* from your graveyard (?:to|onto|to your hand)\b/i.test(text) ||
    /\breturn target .* card from your graveyard\b/i.test(text)
  ) {
    addScore(scores, details, "card-draw", 2.5, "Recursion");
    addScore(scores, details, "synergy", 2, "Graveyard synergy");
  }

  if (
    /\badd \{/i.test(text) ||
    /\badd (?:one|two|three|x) mana\b/i.test(text) ||
    /\btreasure token\b/i.test(text) ||
    /\bsearch your library .* land\b/i.test(text) ||
    /\bput .* land card .* onto the battlefield\b/i.test(text) ||
    (card.produced_mana || []).length > 0
  ) {
    addScore(scores, details, "ramp", 4, "Mana or fixing");
  }

  if (
    /\bhexproof\b/i.test(text) ||
    /\bindestructible\b/i.test(text) ||
    /\bward\b/i.test(text) ||
    /\bprotection from\b/i.test(text) ||
    /\bprevent .* damage\b/i.test(text) ||
    /\bphase out\b/i.test(text)
  ) {
    addScore(scores, details, "protection", 4, "Protection");
  }

  if (
    /\bcreate(s|d)? .*token/i.test(text) ||
    /\bsacrifice\b/i.test(text) ||
    /\bwhen .* dies\b/i.test(text) ||
    /\bwhenever you gain life\b/i.test(text) ||
    /\bgain [0-9x]? ?life\b/i.test(text) ||
    /\blifelink\b/i.test(text) ||
    /\b\+1\/\+1 counters?\b/i.test(text) ||
    /\bcreatures you control get\b/i.test(text) ||
    /\bother .* you control get\b/i.test(text) ||
    /\bequipment\b/i.test(text) ||
    /\baura\b/i.test(text) ||
    /\benchantment\b/i.test(text) ||
    /\bartifact\b/i.test(text)
  ) {
    addScore(scores, details, "synergy", 4, "Theme support");
  }

  if (/\bwhenever you cast\b/i.test(text) || /\bcopy .* spell\b/i.test(text)) {
    addScore(scores, details, "synergy", 3, "Spell payoff");
  }

  if (/\bdiscard\b/i.test(text) || /\bmill\b/i.test(text)) {
    addScore(scores, details, "utility", 2, "Setup");
  }

  if (isType(card, "Artifact") || isType(card, "Enchantment") || isType(card, "Planeswalker")) {
    addScore(scores, details, "utility", 1, "Permanent utility");
  }

  const rankedRoles = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort(
      ([roleA, scoreA], [roleB, scoreB]) =>
        scoreB - scoreA || roleA.localeCompare(roleB),
    );
  const primaryRole = rankedRoles[0]?.[0] || "utility";
  const primaryScore = rankedRoles[0]?.[1] || 0;
  const secondaryRoles = rankedRoles
    .slice(1)
    .filter(([, score]) => score >= Math.max(2, primaryScore - 2.5))
    .map(([roleId]) => roleId);

  return {
    confidence: Math.min(1, primaryScore / 6),
    details: Object.fromEntries(
      Object.entries(details).map(([roleId, roleDetails]) => [
        roleId,
        [...roleDetails],
      ]),
    ),
    primaryRole,
    secondaryRoles,
  };
}

export function getPrimaryCardRoleBucket(card) {
  return ROLE_BUCKET_BY_ID[analyzeCardRoles(card).primaryRole] || ROLE_BUCKET_BY_ID.utility;
}

