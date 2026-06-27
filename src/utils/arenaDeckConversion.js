import {
  DEFAULT_PACK_CARD_LIMIT,
  normalizePackCardLimit,
} from "./packFormats";

const LAND_SHARE = 0.4;
export const COMMANDER_PACK_CARD_COUNT = 30;
const COMMANDER_SUPPORT_COUNT = 17;
const COMMANDER_FIXER_COUNT = 2;
const COMMANDER_BASIC_LAND_COUNT = 10;
const COMMANDER_CREATURE_COUNTS = [11, 10];
const BASIC_LAND_BY_COLOR = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
  C: "Wastes",
};
const COLOR_ORDER = ["W", "U", "B", "R", "G"];

export function normalizeDeckCardName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9{}+/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseArenaDeckList(deckText) {
  const entriesByName = new Map();
  let currentSection = "deck";
  let isSideboard = false;

  String(deckText || "")
    .split(/\r?\n/)
    .forEach((rawLine) => {
      const line = rawLine.trim();

      if (!line) return;
      if (/^commander$/i.test(line)) {
        currentSection = "commander";
        isSideboard = false;
        return;
      }
      if (/^deck$/i.test(line)) {
        currentSection = "deck";
        isSideboard = false;
        return;
      }
      if (/^sideboard$/i.test(line)) {
        currentSection = "sideboard";
        isSideboard = true;
        return;
      }
      if (isSideboard) return;

      const match = line.match(/^(\d+)\s+(.+)$/);

      if (!match) return;

      const quantity = Number(match[1]);
      const name = match[2]
        .replace(/\s+\([A-Z0-9]+\)\s+\S+\s*$/i, "")
        .trim();
      const normalizedName = normalizeDeckCardName(name);

      if (!quantity || !normalizedName) return;

      const existing = entriesByName.get(normalizedName);

      entriesByName.set(normalizedName, {
        name: existing?.name || name,
        normalizedName,
        quantity: (existing?.quantity || 0) + quantity,
        sections: [...new Set([...(existing?.sections || []), currentSection])],
      });
    });

  return [...entriesByName.values()];
}

function addParsedDeckEntry(entriesByName, name, quantity) {
  const normalizedName = normalizeDeckCardName(name);

  if (!quantity || !normalizedName) return;

  const existing = entriesByName.get(normalizedName);

  entriesByName.set(normalizedName, {
    name: existing?.name || name,
    normalizedName,
    quantity: (existing?.quantity || 0) + quantity,
  });
}

function parseMtgoSideboardValue(value) {
  return /^(true|1|yes)$/i.test(String(value || "").trim());
}

export function parseMtgoDek(deckXml) {
  const xmlText = String(deckXml || "").trim();

  if (!xmlText) return [];

  const parser = new DOMParser();
  const document = parser.parseFromString(xmlText, "application/xml");

  if (document.querySelector("parsererror")) {
    throw new Error("The MTGO .dek file could not be read as XML.");
  }

  const entriesByName = new Map();

  [...document.querySelectorAll("Card, Cards")].forEach((cardNode) => {
    const isSideboard = parseMtgoSideboardValue(
      cardNode.getAttribute("Sideboard"),
    );

    if (isSideboard) return;

    const name = cardNode.getAttribute("Name") || "";
    const quantity = Number(cardNode.getAttribute("Quantity") || 0);

    addParsedDeckEntry(entriesByName, name, quantity);
  });

  return [...entriesByName.values()];
}

function isLand(card) {
  return /\bland\b/i.test(card.type_line || "");
}

function isBasicLand(card) {
  return /basic\s+land/i.test(card.type_line || "");
}

function isCreature(card) {
  return /\bcreature\b/i.test(card.type_line || "");
}

function isCommanderEligible(card) {
  const typeLine = card?.type_line || "";
  const isLegendary = /\blegendary\b/i.test(typeLine);
  const isCreatureOrPlaneswalker =
    /\bcreature\b/i.test(typeLine) || /\bplaneswalker\b/i.test(typeLine);

  return isLegendary && isCreatureOrPlaneswalker;
}

