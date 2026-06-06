export const CARD_MECHANIC_TAGS = [
  {
    id: "card-draw",
    label: "Card Draw",
    shortLabel: "Draw",
    color: "#84b8d8",
    // Net card flow. This intentionally does not include looting/rummaging.
    rules: [/\bdraw (?:a|two|three|four|x|that many|\d+) cards?\b/i],
  },
  {
    id: "selection",
    label: "Selection",
    shortLabel: "Select",
    color: "#9a8fd8",
    // Card quality, not card advantage: scry, surveil, connive, loot/rummage.
    rules: [
      /\bscry\b/i,
      /\bsurveil\b/i,
      /\bconnive\b/i,
      /\bdraw .* discard\b/i,
      /\bdiscard .* draw\b/i,
      /\blook at the top\b/i,
    ],
  },
  {
    id: "land-to-hand",
    label: "Land to Hand",
    shortLabel: "Land Hand",
    color: "#d8c07c",
    // Fixing or card advantage, not ramp. Keep this separate from battlefield land search.
    rules: [
      /\bsearch your library for (?:a|up to \w+|any number of )?land card.*put (?:it|them|that card) into your hand\b/i,
      /\breveal .* land card.*put .* into your hand\b/i,
    ],
  },
  {
    id: "land-to-battlefield",
    label: "Land to Battlefield",
    shortLabel: "Land Field",
    color: "#75b86f",
    // True land ramp: the land enters the battlefield from library or hand.
    rules: [
      /\bsearch your library for (?:a|up to \w+|any number of )?land card.*put (?:it|them|that card) onto the battlefield\b/i,
      /\bput (?:a|up to \w+)? land card .* onto the battlefield\b/i,
      /\byou may play an additional land\b/i,
    ],
  },
  {
    id: "mana-production",
    label: "Mana Production",
    shortLabel: "Mana",
    color: "#65b896",
    // Mana rocks, mana creatures, rituals, and Treasures.
    rules: [
      /\badd \{/i,
      /\badd (?:one|two|three|x) mana\b/i,
      /\btreasure token\b/i,
    ],
  },
  {
    id: "removal",
    label: "Removal",
    shortLabel: "Remove",
    color: "#d87979",
    // Spot interaction. This is broad on purpose and should be tuned as misses show up.
    rules: [
      /\bdestroy target\b/i,
      /\bexile target\b/i,
      /\bdeals? .* damage to target\b/i,
      /\bfights? target\b/i,
      /\bgets -\d+\/-\d+\b/i,
      /\bsacrifice (?:a|target) (?:creature|artifact|enchantment|permanent)\b/i,
    ],
  },
  {
    id: "countermagic",
    label: "Countermagic",
    shortLabel: "Counter",
    color: "#5f8fd8",
    rules: [/\bcounter target\b/i],
  },
  {
    id: "tokens",
    label: "Tokens",
    shortLabel: "Tokens",
    color: "#d6a35d",
    rules: [/\bcreate .* token/i],
  },
  {
    id: "recursion",
    label: "Recursion",
    shortLabel: "Recur",
    color: "#b084d6",
    rules: [
      /\breturn .* from your graveyard (?:to|onto)\b/i,
      /\breturn target .* card from your graveyard\b/i,
      /\breanimate\b/i,
    ],
  },
  {
    id: "graveyard-fuel",
    label: "Graveyard Fuel",
    shortLabel: "GY Fuel",
    color: "#8c8f96",
    rules: [/\bmill\b/i, /\bput .* cards? from .* library into .* graveyard\b/i],
  },
  {
    id: "protection",
    label: "Protection",
    shortLabel: "Protect",
    color: "#d8d0ad",
    rules: [
      /\bhexproof\b/i,
      /\bindestructible\b/i,
      /\bward\b/i,
      /\bprotection from\b/i,
      /\bprevent .* damage\b/i,
      /\bphase out\b/i,
    ],
  },
  {
    id: "pump",
    label: "Pump",
    shortLabel: "Pump",
    color: "#d88f5f",
    rules: [
      /\bgets \+\d+\/\+\d+\b/i,
      /\bput .* \+1\/\+1 counters?\b/i,
      /\bcreatures you control get\b/i,
    ],
  },
];

export const PACK_MECHANIC_BUCKETS = [
  {
    id: "synergy",
    label: "Synergy",
    shortLabel: "Synergy",
    color: "#d6a35d",
    // Cards that create or reward board texture, recursion, graveyard, or growth.
    mechanicIds: ["tokens", "recursion", "graveyard-fuel", "pump"],
  },
  {
    id: "interaction",
    label: "Interaction",
    shortLabel: "Interact",
    color: "#d87979",
    // Cards that answer opposing cards or spells.
    mechanicIds: ["removal", "countermagic"],
  },
  {
    id: "card-draw",
    label: "Card Draw",
    shortLabel: "Draw",
    color: "#84b8d8",
    // Includes raw draw plus land-to-hand effects as card flow/fixing, not ramp.
    mechanicIds: ["card-draw", "land-to-hand"],
  },
  {
    id: "ramp",
    label: "Ramp",
    shortLabel: "Ramp",
    color: "#75b86f",
    // Extra mana or lands to battlefield. Land-to-hand intentionally stays out.
    mechanicIds: ["land-to-battlefield", "mana-production"],
  },
  {
    id: "protection",
    label: "Protection",
    shortLabel: "Protect",
    color: "#d8d0ad",
    mechanicIds: ["protection"],
  },
  {
    id: "utility",
    label: "Utility",
    shortLabel: "Utility",
    color: "#9a8fd8",
    // Card quality and setup effects that do not necessarily generate cards.
    mechanicIds: ["selection"],
  },
  {
    id: "land",
    label: "Land",
    shortLabel: "Land",
    color: "#b68a58",
    // Type-line bucket. This is intentionally separate from land-search text.
    matchesCard: (card) => /\bland\b/i.test(card.type_line || ""),
  },
];

function getOracleText(card) {
  const faceText = card.raw?.card_faces
    ?.map((face) => face.oracle_text)
    .filter(Boolean)
    .join("\n");

  return [card.oracle_text, card.raw?.oracle_text, faceText]
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ");
}

export function classifyCardMechanics(card) {
  const oracleText = getOracleText(card);

  if (!oracleText) return [];

  return CARD_MECHANIC_TAGS.filter((tag) =>
    tag.rules.some((rule) => rule.test(oracleText)),
  );
}

export function classifyCardMechanicBuckets(card) {
  const mechanicIds = classifyCardMechanics(card).map((tag) => tag.id);

  return PACK_MECHANIC_BUCKETS.filter((bucket) => {
    const hasMatchingMechanic = bucket.mechanicIds?.some((mechanicId) =>
      mechanicIds.includes(mechanicId),
    );
    const hasMatchingCardRule = bucket.matchesCard?.(card);

    return hasMatchingMechanic || hasMatchingCardRule;
  });
}

export function getPrimaryCardMechanicBucket(card) {
  if (card.manualMechanicBucket) {
    return (
      PACK_MECHANIC_BUCKETS.find(
        (bucket) => bucket.id === card.manualMechanicBucket,
      ) || null
    );
  }

  return classifyCardMechanicBuckets(card)[0] || null;
}

export function getPackMechanicBucketCounts(cards) {
  return PACK_MECHANIC_BUCKETS.map((bucket) => ({
    ...bucket,
    count: cards.filter(
      (card) => getPrimaryCardMechanicBucket(card)?.id === bucket.id,
    ).length,
  }));
}
