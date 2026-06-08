import { useEffect, useRef, useState } from "react";
import "./FilterBox.css";

/*
 * FilterBox renders compact dropdown chips for the card search filters.
 *
 * Props are all controlled by App:
 * - each filter value is an array (manaValues, colors, rarities, types,
 *   formats, selectedSets)
 * - each setX prop is the matching React state setter
 * - colorMode is "or" | "and"
 * - sets is the list from useSets(), with set_code/name/icon_svg_uri
 * - showAllPrintings toggles default-printing dedupe in useCards()
 *
 * To add a new filter option, update the *_OPTIONS list here and the matching
 * query behavior in useCards().
 */

const MANA_OPTIONS = ["0", "1", "2", "3", "4", "5", "6", "7"];
const COLOR_OPTIONS = ["W", "U", "B", "R", "G", "C"];
const RARITY_OPTIONS = ["Common", "Uncommon", "Rare", "Mythic"];
const TYPE_OPTIONS = [
  "Artifact",
  "Battle",
  "Basic Land",
  "Creature",
  "Enchantment",
  "Instant",
  "Land",
  "Planeswalker",
  "Sorcery",
];
const FORMAT_OPTIONS = [
  "Standard",
  "Pioneer",
  "Modern",
  "Legacy",
  "Vintage",
  "Commander",
];