function isArtifact(card) {
  return /\bartifact\b/i.test(card.type_line || "");
}

function getManaValue(card) {
  const manaValue = Number(card.mana_value);

  return Number.isFinite(manaValue) ? manaValue : 0;
}

function getEdhrecRank(card) {
  const rank = Number(card?.edhrec_rank);

  return Number.isFinite(rank) && rank > 0 ? rank : Number.MAX_SAFE_INTEGER;
}

function getColorIdentity(card) {
  return Array.isArray(card?.color_identity) ? card.color_identity : [];
}

function isInCommanderIdentity(card, commander) {
  const commanderIdentity = new Set(getColorIdentity(commander));

  return getColorIdentity(card).every((color) => commanderIdentity.has(color));
}

function isManaFixer(card) {
  const oracleText = card?.oracle_text || "";

  if (isLand(card)) return true;
  if (isArtifact(card) && /add (one mana|.*mana of any color|.*mana in any combination)/i.test(oracleText)) {
    return true;
  }

  return /search your library.*land/i.test(oracleText);
}

function scoreCommanderCard(card) {
  return getEdhrecRank(card) + getManaValue(card) * 250;
}

function scoreSupportCard(card, targetManaValue) {
  const rankScore = Math.min(getEdhrecRank(card), 50000);
  const curvePenalty = Math.abs(getManaValue(card) - targetManaValue) * 1200;

  return rankScore + curvePenalty;
}

function scoreFixerCard(card) {
  const landBonus = isLand(card) ? -2500 : 0;

  return Math.min(getEdhrecRank(card), 50000) + getManaValue(card) * 900 + landBonus;
}

function getCommanderCurveTarget(card, index) {
  const manaValue = getManaValue(card);

  if (manaValue <= 2) return [1, 2, 2, 3, 3, 4][index % 6];
  if (manaValue <= 4) return [1, 2, 2, 3, 3, 4, 4][index % 7];

  return [1, 2, 2, 3, 3, 4, 4, 5][index % 8];
}

function trimConvertedNonlands(convertedEntries, targetNonlandCount) {
  const entries = convertedEntries.map((entry) => ({ ...entry }));
  let total = entries.reduce((sum, entry) => sum + entry.quantity, 0);

  const duplicateCandidates = [...entries].sort(
    (entryA, entryB) =>
      getManaValue(entryB.card) - getManaValue(entryA.card) ||
      entryA.sourceQuantity - entryB.sourceQuantity ||
      entryA.card.name.localeCompare(entryB.card.name),
  );

  while (total > targetNonlandCount) {
    const duplicate = duplicateCandidates.find((entry) => entry.quantity > 1);

    if (!duplicate) break;

    duplicate.quantity -= 1;
    total -= 1;
  }

  if (total > targetNonlandCount) {
    const removalOrder = [...entries].sort(
      (entryA, entryB) =>
        entryA.sourceQuantity - entryB.sourceQuantity ||
        getManaValue(entryB.card) - getManaValue(entryA.card) ||
        entryA.card.name.localeCompare(entryB.card.name),
    );

    removalOrder.forEach((entry) => {
      if (total <= targetNonlandCount || entry.quantity === 0) return;

      total -= entry.quantity;
      entry.quantity = 0;
    });
  }

  return entries.filter((entry) => entry.quantity > 0);
}

function getCardManaCosts(card) {
  const faceCosts = (card.card_faces || [])
    .map((face) => face.mana_cost)
    .filter(Boolean);

  return [card.mana_cost, ...faceCosts].filter(Boolean).join("");
}

function getColorWeights(cards) {
  const weights = Object.fromEntries(COLOR_ORDER.map((color) => [color, 0]));

  cards.forEach(({ card, quantity }) => {
    const symbols = getCardManaCosts(card).match(/\{[^}]+\}/g) || [];

    symbols.forEach((symbol) => {
      const symbolColors = COLOR_ORDER.filter((color) =>
        symbol.toUpperCase().includes(color),
      );

      symbolColors.forEach((color) => {
        weights[color] += quantity / symbolColors.length;
      });
    });
  });

  if (Object.values(weights).some((weight) => weight > 0)) {
    return weights;
  }

  cards.forEach(({ card, quantity }) => {
    const identity = COLOR_ORDER.filter((color) =>
      (card.color_identity || []).includes(color),
    );

    identity.forEach((color) => {
      weights[color] += quantity / identity.length;
    });
  });

  return weights;
}

