import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "./utils/supabase";
import { useCards } from "./hooks/useCards";
import { DRAFT_PACK_NAME, usePackBuilder } from "./hooks/usePackBuilder";
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
import SampleDraftPage from "./pages/SampleDraftPage/SampleDraftPage";
import PackPrintablesPage from "./pages/PackPrintablesPage/PackPrintablesPage";
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
import {
  buildPackCubeStats,
  normalizeColorIdentity,
  normalizeColorPercentages,
  normalizeStoredPackCubeStats,
} from "./utils/packCubeStats";
import { copyPublicPack } from "./services/discoveryService";
import {
  convertArenaDeckToPack,
  convertArenaCommanderDeckToPack,
  convertMtgoDekToPack,
  convertMtgoCommanderDeckToPack,
} from "./services/deckConversionService";
import {
  takePendingOpenPack,
  takePendingSharedPackCopy,
} from "./utils/sharedPackCopy";
import { getPackFormat } from "./utils/packFormats";
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
const COMMANDER_CREATURE_SEARCH = "t:legendary (t:creature or t:planeswalker)";

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
    packs: packs.map((pack) => ({
      id: pack.savedPackId || pack.id,
      formatId: getPackFormat(pack.formatId).id,
    })),
  });
}

function getCubeFormatId(packs) {
  return getPackFormat(packs.find((pack) => pack.formatId)?.formatId).id;
}

function canAddPackToCubeFormat(currentPacks, nextPack) {
  if (!nextPack) return false;
  if (currentPacks.length === 0) return true;

  return getCubeFormatId(currentPacks) === getPackFormat(nextPack.formatId).id;
}

function getCubeFormatCompatiblePacks(currentPacks, nextPacks) {
  const acceptedPacks = [...currentPacks];
  const compatiblePacks = [];

  nextPacks.forEach((nextPack) => {
    if (!canAddPackToCubeFormat(acceptedPacks, nextPack)) return;

    acceptedPacks.push(nextPack);
    compatiblePacks.push(nextPack);
  });

  return compatiblePacks;
}