export default function FilterBox({
  manaValues,
  setManaValues,
  colors,
  setColors,
  colorMode,
  setColorMode,
  rarities,
  setRarities,
  types,
  setTypes,
  formats,
  setFormats,
  sets,
  selectedSets,
  setSelectedSets,
  showAllPrintings,
  setShowAllPrintings,
}) {
  const filterBoxRef = useRef(null);
  const [openFilter, setOpenFilter] = useState(null);

  useEffect(() => {
    // Any click outside the active dropdown closes it. This keeps the compact
    // chip bar usable on mobile where dropdowns cover more screen area.
    if (!openFilter) return undefined;

    function closeOnOutsideClick(event) {
      if (filterBoxRef.current?.contains(event.target)) return;

      setOpenFilter(null);
    }

    window.addEventListener("click", closeOnOutsideClick);

    return () => {
      window.removeEventListener("click", closeOnOutsideClick);
    };
  }, [openFilter]);

  function toggleOpen(filterName) {
    setOpenFilter((current) => (current === filterName ? null : filterName));
  }

  function toggleValue(value, selectedValues, setSelectedValues) {
    // Generic checkbox toggle for array-backed filters.
    setSelectedValues((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value],
    );
  }

  function clearAllFilters() {
    // Reset every controlled filter to the same defaults App uses at startup.
    setManaValues([]);
    setColors([]);
    setColorMode("or");
    setRarities([]);
    setTypes([]);
    setFormats([]);
    setSelectedSets([]);
    setShowAllPrintings(false);
    setOpenFilter(null);
  }

  function getFilterCount(values) {
    return values.length > 0 ? ` (${values.length})` : "";
  }

  return (
    <div className="filterBox compactFilterBox" ref={filterBoxRef}>
      <div className="filterChipBar">
        <div className="filterChipWrap">
          <button
            className={`filterChip ${colors.length > 0 ? "active" : ""}`}
            onClick={() => toggleOpen("colors")}
          >
            Colors{getFilterCount(colors)} ▼
          </button>

          {openFilter === "colors" && (
            <div className="filterDropdown">
              <div className="filterOptionsGrid">
                {COLOR_OPTIONS.map((color) => (
                  <label className="filterOption" key={color}>
                    <input
                      type="checkbox"
                      checked={colors.includes(color)}
                      onChange={() => toggleValue(color, colors, setColors)}
                    />
                    {color}
                  </label>
                ))}
              </div>

              <div className="colorModeOptions">
                <label>
                  <input
                    type="radio"
                    checked={colorMode === "or"}
                    onChange={() => setColorMode("or")}
                  />
                  Or
                </label>

                <label>
                  <input
                    type="radio"
                    checked={colorMode === "and"}
                    onChange={() => setColorMode("and")}
                  />
                  And
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="filterChipWrap">
          <button
            className={`filterChip ${manaValues.length > 0 ? "active" : ""}`}
            onClick={() => toggleOpen("mana")}
          >
            Mana{getFilterCount(manaValues)} ▼
          </button>

          {openFilter === "mana" && (
            <div className="filterDropdown">
              <div className="filterOptionsGrid">
                {MANA_OPTIONS.map((mv) => (
                  <label className="filterOption" key={mv}>
                    <input
                      type="checkbox"
                      checked={manaValues.includes(mv)}
                      onChange={() =>
                        toggleValue(mv, manaValues, setManaValues)
                      }
                    />
                    {mv === "7" ? "7+" : mv}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="filterChipWrap">
          <button
            className={`filterChip ${types.length > 0 ? "active" : ""}`}
            onClick={() => toggleOpen("types")}
          >
            Type{getFilterCount(types)} ▼
          </button>

          {openFilter === "types" && (
            <div className="filterDropdown">
              <div className="filterOptionsList">
                {TYPE_OPTIONS.map((type) => (
                  <label className="filterOption" key={type}>
                    <input
                      type="checkbox"
                      checked={types.includes(type)}
                      onChange={() => toggleValue(type, types, setTypes)}
                    />
                    {type}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="filterChipWrap">
          <button
            className={`filterChip ${rarities.length > 0 ? "active" : ""}`}
            onClick={() => toggleOpen("rarities")}
          >
            Rarity{getFilterCount(rarities)} ▼
          </button>

          {openFilter === "rarities" && (
            <div className="filterDropdown">
              <div className="filterOptionsList">
                {RARITY_OPTIONS.map((rarity) => (
                  <label className="filterOption" key={rarity}>
                    <input
                      type="checkbox"
                      checked={rarities.includes(rarity)}
                      onChange={() =>
                        toggleValue(rarity, rarities, setRarities)
                      }
                    />
                    {rarity}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="filterChipWrap">
          <button
            className={`filterChip ${formats.length > 0 ? "active" : ""}`}
            onClick={() => toggleOpen("formats")}
          >
            Format{getFilterCount(formats)} ▼
          </button>

          {openFilter === "formats" && (
            <div className="filterDropdown">
              <div className="filterOptionsList">
                {FORMAT_OPTIONS.map((format) => (
                  <label className="filterOption" key={format}>
                    <input
                      type="checkbox"
                      checked={formats.includes(format)}
                      onChange={() => toggleValue(format, formats, setFormats)}
                    />
                    {format}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="filterChipWrap">
          <button
            className={`filterChip ${selectedSets.length > 0 ? "active" : ""}`}
            onClick={() => toggleOpen("sets")}
          >
            Set{getFilterCount(selectedSets)} ▼
          </button>

          {openFilter === "sets" && (
            <div className="filterDropdown setDropdown">
              <div className="setFilterList">
                {sets.map((set) => (
                  <label className="setFilterOption" key={set.set_code}>
                    <input
                      type="checkbox"
                      checked={selectedSets.includes(set.set_code)}
                      onChange={() =>
                        toggleValue(set.set_code, selectedSets, setSelectedSets)
                      }
                    />

                    {set.icon_svg_uri && (
                      <img
                        className="setSymbol"
                        src={set.icon_svg_uri}
                        alt=""
                        loading="lazy"
                      />
                    )}

                    <span className="setName">{set.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="filterChipWrap">
          <button
            className={`filterChip ${showAllPrintings ? "active" : ""}`}
            onClick={() => toggleOpen("more")}
          >
            More ▼
          </button>

          {openFilter === "more" && (
            <div className="filterDropdown">
              <label className="filterOption">
                <input
                  type="checkbox"
                  checked={showAllPrintings}
                  onChange={(e) => setShowAllPrintings(e.target.checked)}
                />
                Show all printings
              </label>
            </div>
          )}
        </div>

        <button className="clearFiltersButton" onClick={clearAllFilters}>
          Clear
        </button>
      </div>
    </div>
  );
}
