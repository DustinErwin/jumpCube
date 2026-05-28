import { useEffect, useState } from "react";
import SearchBox from "./components/SearchBox/SearchBox";
import FilterBox from "./components/FilterBox/FilterBox";
import CardBox from "./components/CardBox/CardBox";
import PackBox from "./components/PackBox/PackBox";
import { filterCards } from "./utils/filterCards";
import { useCards } from "./hooks/useCards";
import { usePackBuilder } from "./hooks/usePackBuilder";
import { useAuth } from "./hooks/useAuth";
import AuthBox from "./components/AuthBox/AuthBox";
import { useUserPacks } from "./hooks/useUserPacks";
import PackLibraryModal from "./components/PackLibraryModal/PackLibraryModal";
import "./App.css";

function App() {
  const { cardList, loadingCards, cardsError } = useCards(500);

  const { user, authLoading } = useAuth();

  const [isPackLibraryOpen, setIsPackLibraryOpen] = useState(false);
  const { packs, loadPacks } = useUserPacks(user);

  const [search, setSearch] = useState("");
  const [manaValues, setManaValues] = useState([]);
  const [colors, setColors] = useState([]);
  const [colorMode, setColorMode] = useState("or");
  const [rarities, setRarities] = useState([]);
  const [types, setTypes] = useState([]);
  const [formats, setFormats] = useState([]);
  const [filteredCards, setFilteredCards] = useState([]);

 const pack = usePackBuilder(user, loadPacks);

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
  }, [
    cardList,
    search,
    manaValues,
    colors,
    colorMode,
    rarities,
    types,
    formats,
  ]);

  return (
    <main className="app">
      <h1>Jump Cube Maker</h1>
      <AuthBox user={user} />
      <button onClick={() => setIsPackLibraryOpen(true)}>My Packs</button>
      <div className="appLayout">
        <section className="cardArea">
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

          {cardsError && <p>Error loading cards.</p>}

          {loadingCards ? (
            <p>Loading cards...</p>
          ) : (
            <>
              <p>Results: {filteredCards.length}</p>
              <CardBox
                cards={filteredCards}
                onCardSelect={pack.addCardToPack}
              />
            </>
          )}
        </section>

        <PackBox
          packName={pack.packName}
          setPackName={pack.setPackName}
          packDescription={pack.packDescription}
          setPackDescription={pack.setPackDescription}
          selectedCards={pack.selectedCards}
          addCard={pack.addCardToPack}
          decreaseCardQuantity={pack.decreaseCardQuantity}
          removeCard={pack.removeCardFromPack}
          savePack={pack.savePack}
          newPack={pack.newPack}
          saveStatus={pack.saveStatus}
          showRenameChoice={pack.showRenameChoice}
          pendingSaveAction={pack.pendingSaveAction}
        />
        <PackLibraryModal
          isOpen={isPackLibraryOpen}
          packs={packs}
          onClose={() => setIsPackLibraryOpen(false)}
          onOpenPack={async (packId) => {
            await pack.loadPack(packId);
            setIsPackLibraryOpen(false);
          }}
          onDeletePack={async (packId) => {
            await pack.deletePack(packId);
            await loadPacks();
          }}
        />
      </div>
    </main>
  );
}

export default App;
