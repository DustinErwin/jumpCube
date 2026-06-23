import "./SearchBox.css";

/*
 * SearchBox is a controlled form.
 *
 * Props:
 * - searchInput: current editable text
 * - setSearchInput(next): updates text as user types
 * - searchScopes/setSearchScopes: Title/Type/Text field switches
 * - onSearch(): commits the searchInput in App, which triggers useCards()
 */
export default function SearchBox({
  searchInput,
  setSearchInput,
  searchScopes,
  setSearchScopes,
  onSearch,
}) {
  function handleSubmit(event) {
    // Prevent page navigation and let App decide when the query is committed.
    event.preventDefault();
    onSearch();
  }

  function toggleScope(scope) {
    setSearchScopes((currentScopes) => ({
      ...currentScopes,
      [scope]: !currentScopes[scope],
    }));
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

      <div className="searchScopeToggles" aria-label="Search fields">
        {[
          ["title", "Title"],
          ["type", "Type"],
          ["text", "Text"],
        ].map(([scope, label]) => (
          <label className="searchScopeToggle" key={scope}>
            <input
              type="checkbox"
              checked={Boolean(searchScopes?.[scope])}
              onChange={() => toggleScope(scope)}
            />
            {label}
          </label>
        ))}
      </div>
    </form>
  );
}
