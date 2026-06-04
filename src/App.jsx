import { useCallback, useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { supabase } from "./utils/supabase";
import { useCards } from "./hooks/useCards";
import { usePackBuilder } from "./hooks/usePackBuilder";
import { useAuth } from "./hooks/useAuth";
import { useUserPacks } from "./hooks/useUserPacks";
import { useUserCubes } from "./hooks/useUserCubes";
import { useSets } from "./hooks/useSets";
import AuthPage from "./pages/AuthPage/AuthPage";
import SearchBox from "./components/SearchBox/SearchBox";
import FilterBox from "./components/FilterBox/FilterBox";
import CardBox from "./components/CardBox/CardBox";
import PackBox from "./components/PackBox/PackBox";
import PackLibraryModal from "./components/PackLibraryModal/PackLibraryModal";
import CubeLibraryModal from "./components/CubeLibraryModal/CubeLibraryModal";
import JumpCubeBox from "./components/JumpCubeBox/JumpCubeBox";
import NavBar from "./components/NavBar/NavBar";

import "./App.css";

const TITLE_MAX_LENGTH = 40;
const MOBILE_PANEL_QUERY = "(max-width: 760px)";

function normalizeTitle(title, fallback) {
  const trimmedTitle = (title || "").trim().slice(0, TITLE_MAX_LENGTH);

  return trimmedTitle || fallback;
}

function App() {
  const { user } = useAuth();
  const { sets } = useSets();
  const { packs, loadPacks } = useUserPacks(user);
  const userCubes = useUserCubes(user);
  const { saveCube: saveUserCube } = userCubes;

  const [isPackLibraryOpen, setIsPackLibraryOpen] = useState(false);
  const [isCubeLibraryOpen, setIsCubeLibraryOpen] = useState(false);

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
  const [isPackBoxOpen, setIsPackBoxOpen] = useState(
    () =>
      typeof window === "undefined" ||
      !window.matchMedia(MOBILE_PANEL_QUERY).matches,
  );
  const [isJumpCubeBoxOpen, setIsJumpCubeBoxOpen] = useState(
    () =>
      typeof window === "undefined" ||
      !window.matchMedia(MOBILE_PANEL_QUERY).matches,
  );
  const [cubeName, setCubeName] = useState("Current Jump Cube");
  const [cubeDescription, setCubeDescription] = useState("");
  const [selectedPacks, setSelectedPacks] = useState([]);
  const [savedCubeId, setSavedCubeId] = useState(null);
  const [cubeSaveStatus, setCubeSaveStatus] = useState("");
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
    setIsCubeLibraryOpen(false);
    pack.newPack();
  }

  function submitSearch() {
    setSearch(searchInput.trim());
  }

  async function addCurrentPackToCube() {
    if (pack.selectedCards.length === 0) return;

    const savedPackId = await pack.savePack({ promptOnRename: false });

    if (!savedPackId) return;

    const colorIdentity = [
      ...new Set(
        pack.selectedCards.flatMap((card) => card.color_identity || []),
      ),
    ];
    const cardCount = pack.selectedCards.reduce(
      (sum, card) => sum + card.quantity,
      0,
    );
    const packSummary = {
      id: savedPackId,
      name: normalizeTitle(pack.packName, "Unnamed Pack"),
      description: pack.packDescription.trim(),
      cardCount,
      colorIdentity,
      savedPackId,
      cards: pack.selectedCards,
    };

    setSelectedPacks((currentPacks) => {
      const existingIndex = currentPacks.findIndex(
        (selectedPack) =>
          selectedPack.id === savedPackId ||
          selectedPack.id === "current-pack",
      );

      if (existingIndex === -1) {
        return [...currentPacks, packSummary];
      }

      return currentPacks.map((selectedPack, index) =>
        index === existingIndex ? packSummary : selectedPack,
      );
    });
  }

  function removePackFromCube(packId) {
    setSelectedPacks((currentPacks) =>
      currentPacks.filter((selectedPack) => selectedPack.id !== packId),
    );
  }

  async function openCubePack(packId) {
    await pack.loadPack(packId);
    setIsPackBoxOpen(true);
    setIsJumpCubeBoxOpen(false);
  }

  function newCube() {
    setCubeName("Current Jump Cube");
    setCubeDescription("");
    setSelectedPacks([]);
    setSavedCubeId(null);
    setCubeSaveStatus("");
  }

  const saveCurrentCube = useCallback(async function saveCurrentCube() {
    if (selectedPacks.length === 0 && !savedCubeId) return;

    setCubeSaveStatus("saving");

    const cubeId = await saveUserCube({
      cubeId: savedCubeId,
      name: normalizeTitle(cubeName, "Unnamed Cube"),
      description: cubeDescription.trim(),
      packs: selectedPacks,
    });

    if (!cubeId) {
      setCubeSaveStatus("error");
      return;
    }

    setSavedCubeId(cubeId);
    setCubeSaveStatus("saved");

    setTimeout(() => setCubeSaveStatus(""), 2000);
  }, [
    cubeDescription,
    cubeName,
    savedCubeId,
    saveUserCube,
    selectedPacks,
  ]);

  async function openCube(cubeId) {
    const cube = await userCubes.loadCube(cubeId);

    if (!cube) return;

    setSavedCubeId(cube.id);
    setCubeName(normalizeTitle(cube.name, "Current Jump Cube"));
    setCubeDescription(cube.description || "");
    setSelectedPacks(cube.packs || []);
    setIsCubeLibraryOpen(false);
  }

  useEffect(() => {
    if (selectedPacks.length === 0 && !savedCubeId) return undefined;

    const timeoutId = window.setTimeout(() => {
      saveCurrentCube();
    }, 800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [cubeDescription, cubeName, savedCubeId, saveCurrentCube, selectedPacks]);

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

  useEffect(() => {
    let animationFrame = null;

    function updateSidePanelTop() {
      if (animationFrame) return;

      animationFrame = window.requestAnimationFrame(() => {
        const navBar = document.querySelector(".navBar");
        const mobilePanelNav = document.querySelector(".mobilePanelNav");
        const navBottom = navBar?.getBoundingClientRect().bottom || 0;
        const mobilePanelNavBottom =
          mobilePanelNav?.getBoundingClientRect().bottom || 0;
        const sidePanelTop = Math.max(navBottom, mobilePanelNavBottom);
        const visibleSidePanelTop = Math.max(0, Math.round(sidePanelTop));

        document.documentElement.style.setProperty(
          "--side-panel-top",
          `${visibleSidePanelTop}px`,
        );

        animationFrame = null;
      });
    }

    updateSidePanelTop();
    window.addEventListener("scroll", updateSidePanelTop, { passive: true });
    window.addEventListener("resize", updateSidePanelTop);

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }

      window.removeEventListener("scroll", updateSidePanelTop);
      window.removeEventListener("resize", updateSidePanelTop);
      document.documentElement.style.removeProperty("--side-panel-top");
    };
  }, []);

  return (
    <main className="app">
      <NavBar
        user={user}
        onLogout={handleLogout}
      />

      <nav className="mobilePanelNav" aria-label="Builder panels">
        <button
          type="button"
          className={isJumpCubeBoxOpen ? "active" : ""}
          onClick={() => {
            setIsJumpCubeBoxOpen((current) => !current);
            setIsPackBoxOpen(false);
          }}
          aria-pressed={isJumpCubeBoxOpen}
        >
          Cube
        </button>

        <button
          type="button"
          className={isPackBoxOpen ? "active" : ""}
          onClick={() => {
            setIsPackBoxOpen((current) => !current);
            setIsJumpCubeBoxOpen(false);
          }}
          aria-pressed={isPackBoxOpen}
        >
          Pack
        </button>
      </nav>

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
                  addCurrentPackToCube={addCurrentPackToCube}
                  onOpenPacks={() => setIsPackLibraryOpen(true)}
                  deletePack={pack.deletePack}
                  savedPackId={pack.savedPackId}
                  newPack={pack.newPack}
                  saveStatus={pack.saveStatus}
                  showRenameChoice={pack.showRenameChoice}
                  pendingSaveAction={pack.pendingSaveAction}
                  moveCard={pack.moveCard}
                  isDraggingCard={isDraggingCard}
                  isOpen={isPackBoxOpen}
                  setIsOpen={setIsPackBoxOpen}
                />
                <JumpCubeBox
                  cubeName={cubeName}
                  setCubeName={setCubeName}
                  cubeDescription={cubeDescription}
                  setCubeDescription={setCubeDescription}
                  selectedPacks={selectedPacks}
                  onOpenCubes={() => setIsCubeLibraryOpen(true)}
                  onOpenPack={openCubePack}
                  removePackFromCube={removePackFromCube}
                  newCube={newCube}
                  saveStatus={cubeSaveStatus}
                  isOpen={isJumpCubeBoxOpen}
                  setIsOpen={setIsJumpCubeBoxOpen}
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

              <CubeLibraryModal
                isOpen={isCubeLibraryOpen}
                cubes={userCubes.cubes}
                onClose={() => setIsCubeLibraryOpen(false)}
                onOpenCube={openCube}
                onDeleteCube={async (cubeId) => {
                  await userCubes.deleteCube(cubeId);

                  if (savedCubeId === cubeId) {
                    newCube();
                  }
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
