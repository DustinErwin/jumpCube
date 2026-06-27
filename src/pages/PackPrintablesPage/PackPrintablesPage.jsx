import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getPackFormat } from "../../utils/packFormats";
import "./PackPrintablesPage.css";

const COLOR_ORDER = ["W", "U", "B", "R", "G"];
const CARDS_PER_PRINT_SHEET = 9;

function getManaClass(color) {
  const classes = {
    W: "ms-w",
    U: "ms-u",
    B: "ms-b",
    R: "ms-r",
    G: "ms-g",
    C: "ms-c",
  };

  return classes[color] || "ms-c";
}

function getCardImage(card) {
  return (
    card?.image_uris?.art_crop ||
    card?.image_url ||
    card?.image_uris?.normal ||
    card?.image_uris?.small ||
    card?.card_faces?.[0]?.image_uris?.art_crop ||
    card?.card_faces?.[0]?.image_uris?.normal ||
    card?.card_faces?.[0]?.image_uris?.small ||
    ""
  );
}

function getCardKey(card, index) {
  return String(card?.variant_id || card?.id || card?.card_search_id || index);
}

function getPackId(pack, index) {
  return String(pack?.savedPackId || pack?.id || `pack-${index}`);
}

function getPackColors(cards) {
  const colors = new Set((cards || []).flatMap((card) => card.color_identity || []));
  const sortedColors = COLOR_ORDER.filter((color) => colors.has(color));

  return sortedColors.length > 0 ? sortedColors : ["C"];
}

function isLandCard(card) {
  return /\bland\b/i.test(card?.type_line || "");
}

function getSortedCards(cards) {
  return [...(cards || [])].sort((cardA, cardB) => {
    const landSort = Number(isLandCard(cardA)) - Number(isLandCard(cardB));

    return (
      landSort ||
      String(cardA.name || "").localeCompare(String(cardB.name || ""))
    );
  });
}

function normalizePackOption(pack, index, source = "pack") {
  const cards = pack?.cards || [];

  return {
    ...pack,
    id: getPackId(pack, index),
    name: String(pack?.name || "Unnamed Pack").trim() || "Unnamed Pack",
    source,
    cards,
    cardCount: cards.reduce(
      (sum, card) => sum + (Number(card.quantity) || 0),
      0,
    ),
  };
}

