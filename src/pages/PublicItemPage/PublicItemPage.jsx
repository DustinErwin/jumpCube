import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import PackBox from "../../components/PackBox/PackBox";
import JumpCubeBox from "../../components/JumpCubeBox/JumpCubeBox";
import CardModal from "../../components/CardModal/CardModal";
import {
  loadPublicCube,
  loadPublicPack,
} from "../../services/discoveryService";
import "./PublicItemPage.css";

const noop = () => {};
const noopAsync = async () => {};

function getPackCardId(card, index) {
  return card.id || card.variant_id || card.card_search_id || `${card.name}-${index}`;
}

function normalizePackForStats(pack) {
  if (!pack) return null;

  return {
    ...pack,
    cards: (pack.cards || []).map((card, index) => ({
      ...card,
      id: getPackCardId(card, index),
      image_url:
        card.image_url ||
        card.image_uris?.normal ||
        card.image_uris?.art_crop ||
        null,
      quantity: card.quantity || 1,
    })),
    archetypeTags: pack.archetypeTags || pack.tags || [],
    colorIdentity:
      pack.colorIdentity ||
      pack.cards?.flatMap((card) => card.color_identity || []) ||
      [],
  };
}

export default function PublicItemPage({ type }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [activePack, setActivePack] = useState(null);
  const [modalCard, setModalCard] = useState(null);
  const [loadState, setLoadState] = useState({
    id: null,
    loading: true,
    error: "",
  });
  const isCube = type === "cube";

  useEffect(() => {
    let active = true;

    (isCube ? loadPublicCube(id) : loadPublicPack(id))
      .then((loadedItem) => {
        if (!active) return;
        setItem(loadedItem);
        setLoadState({ id, loading: false, error: "" });
      })
      .catch((loadError) => {
        console.error("Error loading public item:", loadError);
        if (active) {
          setLoadState({
            id,
            loading: false,
            error: "That public link could not be opened.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [id, isCube]);

  const selectedPack = useMemo(() => {
    if (activePack?.sourceId === id) {
      return normalizePackForStats(activePack.pack);
    }

    if (!isCube) return normalizePackForStats(item);
    return null;
  }, [activePack, id, isCube, item]);

  const cubePacks = useMemo(
    () => (item?.packs || []).map(normalizePackForStats).filter(Boolean),
    [item],
  );

  const hasCurrentItem = item?.id === id;
  const isPageLoading = loadState.loading || loadState.id !== id;
  const currentError = loadState.id === id ? loadState.error : "";

  if (isPageLoading) {
    return (
      <main className="publicStatsRoute">
        <p className="publicItemStatus">
          Loading shared {isCube ? "cube" : "pack"}...
        </p>
      </main>
    );
  }

  if (currentError || !hasCurrentItem) {
    return (
      <main className="publicStatsRoute">
        <p className="publicItemStatus error">
          {currentError || "That public link could not be opened."}
        </p>
        <Link className="publicBackLink" to="/discover">
          Browse Discover
        </Link>
      </main>
    );
  }

  if (selectedPack) {
    return (
      <main className="publicStatsRoute">
        <PackBox
          key={selectedPack.id}
          packName={selectedPack.name}
          setPackName={noop}
          selectedCards={selectedPack.cards}
          addCard={noop}
          decreaseCardQuantity={noop}
          onCardOpen={setModalCard}
          addCurrentPackToCube={noopAsync}
          onOpenPacks={noop}
          deletePack={noopAsync}
          savedPackId={selectedPack.id}
          packDescription={selectedPack.description || ""}
          setPackDescription={noop}
          packArchetypeTags={selectedPack.archetypeTags || []}
          setPackArchetypeTags={noop}
          availablePackTags={[]}
          createPackTag={noopAsync}
          packVisibility={selectedPack.visibility || "public"}
          setPackVisibility={noop}
          newPack={noop}
          saveStatus=""
          moveCard={noop}
          moveCardToMechanicBucket={noop}
          initialShowStats
          onStatsClose={() => {
            if (activePack && isCube) {
              setActivePack(null);
              return;
            }

            navigate("/discover");
          }}
          isDraggingCard={false}
          isOpen={false}
          setIsOpen={noop}
          isAuthenticated={false}
          onAuthRequired={noop}
        />
        <CardModal
          key={modalCard?.id || "shared-card-modal"}
          isOpen={Boolean(modalCard)}
          card={modalCard}
          onClose={() => setModalCard(null)}
          selectedCards={[]}
          readOnly
        />
      </main>
    );
  }

  return (
    <main className="publicStatsRoute">
      <JumpCubeBox
        key={item.id}
        cubeName={item.name}
        setCubeName={noop}
        cubeDescription={item.description || ""}
        setCubeDescription={noop}
        cubeVisibility={item.visibility || "public"}
        setCubeVisibility={noop}
        selectedPacks={cubePacks}
        onOpenCubes={noop}
        onOpenPack={noopAsync}
        removePackFromCube={noop}
        movePackInCube={noop}
        newCube={noop}
        savedCubeId={item.id}
        saveStatus=""
        initialShowStats
        onStatsClose={() => navigate("/discover")}
        onStatsPackOpen={(pack) => setActivePack({ sourceId: id, pack })}
        isOpen={false}
        setIsOpen={noop}
        isAuthenticated={false}
        onAuthRequired={noop}
      />
    </main>
  );
}
