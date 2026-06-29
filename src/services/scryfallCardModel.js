const DEFAULT_LEGALITIES = {};

function getImageUris(card) {
  return (
    card?.image_uris ||
    card?.card_faces?.find((face) => face.image_uris)?.image_uris ||
    null
  );
}

function getBackImageUrl(card) {
  return card?.card_faces?.[1]?.image_uris?.normal || null;
}

function getFaceOracleText(card) {
  if (!Array.isArray(card?.card_faces)) return "";

  return card.card_faces
    .map((face) => face.oracle_text)
    .filter(Boolean)
    .join("\n//\n");
}

function getFaceManaCost(card) {
  if (!Array.isArray(card?.card_faces)) return "";

  return card.card_faces
    .map((face) => face.mana_cost)
    .filter(Boolean)
    .join(" // ");
}

function getUsdPrice(prices = {}) {
  return prices.usd || prices.usd_foil || prices.usd_etched || null;
}

export function normalizeScryfallCard(card, quantity = 1) {
  if (!card) return null;

  const imageUris = getImageUris(card);
  const oracleText = card.oracle_text || getFaceOracleText(card);
  const manaCost = card.mana_cost || getFaceManaCost(card);
  const scryfallId = card.id;

  return {
    ...card,
    id: scryfallId,
    card_search_id: scryfallId,
    variant_id: scryfallId,
    variation_id: scryfallId,
    scryfall_id: scryfallId,
    representative_scryfall_id: scryfallId,
    default_variant_id: scryfallId,
    default_variant_scryfall_id: scryfallId,
    oracle_id: card.oracle_id || null,
    name: card.name || "",
    mana_value: Number(card.cmc ?? card.mana_value ?? 0),
    colors: card.colors || [],
    color_identity: card.color_identity || [],
    type_line: card.type_line || "",
    oracle_text: oracleText,
    rarity: card.rarity || "",
    image_url: imageUris?.normal || imageUris?.small || null,
    back_image_url: getBackImageUrl(card),
    image_uris: imageUris || card.image_uris || null,
    legalities: card.legalities || DEFAULT_LEGALITIES,
    price_usd: getUsdPrice(card.prices),
    price_usd_foil: card.prices?.usd_foil || null,
    price_usd_etched: card.prices?.usd_etched || null,
    games: card.games || [],
    nonfoil: card.nonfoil ?? true,
    is_token: Boolean(card.layout === "token" || card.type_line?.includes("Token")),
    is_funny: card.set_type === "funny" || card.border_color === "silver",
    is_variant_printing: false,
    is_planechase: /\bplane\b/i.test(card.type_line || ""),
    set_name: card.set_name || "",
    set_code: card.set || card.set_code || "",
    collector_number: card.collector_number || "",
    released_at: card.released_at || "",
    has_back_face: Boolean(card.card_faces?.[1]),
    mana_cost: manaCost,
    edhrec_rank: card.edhrec_rank || null,
    quantity,
    is_default_printing: true,
  };
}

export function normalizeScryfallCards(cards, quantity = 1) {
  return (cards || [])
    .map((card) => normalizeScryfallCard(card, quantity))
    .filter(Boolean);
}
