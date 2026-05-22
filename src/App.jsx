import { useEffect, useState } from "react";
import cards from "./api/card.json";
import SearchBox from "./components/SearchBox/SearchBox";
import FilterBox from "./components/FilterBox/FilterBox";
import CardBox from "./components/CardBox/CardBox";
import { filterCards } from "./utils/filterCards";
import "./App.css";

function App() {
  const cardList = Array.isArray(cards) ? cards : cards.data || [];

  const [search, setSearch] = useState("");
  const [manaValues, setManaValues] = useState([]);
  const [colors, setColors] = useState([]);
  const [colorMode, setColorMode] = useState("inclusive");
  const [rarities, setRarities] = useState([]);
  const [types, setTypes] = useState([]);
  const [formats, setFormats] = useState([]);

  const [filteredCards, setFilteredCards] = useState([]);

  useEffect(() => {
    const results = filterCards({
      cards: cardList,
      search,
      manaValues,
      colors,
      colorMode,
      rarities,
      types,
      formats,
    });

    setFilteredCards(results);
  }, [search, manaValues, colors, colorMode, rarities, types, formats]);

  return (
    <main className="app">
      <h1>Jump Cube Maker</h1>

      <SearchBox search={search} setSearch={setSearch} />

      <FilterBox
        manaValues={manaValues}
        setManaValues={setManaValues}
        colors={colors}
        setColors={setColors}
        colorMode={colorMode}
        setColorMode={setColorMode}
        rarities={rarities}
        setRarities={setRarities}
        types={types}
        setTypes={setTypes}
        formats={formats}
        setFormats={setFormats}
      />

      <p>Results: {filteredCards.length}</p>

      <CardBox cards={filteredCards} />
    </main>
  );
}

export default App;