function getPackSummary({
  id,
  name,
  description,
  archetypeTags,
  visibility,
  cards,
  formatId,
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
  const cubeStats = buildPackCubeStats(normalizedCards);

  return {
    id,
    name: normalizeTitle(name, "Unnamed Pack"),
    description: sanitizeDescription(description),
    archetypeTags: archetypeTags || [],
    visibility: visibility || "private",
    cardCount: cubeStats.cardCount,
    colorIdentity: cubeStats.colorIdentity,
    colorPercentages: cubeStats.colorPercentages,
    cubeStats,
    formatId: getPackFormat(formatId).id,
    savedPackId: id,
    cards: normalizedCards,
  };
}

function isDraftPackName(name) {
  return normalizeTitle(name, DRAFT_PACK_NAME) === DRAFT_PACK_NAME;
}

function getSavedCardImage(card) {
  return card?.image_url || card?.image_uris?.normal || card?.image_uris?.small || null;
}

function getSavedPackCoverImage(pack) {
  return pack?.coverImageUrl || getSavedCardImage(pack?.cards?.at(-1));
}

function mergeCubePackWithLibraryRow(packSummary, libraryPack) {
  if (!libraryPack) return packSummary;

  const summaryStats =
    normalizeStoredPackCubeStats(packSummary.cubeStats) ||
    normalizeStoredPackCubeStats(packSummary.cube_stats);
  const libraryStats = normalizeStoredPackCubeStats(libraryPack.cube_stats);
  const cubeStats = summaryStats || libraryStats;
  const colorIdentity = [
    normalizeColorIdentity(packSummary.colorIdentity),
    normalizeColorIdentity(packSummary.color_identity),
    normalizeColorIdentity(summaryStats?.colorIdentity),
    normalizeColorIdentity(libraryPack.color_identity),
    normalizeColorIdentity(libraryStats?.colorIdentity),
  ].find((colors) => colors.length > 0) || [];
  const colorPercentages =
    normalizeColorPercentages(packSummary.colorPercentages) ||
    normalizeColorPercentages(packSummary.color_percentages) ||
    normalizeColorPercentages(summaryStats?.colorPercentages) ||
    normalizeColorPercentages(libraryPack.color_percentages) ||
    normalizeColorPercentages(libraryStats?.colorPercentages) ||
    {};

  return {
    ...packSummary,
    coverImageUrl: packSummary.coverImageUrl || libraryPack.cover_image_url || null,
    cardCount: cubeStats?.cardCount || packSummary.cardCount,
    colorIdentity,
    colorPercentages,
    cubeStats: cubeStats || packSummary.cubeStats || libraryPack.cube_stats || null,
    color_identity: colorIdentity,
    color_percentages: colorPercentages,
    cube_stats: cubeStats || packSummary.cube_stats || libraryPack.cube_stats || null,
  };
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
  const {
    packs,
    packsLoaded,
    packsLoadedUserId,
    loadPacks,
  } = useUserPacks(user);
  const userCubes = useUserCubes(user);
  const collection = useCollection(user);
  const {
    saveCube: saveUserCube,
    loadCube: loadUserCube,
    loadPackSummaries,
  } = userCubes;

  const [isPackLibraryOpen, setIsPackLibraryOpen] = useState(false);
  const [isCubeLibraryOpen, setIsCubeLibraryOpen] = useState(false);
  const [isAuthRequiredOpen, setIsAuthRequiredOpen] = useState(false);
  const [isDraggingCard, setIsDraggingCard] = useState(false);
  const [modalCard, setModalCard] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [searchScopes, setSearchScopes] = useState({
    title: true,
    type: true,
    text: true,
  });
  const [manaValues, setManaValues] = useState([]);
  const [colors, setColors] = useState([]);
  const [colorMode, setColorMode] = useState("or");
  const [rarities, setRarities] = useState([]);
  const [types, setTypes] = useState([]);
  const [formats, setFormats] = useState([]);
  const [includeOwned, setIncludeOwned] = useState(true);
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
  const [cubeName, setCubeName] = useState("");
  const [cubeDescription, setCubeDescription] = useState("");
  const [cubeVisibility, setCubeVisibility] = useState("private");
  const [selectedPacks, setSelectedPacks] = useState([]);
  const [savedCubeId, setSavedCubeId] = useState(null);
  const [isCubeActive, setIsCubeActive] = useState(false);
  const [cubeSaveStatus, setCubeSaveStatus] = useState("");
  const [isPackStatsOpen, setIsPackStatsOpen] = useState(false);
  const [isCubeStatsOpen, setIsCubeStatsOpen] = useState(false);
  const [printableSavedPacks, setPrintableSavedPacks] = useState([]);
  const [selectedSets, setSelectedSets] = useState([]);
  const frogBackground = FALLBACK_FROG_BACKGROUND;
  const lastSavedCubeSnapshotRef = useRef(null);
  const initializedCubeUserIdRef = useRef(null);
  const initializedPackUserIdRef = useRef(null);
  const pendingSharedPackCopyRef = useRef(false);
  const filterSearchSnapshot = JSON.stringify({
    manaValues,
    colors,
    colorMode,
    searchScopes,
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
    searchScopes,
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
    ownedCardKeys: collection.quantitiesByCardSearchId,
    limit: 50,
  });
  const pack = usePackBuilder(user, loadPacks, {
    onPackSaved: syncPackIntoCurrentCube,
    onPackDeleted: removePackFromCurrentCube,
  });
  const {
    loadPack: loadActivePack,
    clearActivePack,
  } = pack;

  useEffect(() => {
    if (!user?.id || pendingSharedPackCopyRef.current) return;

    async function finishPendingSharedPackCopy() {
      pendingSharedPackCopyRef.current = true;

      try {
        const pendingOpenPackId = takePendingOpenPack();

        if (pendingOpenPackId) {
          initializedPackUserIdRef.current = user.id;
          await loadActivePack(pendingOpenPackId);
          await loadPacks();
          setIsPackBoxOpen(true);
          setIsJumpCubeBoxOpen(false);
          navigate("/", { replace: true });
          return;
        }

        const sourcePackId = takePendingSharedPackCopy();

        if (!sourcePackId) return;

        initializedPackUserIdRef.current = user.id;
        const copiedPackId = await copyPublicPack(sourcePackId, user.id);

        if (!copiedPackId) return;

        await Promise.all([loadActivePack(copiedPackId), loadPacks()]);
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
  }, [loadActivePack, loadPacks, navigate, user]);

  useEffect(() => {
    if (!user?.id) {
      initializedPackUserIdRef.current = null;
      return undefined;
    }

    if (location.pathname !== "/create") {
      return undefined;
    }

    if (
      !packsLoaded ||
      packsLoadedUserId !== user.id ||
      initializedPackUserIdRef.current === user.id
    ) {
      return undefined;
    }

    initializedPackUserIdRef.current = user.id;
    const latestPack = packs[0];
    let isCurrent = true;

    const timeoutId = window.setTimeout(async () => {
      if (!isCurrent) return;

      if (latestPack?.id) {
        await loadActivePack(latestPack.id);
        return;
      }

      clearActivePack();
    }, 0);

    return () => {
      isCurrent = false;
      window.clearTimeout(timeoutId);
    };
  }, [
    clearActivePack,
    loadActivePack,
    location.pathname,
    packs,
    packsLoaded,
    packsLoadedUserId,
    user,
  ]);

  useEffect(() => {
    if (location.pathname !== "/printables") return undefined;

    let isCurrent = true;
    const packIds = packs.map((savedPack) => savedPack.id).filter(Boolean);

    async function loadPrintableSavedPacks() {
      if (!user?.id || !packsLoaded || packIds.length === 0) {
        if (isCurrent) setPrintableSavedPacks([]);
        return;
      }

      const packSummaries = await loadPackSummaries(packIds, {
        hydrateCards: true,
      });

      if (isCurrent) {
        setPrintableSavedPacks(packSummaries);
      }
    }

    loadPrintableSavedPacks();

    return () => {
      isCurrent = false;
    };
  }, [loadPackSummaries, location.pathname, packs, packsLoaded, user?.id]);

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
    clearActivePack();
    clearActiveCube();
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

  function handlePackFormatChange(nextFormatId) {
    const nextFormat = getPackFormat(nextFormatId);
    const activePackIds = new Set(
      [pack.savedPackId, "current-pack"].filter(Boolean),
    );
    const activePackIsInCube = selectedPacks.some((selectedPack) =>
      activePackIds.has(selectedPack.savedPackId || selectedPack.id),
    );
    const otherCubePacks = selectedPacks.filter(
      (selectedPack) =>
        !activePackIds.has(selectedPack.savedPackId || selectedPack.id),
    );

    if (
      activePackIsInCube &&
      otherCubePacks.length > 0 &&
      getCubeFormatId(otherCubePacks) !== nextFormat.id
    ) {
      window.alert(
        `This cube is a ${getPackFormat(getCubeFormatId(otherCubePacks)).name} cube. This pack cannot switch to ${nextFormat.name} while it is part of that cube.`,
      );
      return;
    }

    pack.setPackFormat(nextFormat.id);

    if (!nextFormat.commanderSlot) return;

    setSearchInput(COMMANDER_CREATURE_SEARCH);
    setSearch(COMMANDER_CREATURE_SEARCH);
    setManaValues([]);
    setColors([]);
    setColorMode("or");
    setRarities([]);
    setTypes([]);
    setFormats([]);
    setSelectedSets([]);
    setIncludeOwned(true);
    setIncludeUnowned(true);
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
    if (pack.selectedCards.length === 0) return true;
    if (!requireAuth()) return false;

    if (isDraftPackName(pack.packName)) {
      const nextName = window.prompt(
        "Name this draft pack before opening another pack.",
        "",
      );

      if (!nextName?.trim()) return false;

      const savedPackId = await pack.savePack({
        promptOnRename: false,
        nameOverride: nextName.trim(),
      });

      return Boolean(savedPackId);
    }

    const savedPackId = await pack.savePack({ promptOnRename: false });

    return Boolean(savedPackId);
  }

  async function addCurrentPackToCube() {
    // Pack must exist in the database before cube_packs can point at it.
    if (pack.selectedCards.length === 0) return;
    if (!requireAuth()) return;
    if (!isCubeActive) return;

    const nextPackFormatId = getPackFormat(pack.packFormatId).id;

    if (
      selectedPacks.length > 0 &&
      getCubeFormatId(selectedPacks) !== nextPackFormatId
    ) {
      window.alert(
        `This cube is a ${getPackFormat(getCubeFormatId(selectedPacks)).name} cube. Only packs with the same format can be added.`,
      );
      return;
    }

    const savedPackId = await pack.savePack({ promptOnRename: false });

    if (!savedPackId) return;

    const packSummary = getPackSummary({
      id: savedPackId,
      name: normalizeTitle(pack.packName, "Unnamed Pack"),
      description: sanitizeDescription(pack.packDescription),
      archetypeTags: pack.packArchetypeTags,
      visibility: pack.packVisibility,
      cards: pack.selectedCards,
      formatId: nextPackFormatId,
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

    if (!(await saveCurrentPackBeforeLeaving())) return;
    const cubePack = selectedPacks.find(
      (selectedPack) =>
        String(selectedPack.savedPackId || selectedPack.id) === String(packId),
    );
    const hasHydratedCubePackCards = Boolean(cubePack?.cardsHydrated);

    if (hasHydratedCubePackCards) {
      pack.openSavedPackFromSummary(cubePack);
    } else {
      const hydratedPack = await pack.loadPack(packId);

      if (hydratedPack) {
        setSelectedPacks((currentPacks) =>
          currentPacks.map((selectedPack) => {
            const selectedPackId = selectedPack.savedPackId || selectedPack.id;

            return String(selectedPackId) === String(packId)
              ? { ...selectedPack, ...hydratedPack }
              : selectedPack;
          }),
        );
      }
    }
    setIsPackBoxOpen(true);

    if (window.matchMedia(MOBILE_PANEL_QUERY).matches) {
      setIsJumpCubeBoxOpen(false);
    }
  }

  async function startNewPack() {
    if (!requireAuth()) return;

    if (!(await saveCurrentPackBeforeLeaving())) return;
    pack.newPack();
  }

  function newCube() {
    if (!requireAuth()) return;

    setIsCubeActive(true);
    setCubeName("");
    setCubeDescription("");
    setCubeVisibility("private");
    setSelectedPacks([]);
    setSavedCubeId(null);
    setCubeSaveStatus("");
    lastSavedCubeSnapshotRef.current = null;
  }

  const clearActiveCube = useCallback(() => {
    setIsCubeActive(false);
    setCubeName("");
    setCubeDescription("");
    setCubeVisibility("private");
    setSelectedPacks([]);
    setSavedCubeId(null);
    setCubeSaveStatus("");
    lastSavedCubeSnapshotRef.current = null;
  }, []);

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
    if (!isCubeActive) return;
    if (selectedPacks.length === 0 && !savedCubeId) return;
    if (
      selectedPacks.length !==
      getCubeFormatCompatiblePacks([], selectedPacks).length
    ) {
      setCubeSaveStatus("error");
      return;
    }

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
      coverImageUrl: getSavedPackCoverImage(selectedPacks[0]),
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
    isCubeActive,
    savedCubeId,
    saveUserCube,
    selectedPacks,
  ]);

  const openCube = useCallback(async function openCube(cubeId) {
    // loadCube returns cube metadata plus hydrated pack summaries.
    if (!user) {
      setIsAuthRequiredOpen(true);
      return;
    }

    const [cube, refreshedPacks] = await Promise.all([
      loadUserCube(cubeId),
      loadPacks(),
    ]);

    if (!cube) return;

    setIsCubeActive(true);
    setSavedCubeId(cube.id);
    setCubeName(normalizeTitle(cube.name, "Unnamed Cube"));
    setCubeDescription(cube.description || "");
    setCubeVisibility(cube.visibility === "public" ? "public" : "private");
    const libraryPacksById = new Map(
      (refreshedPacks?.length ? refreshedPacks : packs || []).map((packRow) => [
        packRow.id,
        packRow,
      ]),
    );
    const mergedCubePacks = (cube.packs || []).map((cubePack) =>
      mergeCubePackWithLibraryRow(
        cubePack,
        libraryPacksById.get(cubePack.savedPackId || cubePack.id),
      ),
    );

    setSelectedPacks(mergedCubePacks);
    lastSavedCubeSnapshotRef.current = getCubeSnapshot(
      cube.name || "Unnamed Cube",
      cube.description || "",
      cube.visibility,
      mergedCubePacks,
    );
    setIsCubeLibraryOpen(false);
  }, [loadPacks, loadUserCube, packs, user]);

  useEffect(() => {
    if (!user?.id) {
      initializedCubeUserIdRef.current = null;
      return undefined;
    }

    if (location.pathname !== "/create") {
      return undefined;
    }

    if (
      !userCubes.cubesLoaded ||
      userCubes.cubesLoadedUserId !== user.id ||
      initializedCubeUserIdRef.current === user.id
    ) {
      return;
    }

    initializedCubeUserIdRef.current = user.id;
    const latestCube = userCubes.cubes[0];
    let isCurrent = true;

    const timeoutId = window.setTimeout(async () => {
      if (!isCurrent) return;

      if (latestCube?.id) {
        await openCube(latestCube.id);
        return;
      }

      clearActiveCube();
    }, 0);

    return () => {
      isCurrent = false;
      window.clearTimeout(timeoutId);
    };
  }, [
    clearActiveCube,
    location.pathname,
    openCube,
    user,
    userCubes.cubes,
    userCubes.cubesLoaded,
    userCubes.cubesLoadedUserId,
  ]);

  useEffect(() => {
    // Debounced cube autosave. The snapshot prevents repeated saves from the
    // same state while still catching pack reorder/removal/name edits.
    if (!isCubeActive) return undefined;
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
  }, [cubeDescription, cubeName, cubeVisibility, isCubeActive, savedCubeId, saveCurrentCube, selectedPacks]);

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
      className={`app${
        location.pathname === "/sample-draft" ? " sampleDraftRoute" : ""
      }`}
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

      {location.pathname === "/create" && !isPackStatsOpen && !isCubeStatsOpen && (
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
          path="/create"
          element={
            <>
              <div className="appLayout">
                {" "}
                <section className="cardArea">
                  <SearchBox
                    searchInput={searchInput}
                    setSearchInput={setSearchInput}
                    searchScopes={searchScopes}
                    setSearchScopes={setSearchScopes}
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
                        canAddCard={pack.canAddCardToPack}
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
                  packFormatId={pack.packFormatId}
                  setPackFormat={handlePackFormatChange}
                  packFormats={pack.packFormats}
                  packCardLimit={pack.packCardLimit}
                  commanderCard={pack.commanderCard}
                  commanderCardId={pack.commanderCardId}
                  setCommanderCard={pack.setCommanderCard}
                  hasValidCommander={pack.hasValidCommander}
                  isPackActive={pack.isPackActive}
                  selectedCards={pack.selectedCards}
                  addCard={pack.addCardToPack}
                  decreaseCardQuantity={pack.decreaseCardQuantity}
                  onCardOpen={setModalCard}
                  addCurrentPackToCube={addCurrentPackToCube}
                  isCubeActive={isCubeActive}
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
                  onConvertDeck={async (deckText, convertedPackName, sourceType) => {
                    const isCommanderImport =
                      pack.packFormats[pack.packFormatId]?.commanderSlot;

                    if (sourceType === "mtgo") {
                      if (isCommanderImport) {
                        return convertMtgoCommanderDeckToPack(deckText);
                      }

                      return convertMtgoDekToPack(
                        deckText,
                        pack.packCardLimit,
                      );
                    }

                    if (isCommanderImport) {
                      return convertArenaCommanderDeckToPack(deckText);
                    }

                    return convertArenaDeckToPack(deckText, pack.packCardLimit);
                  }}
                  onFinalizeConvertedDeck={(cards, convertedPackName, result) => {
                    pack.startPackFromCards(cards, convertedPackName, {
                      commanderCardId: result?.commanderCardId,
                      formatId: result?.mode === "commander"
                        ? pack.packFormats.commander.id
                        : pack.packFormatId,
                    });
                  }}
                  saveStatus={pack.saveStatus}
                  saveErrorMessage={pack.saveErrorMessage}
                  showRenameChoice={pack.showRenameChoice}
                  pendingSaveAction={pack.pendingSaveAction}
                  setIsEditingText={pack.setIsEditingText}
                  moveCard={pack.moveCard}
                  moveCardToMechanicBucket={pack.moveCardToMechanicBucket}
                  isDraggingCard={isDraggingCard}
                  isOpen={isPackBoxOpen}
                  setIsOpen={setIsPackBoxOpen}
                  onStatsOpenChange={setIsPackStatsOpen}
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
                  isCubeActive={isCubeActive}
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
                  onSampleDraft={() => navigate("/sample-draft")}
                  saveStatus={cubeSaveStatus}
                  saveErrorMessage={userCubes.cubeSaveError}
                  isOpen={isJumpCubeBoxOpen}
                  setIsOpen={setIsJumpCubeBoxOpen}
                  onStatsOpenChange={setIsCubeStatsOpen}
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
                  if (!(await saveCurrentPackBeforeLeaving())) return;
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
                canAddPacksToCube={isCubeActive}
                cubePackIds={selectedPacks.map(
                  (selectedPack) => selectedPack.savedPackId || selectedPack.id,
                )}
                onAddPacksToCube={async (packIds) => {
                  if (!requireAuth()) return;
                  if (!isCubeActive) return;

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
                    await loadPackSummaries(newPackIds);
                  const allowedPackSummaries = getCubeFormatCompatiblePacks(
                    selectedPacks,
                    packSummaries,
                  );
                  const rejectedCount =
                    packSummaries.length - allowedPackSummaries.length;

                  if (rejectedCount > 0) {
                    window.alert(
                      `${rejectedCount} pack${rejectedCount === 1 ? "" : "s"} skipped because cube packs must all use the same format.`,
                    );
                  }

                  setSelectedPacks((currentPacks) => {
                    const compatiblePacks = getCubeFormatCompatiblePacks(
                      currentPacks,
                      allowedPackSummaries,
                    );

                    return [...currentPacks, ...compatiblePacks];
                  });
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
                    clearActiveCube();
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
                canAddCard={pack.canAddCardToPack}
              />
            </>
          }
        />

        <Route
          path="/sample-draft"
          element={
            <SampleDraftPage cubeName={cubeName} packs={selectedPacks} />
          }
        />

        <Route
          path="/printables"
          element={
            <PackPrintablesPage
              activePack={{
                id: pack.savedPackId || "current-pack",
                name: normalizeTitle(pack.packName, "Unnamed Pack"),
                cards: pack.selectedCards,
                formatId: pack.packFormatId,
              }}
              packs={printableSavedPacks}
              cubePacks={selectedPacks}
            />
          }
        />

        <Route
          path="/"
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
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
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
