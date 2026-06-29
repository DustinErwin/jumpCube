import { supabase } from "../utils/supabase";

const COLLECTION_PAGE_SIZE = 1000;
const COLLECTION_IMPORT_BATCH_SIZE = 200;

export async function loadUserCollection() {
  const items = [];
  let start = 0;

  while (true) {
    /*
     * LEGACY COMPATIBILITY: collection rows still reference historical
     * card_search/card_variants ids. Active card search, pack hydration, deck
     * imports, and print/version data are disconnected from these tables.
     * This join remains only to expose Scryfall ids for existing collection
     * ownership matching until collection rows store Scryfall ids directly.
     */
    const { data, error } = await supabase
      .from("user_collection_items")
      .select(`
        id, card_search_id, variant_id, finish, quantity, updated_at,
        card:card_search(name, oracle_id, image_url, set_name, set_code, collector_number, default_variant_scryfall_id, representative_scryfall_id),
        variant:card_variants(name, scryfall_id, oracle_id, image_url, set_name, set_code, collector_number)
      `)
      .order("updated_at", { ascending: false })
      .range(start, start + COLLECTION_PAGE_SIZE - 1);

    if (error) throw error;

    items.push(...(data || []));
    if ((data || []).length < COLLECTION_PAGE_SIZE) break;
    start += COLLECTION_PAGE_SIZE;
  }

  return items;
}

function getImportError(error) {
  if (error.code === "PGRST202") {
    return new Error(
      "The collection import database functions are not installed. Run the latest collection migrations in Supabase, then try again.",
    );
  }

  const importError = new Error(
    [error.message, error.details, error.hint].filter(Boolean).join(" "),
  );
  importError.code = error.code;
  return importError;
}

function getCollectionBatches(rows) {
  const batches = [];

  for (let index = 0; index < rows.length; index += COLLECTION_IMPORT_BATCH_SIZE) {
    batches.push(rows.slice(index, index + COLLECTION_IMPORT_BATCH_SIZE));
  }

  return batches;
}

export async function importUserCollection(rows, mode, onProgress) {
  const batches = getCollectionBatches(rows);
  const validationErrors = [];

  for (let index = 0; index < batches.length; index += 1) {
    onProgress?.({ phase: "validating", current: index + 1, total: batches.length });

    const { data, error } = await supabase.rpc("validate_user_collection_batch", {
      requested_rows: batches[index],
    });

    if (error) throw getImportError(error);
    if (!data?.success) validationErrors.push(...(data?.errors || []));
  }

  if (validationErrors.length > 0) {
    return { success: false, imported_count: 0, errors: validationErrors };
  }

  let importedCount = 0;

  for (let index = 0; index < batches.length; index += 1) {
    onProgress?.({ phase: "importing", current: index + 1, total: batches.length });

    const batchMode = mode === "replace" && index === 0 ? "replace" : "update";
    const { data, error } = await supabase.rpc("import_user_collection", {
      requested_rows: batches[index],
      requested_mode: batchMode,
    });

    if (error) throw getImportError(error);
    if (!data?.success) return data;

    importedCount += Number(data.imported_count || 0);
  }

  onProgress?.({ phase: "complete", current: batches.length, total: batches.length });
  return { success: true, imported_count: importedCount, errors: [] };
}
