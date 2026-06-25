function getRandomIndex(maxExclusive) {
  if (maxExclusive <= 1) return 0;

  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    const maxValidValue =
      Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    let randomValue;

    do {
      globalThis.crypto.getRandomValues(values);
      randomValue = values[0];
    } while (randomValue >= maxValidValue);

    return randomValue % maxExclusive;
  }

  return Math.floor(Math.random() * maxExclusive);
}

export function shuffleItems(items) {
  const shuffledItems = [...items];

  for (let index = shuffledItems.length - 1; index > 0; index -= 1) {
    const swapIndex = getRandomIndex(index + 1);
    [shuffledItems[index], shuffledItems[swapIndex]] = [
      shuffledItems[swapIndex],
      shuffledItems[index],
    ];
  }

  return shuffledItems;
}

export function getSampleDraftChoices(packs, excludedPackIds = [], count = 3) {
  const excludedIds = new Set(excludedPackIds.map(String));
  const seenPackIds = new Set();
  const eligiblePacks = (packs || []).filter((pack) => {
    const packId = pack.savedPackId || pack.id;
    const normalizedPackId = String(packId || "");

    if (
      !normalizedPackId ||
      excludedIds.has(normalizedPackId) ||
      seenPackIds.has(normalizedPackId)
    ) {
      return false;
    }

    seenPackIds.add(normalizedPackId);
    return true;
  });

  return shuffleItems(eligiblePacks).slice(0, count);
}

export function buildSampleDraftDeck(packs) {
  const cardCopies = [];

  (packs || []).forEach((pack) => {
    (pack.cards || []).forEach((card) => {
      const quantity = Math.max(0, Number(card.quantity) || 0);

      for (let copyIndex = 0; copyIndex < quantity; copyIndex += 1) {
        cardCopies.push({
          ...card,
          draftCardId: [
            pack.savedPackId || pack.id,
            card.variant_id ||
              card.scryfall_id ||
              card.card_search_id ||
              card.id ||
              card.name,
            copyIndex,
          ].join(":"),
          draftPackName: pack.name,
        });
      }
    });
  });

  return shuffleItems(cardCopies);
}

export function formatArenaDeckList(cards) {
  const cardsByName = new Map();

  (cards || []).forEach((card) => {
    const name = String(card.name || "").trim();

    if (!name) return;

    cardsByName.set(name, (cardsByName.get(name) || 0) + 1);
  });

  const cardLines = [...cardsByName.entries()]
    .sort(([nameA], [nameB]) => nameA.localeCompare(nameB))
    .map(([name, quantity]) => `${quantity} ${name}`);

  return ["Deck", ...cardLines, ""].join("\n");
}