export function allocateBasicLands(convertedNonlands, targetLandCount) {
  if (targetLandCount <= 0) return [];

  const weights = getColorWeights(convertedNonlands);
  const activeColors = COLOR_ORDER.filter((color) => weights[color] > 0)
    .sort(
      (colorA, colorB) =>
        weights[colorB] - weights[colorA] ||
        COLOR_ORDER.indexOf(colorA) - COLOR_ORDER.indexOf(colorB),
    )
    .slice(0, targetLandCount);

  if (activeColors.length === 0) {
    return [{ name: BASIC_LAND_BY_COLOR.C, quantity: targetLandCount }];
  }

  const totalWeight = activeColors.reduce(
    (sum, color) => sum + weights[color],
    0,
  );
  const allocations = activeColors.map((color) => {
    const exactQuantity = (weights[color] / totalWeight) * targetLandCount;

    return {
      color,
      exactQuantity,
      quantity: Math.max(1, Math.floor(exactQuantity)),
    };
  });
  let allocated = allocations.reduce(
    (sum, allocation) => sum + allocation.quantity,
    0,
  );

  while (allocated < targetLandCount) {
    const nextAllocation = [...allocations].sort(
      (allocationA, allocationB) =>
        allocationB.exactQuantity -
          allocationB.quantity -
          (allocationA.exactQuantity - allocationA.quantity) ||
        COLOR_ORDER.indexOf(allocationA.color) -
          COLOR_ORDER.indexOf(allocationB.color),
    )[0];

    nextAllocation.quantity += 1;
    allocated += 1;
  }

  while (allocated > targetLandCount) {
    const nextAllocation = [...allocations]
      .filter((allocation) => allocation.quantity > 1)
      .sort(
        (allocationA, allocationB) =>
          allocationA.exactQuantity -
            allocationA.quantity -
            (allocationB.exactQuantity - allocationB.quantity),
      )[0];

    if (!nextAllocation) break;

    nextAllocation.quantity -= 1;
    allocated -= 1;
  }

  return allocations
    .sort(
      (allocationA, allocationB) =>
        COLOR_ORDER.indexOf(allocationA.color) -
        COLOR_ORDER.indexOf(allocationB.color),
    )
    .map((allocation) => ({
      name: BASIC_LAND_BY_COLOR[allocation.color],
      quantity: allocation.quantity,
    }));
}

export function getDeckConversionTargets(
  packCardLimit = DEFAULT_PACK_CARD_LIMIT,
) {
  const normalizedLimit = normalizePackCardLimit(packCardLimit);
  const lands = Math.max(1, Math.round(normalizedLimit * LAND_SHARE));

  return {
    lands,
    nonlands: normalizedLimit - lands,
  };
}

