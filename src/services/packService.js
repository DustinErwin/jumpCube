import { supabase } from "../lib/supabaseClient";

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
      name,
      description,
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
      name,
      description,
      archetype_tags: archetypeTags || [],
      visibility,
    })
    .eq("id", packId);

  if (error) throw error;
}

export async function savePackCards(packId, selectedCards) {
  // selectedCards shape: [{ id: card_id, quantity, manualMechanicBucket? }].
  const rows = selectedCards.map((card) => ({
    pack_id: packId,
    card_id: card.id,
    quantity: card.quantity,
    manual_mechanic_bucket: card.manualMechanicBucket || null,
  }));

  const { error } = await supabase
    .from("pack_cards")
    .upsert(rows, { onConflict: "pack_id,card_id" });

  if (error) throw error;
}
