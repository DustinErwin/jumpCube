/*
 * DISCONNECTED: legacy Supabase card search implementation.
 *
 * Active card search now uses Scryfall through:
 * - src/services/scryfallApi.js
 * - src/services/cardSearchService.js
 * - src/hooks/useCards.js
 *
 * This stub is intentionally kept only as a migration marker. Do not import it
 * from application code.
 */

export function useLegacySupabaseCards() {
  throw new Error(
    "Legacy Supabase card search is disconnected. Use useCards() instead.",
  );
}
