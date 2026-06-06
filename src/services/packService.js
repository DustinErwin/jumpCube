import { supabase } from "../lib/supabaseClient";

export async function createPack({
  name,
  description,
  archetypeTags,
  visibility = "private",
}) {
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
