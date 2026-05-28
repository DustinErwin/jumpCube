export function filterCards({
  cards,
  search,
  manaValues,
  colors,
  colorMode,
  rarities,
  types,
  formats,
}) {
  const query = search.toLowerCase().trim();

  if (
    query === "" &&
    manaValues.length === 0 &&
    colors.length === 0 &&
    rarities.length === 0 &&
    types.length === 0 &&
    formats.length === 0
  ) {
    return [];
  }

  return cards
    .filter((card) => {
      return (
        matchesSearch(card, query) &&
        matchesManaValue(card, manaValues) &&
        matchesColor(card, colors, colorMode) &&
        matchesRarity(card, rarities) &&
        matchesType(card, types) &&
        matchesFormat(card, formats)
      );
    })
    .slice(0, 200);
}

function matchesFormat(card, formats) {
  if (formats.length === 0) return true;

  return formats.some((format) => {
    const key = format.toLowerCase();
    return card.legalities?.[key] === "legal";
  });
}

function matchesRarity(card, rarities) {
  if (rarities.length === 0) return true;

  return rarities.includes(card.rarity);
}

function matchesSearch(card, query) {
  if (query === "") return true;

  const name = card.name?.toLowerCase() || "";
  const typeLine = card.type_line?.toLowerCase() || "";
  const oracleText = card.oracle_text?.toLowerCase() || "";

  return (
    name.includes(query) ||
    typeLine.includes(query) ||
    oracleText.includes(query)
  );
}

function matchesType(card, types) {
  if (types.length === 0) return true;

  const typeLine = card.type_line?.toLowerCase() || "";

  return types.every((type) => typeLine.includes(type.toLowerCase()));
}

function matchesManaValue(card, manaValues) {
  if (manaValues.length === 0) return true;

  return manaValues.some((mv) =>
    mv === "7"
      ? Number(card.mana_value) >= 7
      : Number(card.mana_value) === Number(mv),
  );
}

function matchesColor(card, colors, colorMode) {
  if (colors.length === 0) return true;

  const cardColors = card.colors || [];

  if (colors.includes("C")) {
    if (colorMode === "and") {
      return colors.length === 1 && cardColors.length === 0;
    }

    return (
      cardColors.length === 0 ||
      colors.some((color) => cardColors.includes(color))
    );
  }

  if (colorMode === "and") {
    return colors.every((color) => cardColors.includes(color));
  }

  return colors.some((color) => cardColors.includes(color));
}