export function buildConvertedDeckPlan(
  parsedEntries,
  cardsByNormalizedName,
  packCardLimit = DEFAULT_PACK_CARD_LIMIT,
) {
  const targets = getDeckConversionTargets(packCardLimit);
  const missingNames = [];
  const importedLandNames = [];
  const importedLands = [];
  const convertedEntries = [];

  parsedEntries.forEach((entry) => {
    const card = cardsByNormalizedName.get(entry.normalizedName);

    if (!card) {
      missingNames.push(entry.name);
      return;
    }

    if (isLand(card)) {
      importedLandNames.push(card.name);
      importedLands.push({
        card,
        sourceQuantity: entry.quantity,
        quantity: entry.quantity,
        reason: "Imported land",
      });
      return;
    }

    convertedEntries.push({
      card,
      sourceQuantity: entry.quantity,
      quantity: Math.ceil(entry.quantity * 0.3),
    });
  });

  const retainedBeforeTrim = convertedEntries.reduce(
    (sum, entry) => sum + entry.quantity,
    0,
  );
  const nonlands = trimConvertedNonlands(
    convertedEntries,
    targets.nonlands,
  );
  const keptQuantityByName = new Map(
    nonlands.map((entry) => [
      normalizeDeckCardName(entry.card.name),
      entry.quantity,
    ]),
  );
  const trimmedCards = convertedEntries
    .map((entry) => {
      const keptQuantity =
        keptQuantityByName.get(normalizeDeckCardName(entry.card.name)) || 0;
      const removedQuantity = entry.quantity - keptQuantity;

      return removedQuantity > 0
        ? {
            card: entry.card,
            sourceQuantity: entry.sourceQuantity,
            quantity: removedQuantity,
            reason: "Trimmed",
          }
        : null;
    })
    .filter(Boolean);

  return {
    nonlands,
    basicLands: allocateBasicLands(nonlands, targets.lands),
    missingNames,
    importedLandNames,
    importedLands,
    trimmedCards,
    trimmedCount:
      retainedBeforeTrim -
      nonlands.reduce((sum, entry) => sum + entry.quantity, 0),
  };
}

function getResolvedCommanderDeckEntries(parsedEntries, cardsByNormalizedName) {
  const missingNames = [];
  const resolvedEntries = [];

  parsedEntries.forEach((entry) => {
    const card = cardsByNormalizedName.get(entry.normalizedName);

    if (!card) {
      missingNames.push(entry.name);
      return;
    }

    resolvedEntries.push({
      card,
      sourceQuantity: entry.quantity,
      quantity: 1,
      sections: entry.sections || ["deck"],
    });
  });

  return { missingNames, resolvedEntries };
}

function chooseCommander(resolvedEntries) {
  const commanderSectionEntries = resolvedEntries.filter((entry) =>
    entry.sections?.includes("commander"),
  );
  const commanderPool =
    commanderSectionEntries.length > 0 ? commanderSectionEntries : resolvedEntries;

  return [...commanderPool]
    .filter((entry) => isCommanderEligible(entry.card))
    .sort(
      (entryA, entryB) =>
        scoreCommanderCard(entryA.card) - scoreCommanderCard(entryB.card) ||
        entryA.card.name.localeCompare(entryB.card.name),
    )[0]?.card || null;
}

function chooseCommanderSupport(candidates, commander) {
  for (const creatureTarget of COMMANDER_CREATURE_COUNTS) {
    const selected = [];
    const creatureCandidates = candidates.filter(
      (entry) => isCreature(entry.card) && !isManaFixer(entry.card),
    );
    const noncreatureCandidates = candidates.filter(
      (entry) => !isCreature(entry.card) && !isManaFixer(entry.card),
    );

    const addBestCards = (entries, count) => {
      for (let index = 0; index < count; index += 1) {
        const targetManaValue = getCommanderCurveTarget(commander, index);
        const nextEntry = entries
          .filter((entry) => !selected.includes(entry))
          .sort(
            (entryA, entryB) =>
              scoreSupportCard(entryA.card, targetManaValue) -
                scoreSupportCard(entryB.card, targetManaValue) ||
              entryA.card.name.localeCompare(entryB.card.name),
          )[0];

        if (!nextEntry) break;
        selected.push(nextEntry);
      }
    };

    addBestCards(creatureCandidates, creatureTarget);
    addBestCards(
      noncreatureCandidates,
      COMMANDER_SUPPORT_COUNT - selected.length,
    );

    if (selected.length >= COMMANDER_SUPPORT_COUNT) {
      return selected.slice(0, COMMANDER_SUPPORT_COUNT);
    }
  }

  return [...candidates]
    .filter((entry) => !isManaFixer(entry.card))
    .sort(
      (entryA, entryB) =>
        scoreSupportCard(entryA.card, getCommanderCurveTarget(commander, 0)) -
          scoreSupportCard(entryB.card, getCommanderCurveTarget(commander, 0)) ||
        entryA.card.name.localeCompare(entryB.card.name),
    )
    .slice(0, COMMANDER_SUPPORT_COUNT);
}

