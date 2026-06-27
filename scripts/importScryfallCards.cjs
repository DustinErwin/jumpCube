require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const clarinet = require("clarinet");

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const args = new Set(process.argv.slice(2));
const BULK_IMPORT_BATCH_SIZE = Number(process.env.SCRYFALL_IMPORT_BATCH_SIZE || 100);
const DEFAULT_LINK_BATCH_SIZE = Number(process.env.DEFAULT_LINK_BATCH_SIZE || 100);
const IMPORT_LOG_INTERVAL = 5000;
const importOracleCards = !args.has("--variants-only") && !args.has("--link-only");
const importAllCards = !args.has("--oracle-only") && !args.has("--link-only");
const linkOnly = args.has("--link-only");
const auditOnly = args.has("--audit");
const ignoreDuplicates = args.has("--ignore-duplicates");
const FUNNY_SET_CODES = new Set([
  "ugl",
  "unh",
  "ust",
  "und",
  "unf",
  "sunf",
  "pcel",
]);
const SCRYFALL_HEADERS = {
  "User-Agent": "JumpCube2026/1.0 (Scryfall bulk import)",
  Accept: "application/json;q=0.9,*/*;q=0.8",
};

function logError(error) {
  console.error(
    JSON.stringify(
      {
        message: error?.message || String(error),
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
      },
      null,
      2,
    ),
  );
}

function toNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function toUuid(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getImage(card, size = "normal", faceIndex = 0) {
  if (faceIndex > 0) {
    return (
      card.card_faces?.[faceIndex]?.image_uris?.[size] ||
      card.card_faces?.[faceIndex]?.small?.[size] ||
      null
    );
  }

  return (
    card.image_uris?.[size] ||
    card.small?.[size] ||
    card.card_faces?.[0]?.image_uris?.[size] ||
    card.card_faces?.[0]?.small?.[size] ||
    null
  );
}

function getBackImage(card) {
  const frontImage = getImage(card);
  const explicitBackImage = getImage(card, "normal", 1);

  if (explicitBackImage) {
    return explicitBackImage;
  }

  if (
    ["transform", "modal_dfc", "meld"].includes(card.layout) &&
    frontImage?.includes("/front/")
  ) {
    return frontImage.replace("/front/", "/back/");
  }

  return null;
}

function getSourceSetCode(card) {
  return card.collector_number?.split("-")?.[0]?.toLowerCase() || null;
}

function isFunnyCard(card) {
  return (
    card.set_type === "funny" ||
    card.security_stamp === "acorn" ||
    (card.promo_types || []).includes("playtest") ||
    FUNNY_SET_CODES.has(card.set) ||
    FUNNY_SET_CODES.has(getSourceSetCode(card))
  );
}

function isToken(card) {
  return (
    ["token", "double_faced_token", "emblem", "art_series"].includes(
      card.layout,
    ) ||
    card.type_line?.toLowerCase().includes("token") ||
    false
  );
}

function isPlanechase(card) {
  return (
    /\bplane\b/i.test(card.type_line || "") ||
    /\bphenomenon\b/i.test(card.type_line || "") ||
    card.layout === "planar" ||
    false
  );
}

function hasType(card, typeName) {
  return new RegExp(`\\b${typeName}\\b`, "i").test(card.type_line || "");
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9{}+/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getOracleText(card) {
  return card.oracle_text || card.card_faces?.[0]?.oracle_text || null;
}

function getManaCost(card) {
  return card.mana_cost || card.card_faces?.[0]?.mana_cost || null;
}

function getPower(card) {
  return card.power || card.card_faces?.[0]?.power || null;
}

function getToughness(card) {
  return card.toughness || card.card_faces?.[0]?.toughness || null;
}

function getLoyalty(card) {
  return card.loyalty || card.card_faces?.[0]?.loyalty || null;
}

function getSearchText(card) {
  const faceText = (card.card_faces || []).flatMap((face) => [
    face.name,
    face.type_line,
    face.oracle_text,
  ]);

  return normalizeSearchText(
    [
      card.name,
      card.type_line,
      getOracleText(card),
      ...(card.keywords || []),
      ...faceText,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function getCommonCardFields(card) {
  const frontImage = getImage(card);
  const backImage = getBackImage(card);
  const prices = card.prices || {};

  return {
    name: card.name,
    layout: card.layout ?? null,
    released_at: card.released_at ?? null,
    mana_cost: getManaCost(card),
    mana_value: toNumber(card.cmc),
    type_line: card.type_line ?? null,
    oracle_text: getOracleText(card),
    power: getPower(card),
    toughness: getToughness(card),
    loyalty: getLoyalty(card),
    colors: card.colors || [],
    color_identity: card.color_identity || [],
    keywords: card.keywords || [],
    legalities: card.legalities || null,
    edhrec_rank: toNumber(card.edhrec_rank),
    image_url: frontImage,
    back_image_url: backImage,
    image_uris: card.image_uris || card.small || null,
    card_faces: card.card_faces || null,
    has_back_face: Boolean(backImage),
    set_code: card.set ?? null,
    set_name: card.set_name ?? null,
    collector_number: card.collector_number ?? null,
    rarity: card.rarity ?? null,
    artist: card.artist ?? null,
    games: card.games || [],
    nonfoil: card.nonfoil ?? false,
    foil: card.foil ?? false,
    is_reprint: card.reprint ?? false,
    is_variant_printing: card.variation ?? false,
    is_token: isToken(card),
    is_funny: isFunnyCard(card),
    is_planechase: isPlanechase(card),
    price_usd: toNumber(prices.usd),
    price_usd_foil: toNumber(prices.usd_foil),
    price_usd_etched: toNumber(prices.usd_etched),
    price_eur: toNumber(prices.eur),
    price_eur_foil: toNumber(prices.eur_foil),
    price_tix: toNumber(prices.tix),
    imported_at: new Date().toISOString(),
  };
}

function mapCardSearch(card) {
  if (!card.oracle_id) {
    return null;
  }

  const commonFields = getCommonCardFields(card);

  return {
    ...commonFields,
    oracle_id: toUuid(card.oracle_id),
    representative_scryfall_id: toUuid(card.id),
    default_variant_id: null,
    default_variant_scryfall_id: null,
    normalized_name: normalizeSearchText(card.name),
    normalized_type_line: normalizeSearchText(card.type_line),
    normalized_oracle_text: normalizeSearchText(getOracleText(card)),
    search_text: getSearchText(card),
    produces_colors: card.produced_mana || [],
    is_artifact: hasType(card, "Artifact"),
    is_battle: hasType(card, "Battle"),
    is_creature: hasType(card, "Creature"),
    is_enchantment: hasType(card, "Enchantment"),
    is_instant: hasType(card, "Instant"),
    is_land: hasType(card, "Land"),
    is_planeswalker: hasType(card, "Planeswalker"),
    is_sorcery: hasType(card, "Sorcery"),
  };
}

function mapCardVariant(card) {
  if (!card.id || !card.oracle_id) {
    return null;
  }

  const commonFields = getCommonCardFields(card);
  const prices = card.prices || {};

  return {
    ...commonFields,
    scryfall_id: toUuid(card.id),
    oracle_id: toUuid(card.oracle_id),
    printed_name: card.printed_name ?? null,
    lang: card.lang ?? null,
    printed_type_line: card.printed_type_line ?? null,
    printed_text: card.printed_text ?? null,
    highres_image: card.highres_image ?? false,
    image_status: card.image_status ?? null,
    set_id: toUuid(card.set_id),
    set_type: card.set_type ?? null,
    artist_ids: card.artist_ids || [],
    illustration_id: toUuid(card.illustration_id),
    finishes: card.finishes || [],
    etched: (card.finishes || []).includes("etched"),
    oversized: card.oversized ?? false,
    promo: card.promo ?? false,
    promo_types: card.promo_types || [],
    digital: card.digital ?? false,
    border_color: card.border_color ?? null,
    frame: card.frame ?? null,
    frame_effects: card.frame_effects || [],
    security_stamp: card.security_stamp ?? null,
    full_art: card.full_art ?? false,
    textless: card.textless ?? false,
    booster: card.booster ?? null,
    story_spotlight: card.story_spotlight ?? false,
    prices: {
      usd: prices.usd ?? null,
      usd_foil: prices.usd_foil ?? null,
      usd_etched: prices.usd_etched ?? null,
      eur: prices.eur ?? null,
      eur_foil: prices.eur_foil ?? null,
      tix: prices.tix ?? null,
    },
    scryfall_uri: card.scryfall_uri ?? null,
    uri: card.uri ?? null,
    rulings_uri: card.rulings_uri ?? null,
    prints_search_uri: card.prints_search_uri ?? null,
    related_uris: card.related_uris || null,
    purchase_uris: card.purchase_uris || null,
  };
}

async function getBulkDownloadUrl(type) {
  const response = await fetch(`https://api.scryfall.com/bulk-data/${type}`, {
    headers: SCRYFALL_HEADERS,
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.details || `Could not load ${type} bulk metadata`);
  }

  return payload.download_uri;
}

async function importBatch(table, batch, count, onConflict) {
  const { error } = await supabase
    .from(table)
    .upsert(batch, { onConflict, ignoreDuplicates });

  if (error) {
    console.error(`${table} import error:`);
    logError(error);
    process.exit(1);
  }

  if (count % IMPORT_LOG_INTERVAL === 0) {
    console.log(`Processed ${count} rows for ${table}`);
  }
}

async function streamBulkCards({ bulkType, table, mapCard, onConflict }) {
  console.log(`Getting latest Scryfall ${bulkType} bulk URL...`);

  const downloadUrl = await getBulkDownloadUrl(bulkType);

  console.log(`Downloading and streaming ${bulkType}...`);
  console.log("Bulk download URL:", downloadUrl);

  const response = await fetch(downloadUrl, {
    headers: SCRYFALL_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Could not download ${bulkType}: ${response.status}`);
  }

  const parser = clarinet.parser();
  const decoder = new TextDecoder();

  let pendingImport = Promise.resolve();
  let stack = [];
  let currentKey = null;
  let batch = [];
  let count = 0;

  parser.onopenobject = function (key) {
    const obj = {};

    if (key !== undefined) {
      currentKey = key;
    }

    if (stack.length > 0) {
      const parent = stack[stack.length - 1];

      if (Array.isArray(parent)) {
        parent.push(obj);
      } else {
        parent[currentKey] = obj;
      }
    }

    stack.push(obj);
  };

  parser.onkey = function (key) {
    currentKey = key;
  };

  parser.onopenarray = function () {
    const arr = [];

    if (stack.length > 0) {
      const parent = stack[stack.length - 1];

      if (Array.isArray(parent)) {
        parent.push(arr);
      } else {
        parent[currentKey] = arr;
      }
    }

    stack.push(arr);
  };

  parser.onvalue = function (value) {
    const parent = stack[stack.length - 1];

    if (Array.isArray(parent)) {
      parent.push(value);
    } else {
      parent[currentKey] = value;
    }
  };

  parser.oncloseobject = function () {
    const obj = stack.pop();

    if (stack.length === 1 && Array.isArray(stack[0])) {
      const mappedCard = mapCard(obj);

      if (mappedCard) {
        batch.push(mappedCard);
        count += 1;
      }

      stack[0].pop();

      if (batch.length >= BULK_IMPORT_BATCH_SIZE) {
        const batchToImport = batch;
        const countSoFar = count;
        batch = [];

        pendingImport = pendingImport.then(() =>
          importBatch(table, batchToImport, countSoFar, onConflict),
        );
      }
    }
  };

  parser.onclosearray = function () {
    stack.pop();
  };

  parser.onerror = function (err) {
    console.error("JSON parse error:", err);
    process.exit(1);
  };

  const reader = response.body.getReader();

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    parser.write(decoder.decode(value, { stream: true }));
    await pendingImport;
  }

  parser.write(decoder.decode());
  await pendingImport;

  if (batch.length > 0) {
    await importBatch(table, batch, count, onConflict);
  }

  console.log(`${table} import complete: ${count} rows`);
}

async function linkDefaultVariants() {
  console.log("Linking card_search default variants...");

  let lastId = null;
  let linkedCount = 0;

  while (true) {
    let searchQuery = supabase
      .from("card_search")
      .select("id, oracle_id, name, representative_scryfall_id")
      .not("representative_scryfall_id", "is", null)
      .order("id", { ascending: true })
      .limit(DEFAULT_LINK_BATCH_SIZE);

    if (lastId) {
      searchQuery = searchQuery.gt("id", lastId);
    }

    const { data: searchRows, error: searchError } = await searchQuery;

    if (searchError) {
      console.error("Could not load card_search rows for default linking:");
      logError(searchError);
      process.exit(1);
    }

    if (!searchRows || searchRows.length === 0) {
      break;
    }

    lastId = searchRows[searchRows.length - 1].id;

    const representativeIds = searchRows
      .map((row) => row.representative_scryfall_id)
      .filter(Boolean);

    const { data: variants, error: variantsError } = await supabase
      .from("card_variants")
      .select("id, scryfall_id")
      .in("scryfall_id", representativeIds);

    if (variantsError) {
      console.error("Could not load card_variants rows for default linking:");
      logError(variantsError);
      process.exit(1);
    }

    const variantByScryfallId = new Map(
      (variants || []).map((variant) => [variant.scryfall_id, variant]),
    );

    const updates = searchRows
      .map((row) => {
        const variant = variantByScryfallId.get(row.representative_scryfall_id);

        if (!variant) return null;

        return {
          id: row.id,
          oracle_id: row.oracle_id,
          name: row.name,
          default_variant_id: variant.id,
          default_variant_scryfall_id: variant.scryfall_id,
        };
      })
      .filter(Boolean);

    if (updates.length > 0) {
      const { error: updateError } = await supabase
        .from("card_search")
        .upsert(updates, { onConflict: "id" });

      if (updateError) {
        console.error("Could not update card_search default variants:");
        logError(updateError);
        process.exit(1);
      }
    }

    linkedCount += updates.length;

    if (linkedCount % IMPORT_LOG_INTERVAL === 0) {
      console.log(`Linked ${linkedCount} default variants`);
    }

    if (searchRows.length < DEFAULT_LINK_BATCH_SIZE) {
      break;
    }
  }

  console.log(`Default variant linking complete: ${linkedCount} linked`);
}

async function importCards() {
  if (auditOnly) {
    await auditImport();
    return;
  }

  if (importOracleCards) {
    await streamBulkCards({
      bulkType: "oracle-cards",
      table: "card_search",
      mapCard: mapCardSearch,
      onConflict: "oracle_id",
    });
  }

  if (importAllCards) {
    await streamBulkCards({
      bulkType: "all-cards",
      table: "card_variants",
      mapCard: mapCardVariant,
      onConflict: "scryfall_id",
    });
  }

  if (!args.has("--no-link")) {
    await linkDefaultVariants();
  }

  console.log(
    linkOnly ? "Scryfall v2 default linking complete!" : "Scryfall v2 import complete!",
  );
}

async function getExactCount(table, applyFilters = (query) => query) {
  const query = supabase.from(table).select("*", {
    count: "exact",
    head: true,
  });
  const { count, error } = await applyFilters(query);

  if (error) {
    console.error(`Could not count ${table}:`);
    logError(error);
    process.exit(1);
  }

  return count;
}

async function auditImport() {
  const cardSearchCount = await getExactCount("card_search");
  const cardVariantsCount = await getExactCount("card_variants");
  const unlinkedDefaultCount = await getExactCount("card_search", (query) =>
    query.is("default_variant_id", null),
  );
  const missingVariantOracleCount = await getExactCount(
    "card_variants",
    (query) => query.is("oracle_id", null),
  );

  console.log("Scryfall v2 import audit:");
  console.log(`card_search rows: ${cardSearchCount}`);
  console.log(`card_variants rows: ${cardVariantsCount}`);
  console.log(`card_search rows without default_variant_id: ${unlinkedDefaultCount}`);
  console.log(`card_variants rows without oracle_id: ${missingVariantOracleCount}`);
}

importCards().catch((error) => {
  console.error("Bulk import failed:");
  logError(error);
  process.exit(1);
});
