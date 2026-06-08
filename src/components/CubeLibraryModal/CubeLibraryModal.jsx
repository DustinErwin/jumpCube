import { useState } from "react";
import "./CubeLibraryModal.css";

/*
 * CubeLibraryModal lists saved cubes for the logged-in user.
 *
 * Props:
 * - isOpen: boolean
 * - cubes: Array<cubes table row>
 * - onClose()
 * - onOpenCube(cubeId)
 * - onDeleteCube(cubeId)
 */
export default function CubeLibraryModal({
  isOpen,
  cubes,
  onClose,
  onOpenCube,
  onDeleteCube,
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [cubeSearch, setCubeSearch] = useState("");

  const filteredCubes = cubes.filter((cube) => {
    // Metadata-only search; loadCube() hydrates packs/cards after selection.
    const query = cubeSearch.toLowerCase().trim();

    if (!query) return true;

    const name = cube.name?.toLowerCase() || "";
    const description = cube.description?.toLowerCase() || "";

    return name.includes(query) || description.includes(query);
  });

  if (!isOpen) return null;

  return (
    <div className="cubeModalOverlay" onClick={onClose}>
      <div className="cubeModal" onClick={(event) => event.stopPropagation()}>
        <div className="cubeModalHeader">
          <h2>My Cubes</h2>
          <input
            className="cubeSearchInput"
            type="text"
            placeholder="Search cubes..."
            value={cubeSearch}
            onChange={(event) => setCubeSearch(event.target.value)}
          />
          <button onClick={onClose}>x</button>
        </div>

        {filteredCubes.length === 0 ? (
          <p className="emptyCubeList">No saved cubes yet.</p>
        ) : (
          <div className="cubeModalList">
            {filteredCubes.map((cube) => (
              <div className="cubeModalItem" key={cube.id}>
                <button
                  className="cubeModalOpen"
                  onClick={() => onOpenCube(cube.id)}
                >
                  <span>{cube.name}</span>
                  <small>{cube.description || "No description"}</small>
                </button>

                <button
                  className={`cubeDeleteButton ${
                    confirmDeleteId === cube.id ? "confirming" : ""
                  }`}
                  onClick={() => {
                    // Two-click delete confirmation with a short auto-reset.
                    if (confirmDeleteId === cube.id) {
                      onDeleteCube(cube.id);
                      setConfirmDeleteId(null);
                      return;
                    }

                    setConfirmDeleteId(cube.id);

                    setTimeout(() => {
                      setConfirmDeleteId((current) =>
                        current === cube.id ? null : current,
                      );
                    }, 3000);
                  }}
                >
                  {confirmDeleteId === cube.id ? "Confirm?" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
