import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "./utils/supabase";
import { useCards } from "./hooks/useCards";
import { usePackBuilder } from "./hooks/usePackBuilder";
import { useAuth } from "./hooks/useAuth";
import { useUserPacks } from "./hooks/useUserPacks";
import { useUserCubes } from "./hooks/useUserCubes";
import { useCollection } from "./hooks/useCollection";
import { useSets } from "./hooks/useSets";
import AuthPage from "./pages/AuthPage/AuthPage";
import AuthCallbackPage from "./pages/AuthCallbackPage/AuthCallbackPage";
import ProfilePage from "./pages/ProfilePage/ProfilePage";
import SecretManagerPage from "./pages/SecretManagerPage/SecretManagerPage";
import DiscoverPage from "./pages/DiscoverPage/DiscoverPage";
import PublicItemPage from "./pages/PublicItemPage/PublicItemPage";
import CollectionPage from "./pages/CollectionPage/CollectionPage";
import SearchBox from "./components/SearchBox/SearchBox";
import FilterBox from "./components/FilterBox/FilterBox";
import CardBox from "./components/CardBox/CardBox";
import CardModal from "./components/CardModal/CardModal";
import PackBox from "./components/PackBox/PackBox";
import PackLibraryModal from "./components/PackLibraryModal/PackLibraryModal";
import CubeLibraryModal from "./components/CubeLibraryModal/CubeLibraryModal";
import JumpCubeBox from "./components/JumpCubeBox/JumpCubeBox";
import NavBar from "./components/NavBar/NavBar";
import AuthRequiredModal from "./components/AuthRequiredModal/AuthRequiredModal";
import UsernameRequiredModal from "./components/UsernameRequiredModal/UsernameRequiredModal";
import {
  sanitizeDescription,
  sanitizeTitle,
} from "./utils/userText";
import { copyPublicPack } from "./services/discoveryService";
import {
  takePendingOpenPack,
  takePendingSharedPackCopy,
} from "./utils/sharedPackCopy";

import "./App.css";

/*
 * App.jsx is the top-level coordinator for Jump Cube.
 *
 * It owns page-wide state that multiple panels need to share:
 * - search/filter input for the card grid
 * - the active PackBox state returned by usePackBuilder()
 * - the active JumpCubeBox state, including selected pack summaries
 * - modal visibility for pack/cube libraries and card details
 *
 * Most child components are intentionally "controlled": this file passes the
 * current value plus setter/callback props. When adding a new global workflow,
 * prefer placing the shared state here and passing only the narrow callback a
 * child needs.
 */

const MOBILE_PANEL_QUERY = "(max-width: 760px)";
const FALLBACK_FROG_BACKGROUND = `${import.meta.env.BASE_URL}images/frogCube.png`;

// Used for pack/cube names before they are saved. Update userText.js if the
// database constraint changes.
function normalizeTitle(title, fallback) {
  return sanitizeTitle(title, fallback);
}

function getCubeSnapshot(name, description, visibility, packs) {
  /*
   * Snapshot shape:
   * {
   *   name: string,
   *   description: string,
   *   packs: Array<pack id>
   * }
   *
   * The cube autosave effect compares this string against the last saved
   * version so it can skip writes when nothing meaningful changed.
   */
  return JSON.stringify({
    name: normalizeTitle(name, "Unnamed Cube"),
    description: sanitizeDescription(description),
    visibility: visibility === "public" ? "public" : "private",
    packs: packs.map((pack) => pack.savedPackId || pack.id),
  });
}

