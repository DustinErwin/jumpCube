import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";

const CARD_COLUMNS = `
  id,
  scryfall_id,
  name,
  mana_value,
  colors,
  color_identity,
  type_line,
  oracle_text,
  rarity,
  image_url,
  back_image_url,
  legalities,
  price_usd,
  price_usd_foil
`;

export function useCards(limit = 5000) {
  const [cardList, setCardList] = useState([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [cardsError, setCardsError] = useState(null);

  useEffect(() => {
    async function getCards() {
      setLoadingCards(true);
      setCardsError(null);

      const { data, error } = await supabase
        .from("cards")
        .select(
          `
            id,
            scryfall_id,
            name,
            mana_value,
            colors,
            color_identity,
            type_line,
            oracle_text,
            rarity,
            image_url,
            back_image_url,
            legalities,
            price_usd,
            price_usd_foil
        `,
        )
        .order("name", { ascending: true })
        .limit(limit);

      if (error) {
        console.error("Error loading cards:", error);
        setCardsError(error);
        setCardList([]);
        setLoadingCards(false);
        return;
      }

      setCardList(data || []);
      setLoadingCards(false);
    }

    getCards();
  }, [limit]);

  return {
    cardList,
    loadingCards,
    cardsError,
  };
}
