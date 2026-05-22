import "./FilterBox.css";

export default function FilterBox({
  manaValues,
  setManaValues,
  colors,
  setColors,
  colorMode,
  setColorMode,
  search,
  updateResults,
  rarities,
  setRarities,
  types,
  setTypes,
  formats,
  setFormats,
}) {
  function toggleFormat(value) {
    const updated = formats.includes(value)
      ? formats.filter((v) => v !== value)
      : [...formats, value];

    setFormats(updated);

    updateResults(
      search,
      manaValues,
      colors,
      colorMode,
      rarities,
      types,
      updated,
    );
  }

  function toggleManaValue(value) {
    const updated = manaValues.includes(value)
      ? manaValues.filter((v) => v !== value)
      : [...manaValues, value];

    setManaValues(updated);

    updateResults(search, updated, colors, colorMode, rarities);
  }

  function toggleColor(value) {
    const updated = colors.includes(value)
      ? colors.filter((v) => v !== value)
      : [...colors, value];

    setColors(updated);

    updateResults(search, manaValues, updated, colorMode, rarities);
  }

  function toggleType(value) {
    const updated = types.includes(value)
      ? types.filter((v) => v !== value)
      : [...types, value];

    setTypes(updated);

    updateResults(search, manaValues, colors, colorMode, rarities, updated);
  }

  function toggleRarity(value) {
    const updated = rarities.includes(value)
      ? rarities.filter((v) => v !== value)
      : [...rarities, value];

    setRarities(updated);

    updateResults(search, manaValues, colors, colorMode, updated);
  }

  function handleColorModeChange(e) {
    const value = e.target.value;

    setColorMode(value);

    updateResults(search, manaValues, colors, rarities, value);
  }

  return (
    <section className="filterBox">
      <div className="filterSection">
        <h3>Mana Value</h3>

        {[0, 1, 2, 3, 4, 5, 6, 7].map((mv) => (
          <label key={mv}>
            <input
              type="checkbox"
              checked={manaValues.includes(String(mv))}
              onChange={() => toggleManaValue(String(mv))}
            />
            {mv === 7 ? "7+" : mv}
          </label>
        ))}
      </div>

      <div className="filterSection">
        <h3>Color</h3>

        {[
          ["W", "White"],
          ["U", "Blue"],
          ["B", "Black"],
          ["R", "Red"],
          ["G", "Green"],
          ["C", "Colorless"],
        ].map(([value, label]) => (
          <label key={value}>
            <input
              type="checkbox"
              checked={colors.includes(value)}
              onChange={() => toggleColor(value)}
            />
            {label}
          </label>
        ))}
      </div>

      <div className="filterSection">
        <h3>Color Match</h3>

        <label>
          <input
            type="radio"
            value="inclusive"
            checked={colorMode === "inclusive"}
            onChange={handleColorModeChange}
          />
          Inclusive
        </label>

        <label>
          <input
            type="radio"
            value="exclusive"
            checked={colorMode === "exclusive"}
            onChange={handleColorModeChange}
          />
          Exclusive
        </label>
      </div>

      <div className="filterSection">
        <h3>Rarity</h3>

        {[
          ["common", "Common"],
          ["uncommon", "Uncommon"],
          ["rare", "Rare"],
          ["mythic", "Mythic"],
        ].map(([value, label]) => (
          <label key={value}>
            <input
              type="checkbox"
              checked={rarities.includes(value)}
              onChange={() => toggleRarity(value)}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="filterSection">
        <h3>Type</h3>

        {[
          "Creature",
          "Artifact",
          "Enchantment",
          "Instant",
          "Sorcery",
          "Planeswalker",
          "Land",
          "Battle",
          "Legendary",
        ].map((type) => (
          <label key={type}>
            <input
              type="checkbox"
              checked={types.includes(type)}
              onChange={() => toggleType(type)}
            />
            {type}
          </label>
        ))}
      </div>
      <div className="filterSection">
        <h3>Format Legal</h3>

        {[
          ["standard", "Standard"],
          ["pioneer", "Pioneer"],
          ["modern", "Modern"],
          ["legacy", "Legacy"],
          ["vintage", "Vintage"],
          ["commander", "Commander"],
          ["pauper", "Pauper"],
          ["brawl", "Brawl"],
        ].map(([value, label]) => (
          <label key={value}>
            <input
              type="checkbox"
              checked={formats.includes(value)}
              onChange={() => toggleFormat(value)}
            />
            {label}
          </label>
        ))}
      </div>
    </section>
  );
}