function chunkItems(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function getPackPrintableData(pack, selectedCoverCardKey = "") {
  const cards = getSortedCards(pack?.cards || []);
  const packFormat = getPackFormat(pack?.formatId || pack?.format_id);
  const coverOptions = cards.filter((card) => getCardImage(card));
  const coverCard =
    coverOptions.find(
      (card, index) => getCardKey(card, index) === selectedCoverCardKey,
    ) ||
    coverOptions[0] ||
    cards[0] ||
    null;

  const totalCards = cards.reduce(
    (sum, card) => sum + (Number(card.quantity) || 0),
    0,
  );

  return {
    id: pack?.id || "pack",
    name: pack?.name || "Unnamed Pack",
    cards,
    formatId: packFormat.id,
    colors: getPackColors(cards),
    coverImage: getCardImage(coverCard),
    totalCards:
      packFormat.id === "commander"
        ? Math.max(totalCards, packFormat.cardLimit)
        : totalCards,
  };
}

function PackTitlePrintable({ pack }) {
  return (
    <article className="printableMtgCard printableTitleCard">
      {pack.coverImage ? (
        <img src={pack.coverImage} alt="" />
      ) : (
        <div className="printableMissingArt" />
      )}
      <div className="printableTitleScrim">
        <h2>{pack.name}</h2>
      </div>
      <div className="printableColorPips" aria-label="Pack color identity">
        {pack.colors.map((color) => (
          <i
            className={`ms ${getManaClass(color)}`}
            key={color}
            title={color}
          />
        ))}
      </div>
      <p className="printableCardFooter">{pack.totalCards} cards</p>
    </article>
  );
}

function PackListPrintable({ pack }) {
  const listClassName =
    pack.cards.length > 10
      ? "printableMtgCard printableListCard printableListCardDense"
      : "printableMtgCard printableListCard";

  return (
    <article className={listClassName}>
      <header>
        <h2>{pack.name}</h2>
        <div className="printableColorPips" aria-label="Pack color identity">
          {pack.colors.map((color) => (
            <i
              className={`ms ${getManaClass(color)}`}
              key={color}
              title={color}
            />
          ))}
        </div>
      </header>
      <ol>
        {pack.cards.map((card, index) => (
          <li key={getCardKey(card, index)}>
            <span>{Number(card.quantity) || 0}</span>
            <strong>{card.name}</strong>
          </li>
        ))}
      </ol>
      <p>{pack.totalCards} cards</p>
    </article>
  );
}

export default function PackPrintablesPage({
  activePack,
  packs = [],
  cubePacks = [],
}) {
  const navigate = useNavigate();
  const packOptions = useMemo(() => {
    const options = [];
    const seenIds = new Set();

    if (activePack && (activePack.cards || []).length > 0) {
      const option = normalizePackOption(activePack, 0, "current");

      seenIds.add(option.id);
      options.push(option);
    }

    packs.forEach((pack, index) => {
      if (!pack || (pack.cards || []).length === 0) return;

      const option = normalizePackOption(pack, index, "library");

      if (seenIds.has(option.id)) return;
      seenIds.add(option.id);
      options.push(option);
    });

    cubePacks.forEach((pack, index) => {
      if (!pack || (pack.cards || []).length === 0) return;

      const option = normalizePackOption(pack, index, "cube");

      if (seenIds.has(option.id)) return;
      seenIds.add(option.id);
      options.push(option);
    });

    return options;
  }, [activePack, cubePacks, packs]);
  const [selectedPackId, setSelectedPackId] = useState("");
  const [selectedPrintPackIds, setSelectedPrintPackIds] = useState(null);
  const [coverCardKey, setCoverCardKey] = useState("");
  const [includeTitleCard, setIncludeTitleCard] = useState(true);
  const [includeListCard, setIncludeListCard] = useState(true);
  const [useColoredPips, setUseColoredPips] = useState(true);
  const [printMode, setPrintMode] = useState("single");

  const effectiveSelectedPackId = packOptions.some(
    (pack) => pack.id === selectedPackId,
  )
    ? selectedPackId
    : packOptions[0]?.id || "";
  const selectedPack =
    packOptions.find((pack) => pack.id === effectiveSelectedPackId) || null;
  const printableCards = useMemo(
    () => getSortedCards(selectedPack?.cards || []),
    [selectedPack],
  );
  const coverOptions = useMemo(
    () => printableCards.filter((card) => getCardImage(card)),
    [printableCards],
  );
  const effectiveCoverCardKey = coverOptions.some(
    (card, index) => getCardKey(card, index) === coverCardKey,
  )
    ? coverCardKey
    : coverOptions[0]
    ? getCardKey(coverOptions[0], 0)
    : "";

  const validPackIds = new Set(packOptions.map((pack) => pack.id));
  const defaultPrintPackIds = effectiveSelectedPackId
    ? [effectiveSelectedPackId]
    : [];
  const effectivePrintPackIds = (selectedPrintPackIds || defaultPrintPackIds)
    .filter((packId) => validPackIds.has(packId));
  const selectedPrintPackIdSet = new Set(effectivePrintPackIds);
  const cubePackIds = cubePacks
    .map((pack, index) => getPackId(pack, index))
    .filter((packId) => validPackIds.has(packId));
  const packsToPrint = packOptions.filter((pack) =>
    selectedPrintPackIdSet.has(pack.id),
  );
  const printablePacks = packsToPrint.map((pack) =>
    getPackPrintableData(
      pack,
      pack.id === selectedPack?.id ? effectiveCoverCardKey : "",
    ),
  );
  const isDuplexMode = printMode === "duplex";
  const canPrint =
    printablePacks.length > 0 &&
    (isDuplexMode || includeTitleCard || includeListCard);
  const singleSidedCards = printablePacks.flatMap((pack) => [
    ...(includeTitleCard ? [{ type: "title", pack }] : []),
    ...(includeListCard ? [{ type: "list", pack }] : []),
  ]);
  const singleSidedPages = chunkItems(singleSidedCards, CARDS_PER_PRINT_SHEET);
  const duplexTitlePages = chunkItems(printablePacks, CARDS_PER_PRINT_SHEET);
  const duplexListPages = duplexTitlePages.map((pagePacks) => [...pagePacks]);

  function printCards() {
    window.print();
  }

  function setCurrentPackOnly() {
    setSelectedPrintPackIds(effectiveSelectedPackId ? [effectiveSelectedPackId] : []);
  }

  function setCurrentCubePacks() {
    setSelectedPrintPackIds(cubePackIds);
  }

  function setAllPacks() {
    setSelectedPrintPackIds(packOptions.map((pack) => pack.id));
  }

  function clearSelectedPacks() {
    setSelectedPrintPackIds([]);
  }

  function togglePackForPrint(packId) {
    setSelectedPrintPackIds((currentIds) => {
      const nextIds = new Set(currentIds || defaultPrintPackIds);

      if (nextIds.has(packId)) {
        nextIds.delete(packId);
      } else {
        nextIds.add(packId);
      }

      return [...nextIds];
    });
  }

  return (
    <section className="packPrintablesPage">
      <header className="packPrintablesPageHeader">
        <button type="button" onClick={() => navigate("/create")}>
          Back
        </button>
        <div>
          <span>Pack tools</span>
          <h1>Printables</h1>
          <p>Make a title insert and restore list at Magic card size.</p>
        </div>
        <button
          type="button"
          onClick={printCards}
          disabled={!canPrint}
        >
          Print
        </button>
      </header>

      {packOptions.length === 0 ? (
        <div className="packPrintablesEmpty">
          <h2>No pack selected</h2>
          <p>Create or open a pack with cards, then return here to print inserts.</p>
          <button type="button" onClick={() => navigate("/create")}>
            Open Builder
          </button>
        </div>
      ) : (
        <div className="packPrintablesWorkspace">
          <aside className="packPrintablesPanel" aria-label="Printable settings">
            <label>
              Cover art pack
              <select
                value={effectiveSelectedPackId}
                onChange={(event) => setSelectedPackId(event.target.value)}
              >
                {packOptions.map((pack) => (
                  <option value={pack.id} key={pack.id}>
                    {pack.name} ({pack.cardCount})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Title card art
              <select
                value={effectiveCoverCardKey}
                onChange={(event) => setCoverCardKey(event.target.value)}
              >
                {coverOptions.length === 0 ? (
                  <option value="">No card art available</option>
                ) : (
                  coverOptions.map((card, index) => (
                    <option
                      value={getCardKey(card, index)}
                      key={getCardKey(card, index)}
                    >
                      {card.name}
                    </option>
                  ))
                )}
              </select>
            </label>

            <div className="packPrintablesSelection">
              <div className="packPrintablesSelectionHeader">
                <span>Packs to print</span>
                <strong>{effectivePrintPackIds.length} selected</strong>
              </div>

              <div className="packPrintablesSelectionActions">
                <button type="button" onClick={setCurrentPackOnly}>
                  Current
                </button>
                <button
                  type="button"
                  onClick={setCurrentCubePacks}
                  disabled={cubePackIds.length === 0}
                >
                  Cube
                </button>
                <button type="button" onClick={setAllPacks}>
                  All
                </button>
                <button type="button" onClick={clearSelectedPacks}>
                  None
                </button>
              </div>

              <div className="packPrintablesPackList">
                {packOptions.map((pack) => (
                  <label className="packPrintablesPackOption" key={pack.id}>
                    <input
                      type="checkbox"
                      checked={selectedPrintPackIdSet.has(pack.id)}
                      onChange={() => togglePackForPrint(pack.id)}
                    />
                    <span>
                      <strong>{pack.name}</strong>
                      <small>
                        {pack.source === "cube"
                          ? "Cube pack"
                          : pack.source === "library"
                          ? "Saved pack"
                          : "Current pack"}{" "}
                        &middot;{" "}
                        {pack.cardCount} cards
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <label>
              Print layout
              <select
                value={printMode}
                onChange={(event) => setPrintMode(event.target.value)}
              >
                <option value="single">Single-sided sheets</option>
                <option value="duplex">Duplex title front/list back</option>
              </select>
            </label>

            <label className="packPrintableToggle">
              <input
                type="checkbox"
                checked={includeTitleCard}
                onChange={(event) => setIncludeTitleCard(event.target.checked)}
                disabled={isDuplexMode}
              />
              Title insert
            </label>

            <label className="packPrintableToggle">
              <input
                type="checkbox"
                checked={includeListCard}
                onChange={(event) => setIncludeListCard(event.target.checked)}
                disabled={isDuplexMode}
              />
              Restore list
            </label>

            <label className="packPrintableToggle">
              <input
                type="checkbox"
                checked={useColoredPips}
                onChange={(event) => setUseColoredPips(event.target.checked)}
              />
              Colored pips
            </label>

            <p className="packPrintablesHint">
              Letter sheets fit nine cards. Duplex mode prints title cards on
              front pages and matching restore lists on back pages. Use
              long-edge flip when printing double-sided.
            </p>
          </aside>

          <div
            className={`packPrintableSheet ${
              isDuplexMode ? "duplexMode" : "singleMode"
            } ${useColoredPips ? "coloredPips" : "monoPips"}`}
            aria-label="Printable previews"
          >
            {isDuplexMode ? (
              <>
                {duplexTitlePages.map((pagePacks, pageIndex) => (
                  <div className="duplexSheetPair" key={`duplex-${pageIndex}`}>
                    <section
                      className="packPrintablePage duplexFrontPage"
                      aria-label={`Duplex front page ${pageIndex + 1}`}
                    >
                      {pagePacks.map((pack) => (
                        <PackTitlePrintable
                          pack={pack}
                          key={`title-${pack.id}`}
                        />
                      ))}
                    </section>
                    <section
                      className="packPrintablePage duplexBackPage"
                      aria-label={`Duplex back page ${pageIndex + 1}`}
                    >
                      {duplexListPages[pageIndex].map((pack) => (
                        <PackListPrintable
                          pack={pack}
                          key={`list-${pack.id}`}
                        />
                      ))}
                    </section>
                  </div>
                ))}
              </>
            ) : (
              singleSidedPages.map((pageCards, pageIndex) => (
                <section
                  className="packPrintablePage"
                  key={`single-${pageIndex}`}
                  aria-label={`Printable page ${pageIndex + 1}`}
                >
                  {pageCards.map((card) =>
                    card.type === "title" ? (
                      <PackTitlePrintable
                        pack={card.pack}
                        key={`title-${card.pack.id}`}
                      />
                    ) : (
                      <PackListPrintable
                        pack={card.pack}
                        key={`list-${card.pack.id}`}
                      />
                    ),
                  )}
                </section>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