function chooseCommanderFixers(candidates, selectedSupport) {
  const selectedCards = new Set(selectedSupport.map((entry) => entry.card));

  return candidates
    .filter((entry) => isManaFixer(entry.card) && !selectedCards.has(entry.card))
    .sort(
      (entryA, entryB) =>
        scoreFixerCard(entryA.card) - scoreFixerCard(entryB.card) ||
        entryA.card.name.localeCompare(entryB.card.name),
    )
    .slice(0, COMMANDER_FIXER_COUNT);
}

function chooseCommanderFillers(candidates, selectedEntries, commander, count) {
  if (count <= 0) return [];

  const selectedCards = new Set(selectedEntries.map((entry) => entry.card));

  return candidates
    .filter((entry) => !selectedCards.has(entry.card) && !isBasicLand(entry.card))
    .sort(
      (entryA, entryB) =>
        scoreSupportCard(entryA.card, getCommanderCurveTarget(commander, 0)) -
          scoreSupportCard(entryB.card, getCommanderCurveTarget(commander, 0)) ||
        entryA.card.name.localeCompare(entryB.card.name),
    )
    .slice(0, count);
}

export function buildCommanderDeckPlan(parsedEntries, cardsByNormalizedName) {
  const { missingNames, resolvedEntries } = getResolvedCommanderDeckEntries(
    parsedEntries,
    cardsByNormalizedName,
  );
  const commander = chooseCommander(resolvedEntries);

  if (!commander) {
    throw new Error(
      "No eligible commander was found. Arena lists should include a Commander section with a legendary creature or planeswalker.",
    );
  }

  const importedLandEntries = resolvedEntries.filter((entry) => isLand(entry.card));
  const candidates = resolvedEntries.filter(
    (entry) =>
      entry.card.id !== commander.id &&
      !isBasicLand(entry.card) &&
      isInCommanderIdentity(entry.card, commander),
  );
  const supportCards = chooseCommanderSupport(candidates, commander);
  const fixerCards = chooseCommanderFixers(candidates, supportCards);
  const selectedEntries = [
    { card: commander, sourceQuantity: 1, quantity: 1, role: "Commander" },
    ...supportCards.map((entry) => ({ ...entry, role: "Support" })),
    ...fixerCards.map((entry) => ({ ...entry, role: "Fixing" })),
  ];
  const preBasicCount = selectedEntries.reduce(
    (sum, entry) => sum + entry.quantity,
    0,
  );
  const fillerCards = chooseCommanderFillers(
    candidates,
    selectedEntries,
    commander,
    Math.max(
      0,
      COMMANDER_PACK_CARD_COUNT - COMMANDER_BASIC_LAND_COUNT - preBasicCount,
    ),
  );

  selectedEntries.push(
    ...fillerCards.map((entry) => ({ ...entry, role: "Support" })),
  );

  const basicLandCount = Math.max(
    0,
    COMMANDER_PACK_CARD_COUNT -
      selectedEntries.reduce((sum, entry) => sum + entry.quantity, 0),
  );
  const selectedCards = new Set(selectedEntries.map((entry) => entry.card));
  const removedCards = resolvedEntries
    .filter((entry) => !selectedCards.has(entry.card) && !isLand(entry.card))
    .map((entry) => ({
      ...entry,
      quantity: Math.max(1, entry.sourceQuantity),
      reason: isInCommanderIdentity(entry.card, commander)
        ? "Commander import trim"
        : "Outside commander color identity",
    }));

  return {
    commander,
    nonlands: selectedEntries,
    basicLands: allocateBasicLands(selectedEntries, basicLandCount),
    missingNames,
    importedLandNames: resolvedEntries
      .filter((entry) => isLand(entry.card))
      .map((entry) => entry.card.name),
    importedLands: importedLandEntries.map((entry) => ({
      ...entry,
      quantity: Math.max(1, entry.sourceQuantity),
      reason: "Imported land",
    })),
    trimmedCards: removedCards,
    trimmedCount: removedCards.reduce((sum, entry) => sum + entry.quantity, 0),
  };
}

export const DECK_CONVERSION_TARGETS = getDeckConversionTargets();
