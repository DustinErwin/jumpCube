import { supabase } from "../lib/supabaseClient";
import { sanitizeDescription, sanitizeTitle } from "../utils/userText";

/*
 * Pack service helpers.
 *
 * NOTE: The active app currently saves packs through usePackBuilder(), not this
 * service. This file imports ../lib/supabaseClient, while the active client is
 * src/utils/supabase.ts. If you decide to use this service again, first update
 * the import to the shared client and keep the argument shapes below in sync
 * with usePackBuilder.finishSave().
 */

export async function createPack({
  name,
  description,
  archetypeTags,
  visibility = "private",
}) {
  // Arguments mirror the packs table columns. visibility defaults private.
  const { data, error } = await supabase
    .from("packs")
    .insert({
      name: sanitizeTitle(name, "Unnamed Pack"),
      description: sanitizeDescription(description),
      archetype_tags: archetypeTags || [],
      visibility,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updatePack(
  packId,
  { name, description, archetypeTags, visibility = "private" },
) {
  // packId is a packs.id value. Fields are patch values for that saved pack.
  const { error } = await supabase
    .from("packs")
    .update({
      name: sanitizeTitle(name, "Unnamed Pack"),
      description: sanitizeDescription(description),
      archetype_tags: archetypeTags || [],
      visibility,
    })
    .eq("id", packId);

  if (error) throw error;
}

export async function savePackCards(packId, selectedCards) {
  // selectedCards shape: card rows plus quantity/manualMechanicBucket.
  const rows = selectedCards.map((card) => ({
    pack_id: packId,
    card_id: null,
    card_search_id: null,
    variant_id: null,
    oracle_id: card.oracle_id || null,
    variation_id: card.variation_id || card.scryfall_id || null,
    quantity: card.quantity,
    manual_mechanic_bucket: card.manualMechanicBucket || null,
  }));

  const { error } = await supabase
    .from("pack_cards")
    .insert(rows);

  if (error) throw error;
}
