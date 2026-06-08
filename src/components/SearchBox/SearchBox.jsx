import "./SearchBox.css";

/*
 * SearchBox is a controlled form.
 *
 * Props:
 * - searchInput: current editable text
 * - setSearchInput(next): updates text as user types
 * - onSearch(): commits the searchInput in App, which triggers useCards()
 */
export default function SearchBox({ searchInput, setSearchInput, onSearch }) {
  function handleSubmit(event) {
    // Prevent page navigation and let App decide when the query is committed.
    event.preventDefault();
    onSearch();
  }

  return (
    <form className="searchBox" onSubmit={handleSubmit}>
      <input
        className="searchInput"
        type="search"
        placeholder="Search cards or Scryfall syntax..."
        value={searchInput}
        onChange={(event) => setSearchInput(event.target.value)}
      />

      <button className="searchButton" type="submit">
        Search
      </button>
    </form>
  );
}