function getPackSummary({
  id,
  name,
  description,
  archetypeTags,
  visibility,
  cards,
}) {
  /*
   * Input arguments describe the current pack UI state. Output is the compact
   * object JumpCubeBox needs to render one pack item:
   * {
   *   id/savedPackId: database pack id,
   *   name/description/visibility/archetypeTags,
   *   cardCount,
   *   colorIdentity,
   *   cards: selected cards with quantity
   * }
   *
   * If the cube pack item needs new derived display data, add it here and in
   * useUserCubes.buildPackSummary() so loaded cubes and live cubes match.
   */
  const normalizedCards = cards || [];
  const colorIdentity = [
    ...new Set(
      normalizedCards.flatMap((card) => card.color_identity || []),
    ),
  ];
  const cardCount = normalizedCards.reduce(
    (sum, card) => sum + card.quantity,
    0,
  );

  return {
    id,
    name: normalizeTitle(name, "Unnamed Pack"),
    description: sanitizeDescription(description),
    archetypeTags: archetypeTags || [],
    visibility: visibility || "private",
    cardCount,
    colorIdentity,
    savedPackId: id,
    cards: normalizedCards,
  };
}

function getCardArt(card) {
  // Scryfall random cards can provide images either at top-level or per-face.
  return (
    card?.image_uris?.art_crop ||
    card?.image_uris?.normal ||
    card?.card_faces?.find((face) => face.image_uris)?.image_uris?.art_crop ||
    card?.card_faces?.find((face) => face.image_uris)?.image_uris?.normal ||
    null
  );
}

