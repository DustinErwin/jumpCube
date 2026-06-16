import { useMemo, useRef, useState } from "react";
import { importUserCollection } from "../../services/collectionService";
import {
  COLLECTION_CSV_MAX_BYTES,
  downloadCollectionErrors,
  parseCollectionCsv,
} from "../../utils/collectionCsv";
import "./CollectionPage.css";

export default function CollectionPage({
  collectionItems,
  loadingCollection,
  collectionError,
  onCollectionChanged,
}) {
  const [search, setSearch] = useState("");
  const [fileName, setFileName] = useState("");
  const [pendingRows, setPendingRows] = useState([]);
  const [importMode, setImportMode] = useState("update");
  const [importErrors, setImportErrors] = useState([]);
  const [importMessage, setImportMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const fileInputRef = useRef(null);

  const totalCards = collectionItems.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  const foilCards = collectionItems.reduce(
    (total, item) =>
      item.finish === "nonfoil" ? total : total + item.quantity,
    0,
  );
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return collectionItems;

    return collectionItems.filter((item) => {
      const card = item.variant || item.card || {};
      return [card.name, card.set_name, card.set_code, card.collector_number]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [collectionItems, search]);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];

    setFileName(file?.name || "");
    setPendingRows([]);
    setImportErrors([]);
    setImportMessage("");

    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportErrors([{ row_number: 1, error: "Choose a CSV file." }]);
      return;
    }

    if (file.size > COLLECTION_CSV_MAX_BYTES) {
      setImportErrors([{
        row_number: 1,
        error: "CSV files are limited to 5 MB.",
      }]);
      return;
    }

    const parsed = parseCollectionCsv(await file.text());
    setPendingRows(parsed.rows);
    setImportErrors(parsed.errors);
  }

  async function importCollection() {
    if (pendingRows.length === 0 || importErrors.length > 0) return;

    setImporting(true);
    setImportProgress(null);
    setImportMessage("");

    try {
      const result = await importUserCollection(
        pendingRows,
        importMode,
        setImportProgress,
      );

      if (!result?.success) {
        setImportErrors(result?.errors || [{ error: "Import failed." }]);
        return;
      }

      setImportErrors([]);
      setPendingRows([]);
      setFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setImportMessage(
        `${result.imported_count.toLocaleString()} collection rows imported.`,
      );
      await onCollectionChanged();
    } catch (error) {
      console.error("Error importing collection:", error);
      setImportErrors([{
        row_number: null,
        scope: "import",
        error: error.message || "Collection import failed.",
      }]);
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  }

  return (
    <section className="collectionPage">
      <header className="collectionHero">
        <div>
          <p className="collectionEyebrow">Physical inventory</p>
          <h2>My Collection</h2>
          <p>Import card ownership for faster pack and cube building.</p>
        </div>

        <div className="collectionSummary">
          <div><strong>{collectionItems.length.toLocaleString()}</strong><span>Unique printings</span></div>
          <div><strong>{totalCards.toLocaleString()}</strong><span>Total cards</span></div>
          <div><strong>{foilCards.toLocaleString()}</strong><span>Foil or etched</span></div>
        </div>
      </header>

      <section className="collectionImportPanel">
        <div className="collectionImportIntro">
          <h3>Import CSV</h3>
          <p>
            Maximum 5 MB or 50,000 rows. Headers are optional. Headerless files
            may use <strong>Name, Quantity</strong> or <strong>Name, Set,
            Collector Number, Quantity, Finish</strong> order.
          </p>
        </div>

        <div className="collectionImportControls">
          <label className="collectionFileButton">
            Choose CSV
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
            />
          </label>
          <span className="collectionFileName">{fileName || "No file selected"}</span>

          <label>
            Import mode
            <select value={importMode} onChange={(event) => setImportMode(event.target.value)}>
              <option value="update">Update matching cards</option>
              <option value="replace">Replace entire collection</option>
            </select>
          </label>

          <button
            type="button"
            className="collectionImportButton"
            onClick={importCollection}
            disabled={pendingRows.length === 0 || importErrors.length > 0 || importing}
          >
            {importing && importProgress
              ? `${importProgress.phase === "validating" ? "Validating" : "Importing"} ${importProgress.current}/${importProgress.total}`
              : importing
                ? "Preparing..."
                : `Import ${pendingRows.length.toLocaleString()} rows`}
          </button>
        </div>

        {importMode === "replace" && pendingRows.length > 0 && (
          <p className="collectionReplaceWarning">
            Replace mode removes collection entries not included in this CSV.
          </p>
        )}

        {importMessage && <p className="collectionImportSuccess">{importMessage}</p>}

        {importErrors.length > 0 && (
          <div className="collectionErrorLog" role="alert">
            <div>
              <strong>{importErrors.length.toLocaleString()} import errors</strong>
              <button type="button" onClick={() => downloadCollectionErrors(importErrors)}>
                Download error log
              </button>
            </div>
            <ol>
              {importErrors.slice(0, 12).map((error, index) => (
                <li key={`${error.row_number}-${index}`}>
                  {error.row_number
                    ? `Row ${error.row_number}: `
                    : "Import error: "}
                  {error.error}
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      <section className="collectionInventory">
        <div className="collectionInventoryHeader">
          <div><h3>Inventory</h3><p>{filteredItems.length.toLocaleString()} rows shown</p></div>
          <input
            type="search"
            placeholder="Search collection..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {collectionError && <p className="collectionLoadError">Collection could not be loaded.</p>}
        {loadingCollection ? (
          <p className="collectionEmpty">Loading collection...</p>
        ) : filteredItems.length === 0 ? (
          <p className="collectionEmpty">
            {collectionItems.length === 0 ? "Import a CSV to start your collection." : "No collection cards match that search."}
          </p>
        ) : (
          <div className="collectionTableWrap">
            <table className="collectionTable">
              <thead><tr><th>Card</th><th>Printing</th><th>Finish</th><th>Quantity</th></tr></thead>
              <tbody>
                {filteredItems.map((item) => {
                  const card = item.variant || item.card || {};
                  return (
                    <tr key={item.id}>
                      <td><div className="collectionCardName">{card.image_url && <img src={card.image_url} alt="" loading="lazy" />}<span>{card.name}</span></div></td>
                      <td>{card.set_code?.toUpperCase()} {card.collector_number}</td>
                      <td className="collectionFinish">{item.finish}</td>
                      <td><strong>{item.quantity}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
