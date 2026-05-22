import "./SearchBox.css";

export default function SearchBox({ search, setSearch }) {
  return (
    <input
      className="searchInput"
      type="text"
      placeholder="Search name, type, or rules text..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
    />
  );
}
