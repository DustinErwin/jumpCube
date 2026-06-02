import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { supabase } from "./utils/supabase";
import { useCards } from "./hooks/useCards";
import { usePackBuilder } from "./hooks/usePackBuilder";
import { useAuth } from "./hooks/useAuth";
import { useUserPacks } from "./hooks/useUserPacks";
import { useSets } from "./hooks/useSets";
import AuthPage from "./pages/AuthPage/AuthPage";
import SearchBox from "./components/SearchBox/SearchBox";
import FilterBox from "./components/FilterBox/FilterBox";
import CardBox from "./components/CardBox/CardBox";
import PackBox from "./components/PackBox/PackBox";
import PackLibraryModal from "./components/PackLibraryModal/PackLibraryModal";
import JumpCubeBox from "./components/JumpCubeBox/JumpCubeBox";
import NavBar from "./components/NavBar/NavBar";

import "./App.css";

function App() {
  const { user } = useAuth();
  const { sets } = useSets();
  const { packs, loadPacks } = useUserPacks(user);

  const [isPackLibraryOpen, setIsPackLibraryOpen] = useState(false);

  const [isDraggingCard, setIsDraggingCard] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [manaValues, setManaValues] = useState([]);
  const [colors, setColors] = useState([]);
  const [colorMode, setColorMode] = useState("or");
  const [rarities, setRarities] = useState([]);
  const [types, setTypes] = useState([]);
  const [formats, setFormats] = useState([]);
  const [showAllPrintings, setShowAllPrintings] = useState(false);
  const [isPackBoxOpen, setIsPackBoxOpen] = useState(true);
  const [cubeName, setCubeName] = useState("Current Jump Cube");
  const [cubeDescription, setCubeDescription] = useState("");
  const [selectedPacks, setSelectedPacks] = useState([]);
  const [cubeSaveStatus] = useState("");
  const [selectedSets, setSelectedSets] = useState([]);

  const {
    cardList,
    loadingCards,
    loadingMoreCards,
    cardsError,
    hasMoreCards,
    loadMoreCards,
  } = useCards({
    search,
    manaValues,
    colors,
    colorMode,
    rarities,
    types,
    formats,
    selectedSets,
    showAllPrintings,
    limit: 50,
  });
  const pack = usePackBuilder(user, loadPacks);

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Error logging out:", error);
      return;
    }

    setIsPackLibraryOpen(false);
    pack.newPack();
  }

  function submitSearch() {
    setSearch(searchInput.trim());
  }

  useEffect(() => {
    function handleScroll() {
      const scrollPosition = window.innerHeight + window.scrollY;
      const bottomPosition = document.documentElement.offsetHeight - 300;

      if (scrollPosition >= bottomPosition) {
        loadMoreCards();
      }
    }

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [loadMoreCards]);

  return (
    <main className="app">
      <NavBar
        user={user}
        onOpenPacks={() => setIsPackLibraryOpen(true)}
        onLogout={handleLogout}
      />

      <Routes>
        <Route
          path="/"
          element={
            <>
              <div className="appLayout">
                {" "}
                <section className="cardArea">
                  <SearchBox
                    searchInput={searchInput}
                    setSearchInput={setSearchInput}
                    onSearch={submitSearch}
                  />

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
                    sets={sets}
                    selectedSets={selectedSets}
                    setSelectedSets={setSelectedSets}
                    showAllPrintings={showAllPrintings}
                    setShowAllPrintings={setShowAllPrintings}
                  />

                  {cardsError && (
                    <p>
                      Error loading cards:{" "}
                      {cardsError.message || "Please try again."}
                    </p>
                  )}

                  {loadingCards ? (
                    <p>Loading cards...</p>
                  ) : (
                    <>
                      <p>Results: {cardList.length}</p>

                      <CardBox
                        cards={cardList}
                        onCardSelect={pack.addCardToPack}
                        isDraggingCard={isDraggingCard}
                        setIsDraggingCard={setIsDraggingCard}
                      />
                      {loadingMoreCards && <p>Loading more cards...</p>}

                      {!hasMoreCards && cardList.length > 0 && (
                        <p>No more results.</p>
                      )}
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
                  moveCard={pack.moveCard}
                  isDraggingCard={isDraggingCard}
                  setIsDraggingCard={setIsDraggingCard}
                  isOpen={isPackBoxOpen}
                  setIsOpen={setIsPackBoxOpen}
                />
                <JumpCubeBox
                  cubeName={cubeName}
                  setCubeName={setCubeName}
                  cubeDescription={cubeDescription}
                  setCubeDescription={setCubeDescription}
                  selectedPacks={selectedPacks}
                  saveCube={() => {
                    console.log("Save cube later");
                  }}
                  newCube={() => {
                    setCubeName("Current Jump Cube");
                    setCubeDescription("");
                    setSelectedPacks([]);
                  }}
                  saveStatus={cubeSaveStatus}
                />
              </div>

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
                onDuplicatePack={async (packId) => {
                  await pack.duplicatePack(packId);
                }}
              />
            </>
          }
        />

        <Route path="/auth" element={<AuthPage />} />
      </Routes>
    </main>
  );
}

export default App;