function getSavedCardImage(card) {
  return card?.image_url || card?.image_uris?.art_crop || card?.image_uris?.normal || null;
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  /*
   * Hook outputs:
   * - useAuth(): { user, session, authLoading }
   * - useUserPacks(): saved pack library list + reload callback
   * - useUserCubes(): saved cube library functions
   * - useCards(): current search results and pagination callback
   * - usePackBuilder(): active pack state plus pack mutations
   */
  const {
    user,
    profile,
    displayName,
    profileLoading,
    isAdmin,
    adminLoading,
    setProfile,
  } = useAuth();
  const { sets } = useSets();
  const { packs, loadPacks } = useUserPacks(user);
  const userCubes = useUserCubes(user);
  const collection = useCollection(user);
  const { saveCube: saveUserCube } = userCubes;

  const [isPackLibraryOpen, setIsPackLibraryOpen] = useState(false);
  const [isCubeLibraryOpen, setIsCubeLibraryOpen] = useState(false);
  const [isAuthRequiredOpen, setIsAuthRequiredOpen] = useState(false);

  const [isDraggingCard, setIsDraggingCard] = useState(false);
  const [modalCard, setModalCard] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [manaValues, setManaValues] = useState([]);
  const [colors, setColors] = useState([]);
  const [colorMode, setColorMode] = useState("or");
  const [rarities, setRarities] = useState([]);
  const [types, setTypes] = useState([]);
  const [formats, setFormats] = useState([]);
  const [includeOwned, setIncludeOwned] = useState(false);
  const [includeUnowned, setIncludeUnowned] = useState(true);
  const [ownershipWarningNonce, setOwnershipWarningNonce] = useState(0);
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
  const [cubeVisibility, setCubeVisibility] = useState("private");
  const [selectedPacks, setSelectedPacks] = useState([]);
  const [savedCubeId, setSavedCubeId] = useState(null);
  const [cubeSaveStatus, setCubeSaveStatus] = useState("");
  const [selectedSets, setSelectedSets] = useState([]);
  const [frogBackground, setFrogBackground] = useState(
    FALLBACK_FROG_BACKGROUND,
  );
  const lastSavedCubeSnapshotRef = useRef(null);
  const pendingSharedPackCopyRef = useRef(false);
  const filterSearchSnapshot = JSON.stringify({
    manaValues,
    colors,
    colorMode,
    rarities,
    types,
    formats,
    selectedSets,
    includeOwned,
    includeUnowned,
  });
  const lastFilterSearchSnapshotRef = useRef(filterSearchSnapshot);

  // Called by usePackBuilder after an autosave/manual save succeeds. It keeps
  // the currently open cube item in sync with pack name, cards, colors,
  // archetypes, description, and visibility.
  const syncPackIntoCurrentCube = useCallback((packSummary) => {
    if (!packSummary?.id) return;

    setSelectedPacks((currentPacks) =>
      currentPacks.map((selectedPack) => {
        const selectedPackId = selectedPack.savedPackId || selectedPack.id;

        return selectedPackId === packSummary.id
          ? { ...selectedPack, ...packSummary }
          : selectedPack;
      }),
    );
  }, []);

  // Called when a pack is deleted from either the PackBox or pack library.
  // Removing locally lets the cube autosave drop the cube_packs relationship.
  const removePackFromCurrentCube = useCallback((packId) => {
    if (!packId) return;

    setSelectedPacks((currentPacks) =>
      currentPacks.filter((selectedPack) => {
        const selectedPackId = selectedPack.savedPackId || selectedPack.id;

        return selectedPackId !== packId;
      }),
    );
  }, []);

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
    hasCollection: collection.hasCollection,
    includeOwned,
    includeUnowned,
    limit: 50,
  });
  const pack = usePackBuilder(user, loadPacks, {
    onPackSaved: syncPackIntoCurrentCube,
    onPackDeleted: removePackFromCurrentCube,
  });

  useEffect(() => {
    if (!user?.id || pendingSharedPackCopyRef.current) return;

    async function finishPendingSharedPackCopy() {
      pendingSharedPackCopyRef.current = true;

      try {
        const pendingOpenPackId = takePendingOpenPack();

        if (pendingOpenPackId) {
          await pack.loadPack(pendingOpenPackId);
          await loadPacks();
          setIsPackBoxOpen(true);
          setIsJumpCubeBoxOpen(false);
          navigate("/", { replace: true });
          return;
        }

        const sourcePackId = takePendingSharedPackCopy();

        if (!sourcePackId) return;

        const copiedPackId = await copyPublicPack(sourcePackId, user.id);

        if (!copiedPackId) return;

        await Promise.all([pack.loadPack(copiedPackId), loadPacks()]);
        setIsPackBoxOpen(true);
        setIsJumpCubeBoxOpen(false);
        navigate("/", { replace: true });
      } catch (error) {
        console.error("Error finishing pending shared pack copy:", error);
      } finally {
        pendingSharedPackCopyRef.current = false;
      }
    }

    finishPendingSharedPackCopy();
  }, [loadPacks, navigate, pack, user]);
  function requireAuth() {
    if (user) return true;

    setIsAuthRequiredOpen(true);
    return false;
  }

  async function handleLogout() {
    // Sign out through Supabase, then clear local UI that should not survive
    // into an anonymous session.
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Error logging out:", error);
      return;
    }

    setIsPackLibraryOpen(false);
    setIsCubeLibraryOpen(false);
    pack.newPack();
  }

  async function copyShareLink(kind, id) {
    if (!id || typeof window === "undefined") return false;

    const basePath = import.meta.env.BASE_URL || "/";
    const url = new URL(`${basePath}${kind}s/${id}`, window.location.origin);

    try {
      await window.navigator.clipboard.writeText(url.toString());
      return true;
    } catch (error) {
      console.error("Error copying share link:", error);
      window.prompt("Copy this share link", url.toString());
      return false;
    }
  }

  function submitSearch() {
    // Keeps typing separate from committed search so users can edit without
    // firing a new query until submit.
    if (collection.hasCollection && !includeOwned && !includeUnowned) {
      setOwnershipWarningNonce((current) => current + 1);
      return;
    }

    setSearch(searchInput.trim());
  }

  useEffect(() => {
    /*
     * Filter changes are search submissions too. This keeps the committed
     * query in sync with the visible input, including when the user clears the
     * text box and then selects a filter.
     */
    if (lastFilterSearchSnapshotRef.current === filterSearchSnapshot) {
      return;
    }

    lastFilterSearchSnapshotRef.current = filterSearchSnapshot;
    setSearch(searchInput.trim());
  }, [filterSearchSnapshot, searchInput]);

  async function saveCurrentPackBeforeLeaving() {
    // Protects edits when opening another pack or starting a new one.
    if (pack.selectedCards.length === 0) return;
    if (!requireAuth()) return;

    await pack.savePack({ promptOnRename: false });
  }

  async function addCurrentPackToCube() {
    // Pack must exist in the database before cube_packs can point at it.
    if (pack.selectedCards.length === 0) return;
    if (!requireAuth()) return;

    const savedPackId = await pack.savePack({ promptOnRename: false });

    if (!savedPackId) return;

    const packSummary = getPackSummary({
      id: savedPackId,
      name: normalizeTitle(pack.packName, "Unnamed Pack"),
      description: sanitizeDescription(pack.packDescription),
      archetypeTags: pack.packArchetypeTags,
      visibility: pack.packVisibility,
      cards: pack.selectedCards,
    });

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
    removePackFromCurrentCube(packId);
  }

  function movePackInCube(draggedPackId, targetPackId) {
    if (!draggedPackId || draggedPackId === targetPackId) return;
    setSelectedPacks((currentPacks) => {
      const draggedIndex = currentPacks.findIndex((item) => String(item.id) === String(draggedPackId));
      const targetIndex = currentPacks.findIndex((item) => String(item.id) === String(targetPackId));
      if (draggedIndex === -1 || targetIndex === -1) return currentPacks;
      const reordered = [...currentPacks];
      const [draggedPack] = reordered.splice(draggedIndex, 1);
      reordered.splice(targetIndex, 0, draggedPack);
      return reordered;
    });
  }

  async function openCubePack(packId) {
    // Opening from the cube loads the pack into PackBox; mobile gets a full
    // screen panel swap so the selected pack is immediately visible.
    if (!requireAuth()) return;

    await saveCurrentPackBeforeLeaving();
    await pack.loadPack(packId);
    setIsPackBoxOpen(true);

    if (window.matchMedia(MOBILE_PANEL_QUERY).matches) {
      setIsJumpCubeBoxOpen(false);
    }
  }

  async function startNewPack() {
    if (!requireAuth()) return;

    await saveCurrentPackBeforeLeaving();
    pack.newPack();
  }

  function newCube() {
    if (!requireAuth()) return;

    setCubeName("Current Jump Cube");
    setCubeDescription("");
    setCubeVisibility("private");
    setSelectedPacks([]);
    setSavedCubeId(null);
    setCubeSaveStatus("");
    lastSavedCubeSnapshotRef.current = null;
  }

  const saveCurrentCube = useCallback(async function saveCurrentCube() {
    /*
     * Persists cube metadata and pack relationships.
     * Arguments passed to useUserCubes.saveCube:
     * {
     *   cubeId: string | null,
     *   name: string,
     *   description: string,
     *   packs: Array<pack summary with savedPackId/id>
     * }
     */
    if (selectedPacks.length === 0 && !savedCubeId) return;

    const currentSnapshot = getCubeSnapshot(
      cubeName,
      cubeDescription,
      cubeVisibility,
      selectedPacks,
    );

    if (savedCubeId && currentSnapshot === lastSavedCubeSnapshotRef.current) {
      return;
    }

    setCubeSaveStatus("saving");

    const cubeId = await saveUserCube({
      cubeId: savedCubeId,
      name: normalizeTitle(cubeName, "Unnamed Cube"),
      description: sanitizeDescription(cubeDescription),
      visibility: cubeVisibility,
      coverImageUrl: getSavedCardImage(selectedPacks[0]?.cards?.at(-1)),
      packs: selectedPacks,
    });

    if (!cubeId) {
      setCubeSaveStatus("error");
      return;
    }

    setSavedCubeId(cubeId);
    lastSavedCubeSnapshotRef.current = currentSnapshot;
    setCubeSaveStatus("saved");

    setTimeout(() => setCubeSaveStatus(""), 2000);
  }, [
    cubeDescription,
    cubeVisibility,
    cubeName,
    savedCubeId,
    saveUserCube,
    selectedPacks,
  ]);

  async function openCube(cubeId) {
    // loadCube returns cube metadata plus hydrated pack summaries.
    if (!requireAuth()) return;

    const cube = await userCubes.loadCube(cubeId);

    if (!cube) return;

    setSavedCubeId(cube.id);
    setCubeName(normalizeTitle(cube.name, "Current Jump Cube"));
    setCubeDescription(cube.description || "");
    setCubeVisibility(cube.visibility === "public" ? "public" : "private");
    setSelectedPacks(cube.packs || []);
    lastSavedCubeSnapshotRef.current = getCubeSnapshot(
      cube.name || "Current Jump Cube",
      cube.description || "",
      cube.visibility,
      cube.packs || [],
    );
    setIsCubeLibraryOpen(false);
  }

  useEffect(() => {
    // Debounced cube autosave. The snapshot prevents repeated saves from the
    // same state while still catching pack reorder/removal/name edits.
    if (selectedPacks.length === 0 && !savedCubeId) return undefined;

    const currentSnapshot = getCubeSnapshot(
      cubeName,
      cubeDescription,
      cubeVisibility,
      selectedPacks,
    );

    if (savedCubeId && currentSnapshot === lastSavedCubeSnapshotRef.current) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      saveCurrentCube();
    }, 800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [cubeDescription, cubeName, cubeVisibility, savedCubeId, saveCurrentCube, selectedPacks]);

  useEffect(() => {
    // Infinite scroll for the card grid. loadMoreCards is internally guarded
    // against concurrent loads and no-more-results state.
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
    // Decorative search-area background: random non-funny Frog creature art.
    // FALLBACK_FROG_BACKGROUND keeps the UI usable if Scryfall is unavailable.
    let isCurrent = true;

    async function loadRandomFrogBackground() {
      try {
        const response = await fetch(
          "https://api.scryfall.com/cards/random?q=t%3Afrog%20t%3Acreature%20-is%3Afunny",
        );

        if (!response.ok) return;

        const card = await response.json();
        const cardArt = getCardArt(card);

        if (isCurrent && cardArt) {
          setFrogBackground(cardArt);
        }
      } catch (error) {
        console.error("Error loading random Frog background:", error);
      }
    }

    loadRandomFrogBackground();

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    // Side panels sit below the visible nav. This updates a CSS variable as the
    // nav scrolls in/out so PackBox and JumpCubeBox move smoothly with it.
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
    <main
      className="app"
      style={{ "--frog-background-image": `url("${frogBackground}")` }}
    >
      <NavBar
        user={user}
        displayName={displayName}
        isAdmin={isAdmin}
      />

      <AuthRequiredModal
        isOpen={isAuthRequiredOpen}
        onClose={() => setIsAuthRequiredOpen(false)}
      />

      {user && !profileLoading && !profile?.username && (
        <UsernameRequiredModal
          user={user}
          onProfileSaved={setProfile}
        />
      )}

      {location.pathname === "/" && (
      <nav className="mobilePanelNav" aria-label="Builder panels">
        <button
          type="button"
          className={isJumpCubeBoxOpen ? "active" : ""}
          onClick={() => {
            if (!requireAuth()) return;

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
      )}

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
                    hasCollection={collection.hasCollection}
                    includeOwned={includeOwned}
                    setIncludeOwned={setIncludeOwned}
                    includeUnowned={includeUnowned}
                    setIncludeUnowned={setIncludeUnowned}
                    ownershipWarningNonce={ownershipWarningNonce}
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
                      <CardBox
                        cards={cardList}
                        onCardOpen={setModalCard}
                        selectedCards={pack.selectedCards}
                        onCardAdd={pack.addCardToPack}
                        onCardDecrease={pack.decreaseCardQuantity}
                        setIsDraggingCard={setIsDraggingCard}
                        isSelectionDisabled={pack.isPackFull}
                        ownedQuantities={collection.quantitiesByCardSearchId}
                      />
                      {loadingMoreCards && <p>Loading more cards...</p>}

                      {!hasMoreCards && cardList.length > 0 && (
                        <p>No more results.</p>
                      )}

                      {collection.hasCollection &&
                        !includeOwned &&
                        !includeUnowned && (
                          <p className="ownershipFilterMessage" role="status">
                            Select Owned or Unowned in the Ownership filter.
                          </p>
                        )}
                    </>
                  )}
                </section>
                <PackBox
                  packName={pack.packName}
                  setPackName={pack.setPackName}
                  packDescription={pack.packDescription}
                  setPackDescription={pack.setPackDescription}
                  packArchetypeTags={pack.packArchetypeTags}
                  setPackArchetypeTags={pack.setPackArchetypeTags}
                  availablePackTags={pack.availablePackTags}
                  createPackTag={pack.createPackTag}
                  packTagLimit={pack.packTagLimit}
                  packVisibility={pack.packVisibility}
                  setPackVisibility={pack.setPackVisibility}
                  selectedCards={pack.selectedCards}
                  addCard={pack.addCardToPack}
                  decreaseCardQuantity={pack.decreaseCardQuantity}
                  onCardOpen={setModalCard}
                  addCurrentPackToCube={addCurrentPackToCube}
                  onOpenPacks={() => {
                    if (!requireAuth()) return;
                    setIsPackLibraryOpen(true);
                  }}
                  deletePack={async (packId) => {
                    if (!requireAuth()) return;
                    await pack.deletePack(packId);
                  }}
                  savedPackId={pack.savedPackId}
                  onSharePack={(packId) => copyShareLink("pack", packId)}
                  newPack={startNewPack}
                  saveStatus={pack.saveStatus}
                  saveErrorMessage={pack.saveErrorMessage}
                  showRenameChoice={pack.showRenameChoice}
                  pendingSaveAction={pack.pendingSaveAction}
                  moveCard={pack.moveCard}
                  moveCardToMechanicBucket={pack.moveCardToMechanicBucket}
                  isDraggingCard={isDraggingCard}
                  isOpen={isPackBoxOpen}
                  setIsOpen={setIsPackBoxOpen}
                  isAuthenticated={Boolean(user)}
                  onAuthRequired={() => setIsAuthRequiredOpen(true)}
                />
                <JumpCubeBox
                  cubeName={cubeName}
                  setCubeName={setCubeName}
                  cubeDescription={cubeDescription}
                  setCubeDescription={setCubeDescription}
                  cubeVisibility={cubeVisibility}
                  setCubeVisibility={setCubeVisibility}
                  selectedPacks={selectedPacks}
                  onOpenCubes={() => {
                    if (!requireAuth()) return;
                    setIsCubeLibraryOpen(true);
                  }}
                  onOpenPack={openCubePack}
                  removePackFromCube={removePackFromCube}
                  movePackInCube={movePackInCube}
                  newCube={newCube}
                  savedCubeId={savedCubeId}
                  onShareCube={(cubeId) => copyShareLink("cube", cubeId)}
                  saveStatus={cubeSaveStatus}
                  saveErrorMessage={userCubes.cubeSaveError}
                  isOpen={isJumpCubeBoxOpen}
                  setIsOpen={setIsJumpCubeBoxOpen}
                  isAuthenticated={Boolean(user)}
                  onAuthRequired={() => setIsAuthRequiredOpen(true)}
                />
              </div>

              <PackLibraryModal
                isOpen={isPackLibraryOpen}
                packs={packs}
                onClose={() => setIsPackLibraryOpen(false)}
                onOpenPack={async (packId) => {
                  if (!requireAuth()) return;
                  await saveCurrentPackBeforeLeaving();
                  await pack.loadPack(packId);
                  setIsPackLibraryOpen(false);
                }}
                onDeletePack={async (packId) => {
                  if (!requireAuth()) return;
                  await pack.deletePack(packId);
                  await loadPacks();
                }}
                onDuplicatePack={async (packId) => {
                  if (!requireAuth()) return;
                  await pack.duplicatePack(packId);
                }}
                onSharePack={(packId) => copyShareLink("pack", packId)}
                cubePackIds={selectedPacks.map(
                  (selectedPack) => selectedPack.savedPackId || selectedPack.id,
                )}
                onAddPacksToCube={async (packIds) => {
                  if (!requireAuth()) return;

                  const existingIds = new Set(
                    selectedPacks.map(
                      (selectedPack) =>
                        selectedPack.savedPackId || selectedPack.id,
                    ),
                  );
                  const newPackIds = packIds.filter(
                    (packId) => !existingIds.has(packId),
                  );
                  const packSummaries =
                    await userCubes.loadPackSummaries(newPackIds);

                  setSelectedPacks((currentPacks) => [
                    ...currentPacks,
                    ...packSummaries,
                  ]);
                }}
              />

              <CubeLibraryModal
                isOpen={isCubeLibraryOpen}
                cubes={userCubes.cubes}
                onClose={() => setIsCubeLibraryOpen(false)}
                onOpenCube={openCube}
                onShareCube={(cubeId) => copyShareLink("cube", cubeId)}
                onDeleteCube={async (cubeId) => {
                  if (!requireAuth()) return;
                  await userCubes.deleteCube(cubeId);

                  if (savedCubeId === cubeId) {
                    newCube();
                  }
                }}
              />

              <CardModal
                key={modalCard?.id || "card-modal"}
                isOpen={Boolean(modalCard)}
                card={modalCard}
                onClose={() => setModalCard(null)}
                onAddToPack={pack.addCardToPack}
                onDecreaseFromPack={pack.decreaseCardQuantity}
                selectedCards={pack.selectedCards}
                isPackFull={pack.isPackFull}
              />
            </>
          }
        />

        <Route path="/auth" element={<AuthPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route
          path="/discover"
          element={
            <DiscoverPage
              user={user}
              onAuthRequired={() => setIsAuthRequiredOpen(true)}
              onLibraryChanged={async () => {
                await Promise.all([loadPacks(), userCubes.loadCubes()]);
              }}
            />
          }
        />
        <Route
          path="/packs/:id"
          element={
            <PublicItemPage
              type="pack"
              user={user}
              onAuthRequired={() => setIsAuthRequiredOpen(true)}
              onLibraryChanged={async () => {
                await Promise.all([loadPacks(), userCubes.loadCubes()]);
              }}
            />
          }
        />
        <Route
          path="/cubes/:id"
          element={
            <PublicItemPage
              type="cube"
              user={user}
              onAuthRequired={() => setIsAuthRequiredOpen(true)}
              onLibraryChanged={async () => {
                await Promise.all([loadPacks(), userCubes.loadCubes()]);
              }}
            />
          }
        />
        <Route
          path="/profile"
          element={
            user ? (
              <ProfilePage
                key={profile?.username || "missing-profile"}
                user={user}
                profile={profile}
                profileLoading={profileLoading}
                onProfileSaved={setProfile}
                onLogout={handleLogout}
              />
            ) : (
              <Navigate to="/auth?mode=signup" replace />
            )
          }
        />
        <Route
          path="/secret-manager"
          element={
            user && !adminLoading && isAdmin ? (
              <SecretManagerPage />
            ) : (
              <Navigate to={user ? "/" : "/auth?mode=signup"} replace />
            )
          }
        />
        <Route
          path="/collection"
          element={
            user ? (
              <CollectionPage
                collectionItems={collection.collectionItems}
                loadingCollection={collection.loadingCollection}
                collectionError={collection.collectionError}
                onCollectionChanged={collection.refreshCollection}
              />
            ) : (
              <Navigate to="/auth?mode=signup" replace />
            )
          }
        />
      </Routes>
    </main>
  );
}

export default App;
