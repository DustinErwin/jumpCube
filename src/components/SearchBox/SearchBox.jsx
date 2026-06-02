import "./SearchBox.css";

export default function SearchBox({ searchInput, setSearchInput, onSearch }) {
  function handleSubmit(event) {
    event.preventDefault();
    onSearch();
  }

  return (
    <form className="searchBox" onSubmit={handleSubmit}>
      <input
        className="searchInput"
        type="search"
        placeholder="Search name, type, or rules text..."
        value={searchInput}
        onChange={(event) => setSearchInput(event.target.value)}
      />

      <button className="searchButton" type="submit">
        Search
      </button>
    </form>
  );
}
