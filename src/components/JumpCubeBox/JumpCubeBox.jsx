import { useState } from "react";
import "./JumpCubeBox.css";

export default function JumpCubeBox({
  cubeName,
  setCubeName,
  cubeDescription,
  setCubeDescription,
  selectedPacks,
  saveCube,
  newCube,
  saveStatus,
}) {
  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [isOpen, setIsOpen] = useState(true);

  return (
    <aside className={`jumpCubeBox ${isOpen ? "open" : "closed"}`}>
      <button
        className="jumpCubeToggle"
        onClick={() => setIsOpen((prev) => !prev)}
        title={isOpen ? "Hide cube" : "Show cube"}
      >
        {isOpen ? "‹" : "›"}
      </button>

      {editingName ? (
        <input
          className="cubeNameInput"
          value={cubeName}
          autoFocus
          onChange={(e) => setCubeName(e.target.value)}
          onBlur={() => setEditingName(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setEditingName(false);
          }}
        />
      ) : (
        <h2 className="cubeTitle" onClick={() => setEditingName(true)}>
          {cubeName}
        </h2>
      )}

      {editingDescription ? (
        <textarea
          className="cubeDescriptionInput"
          value={cubeDescription}
          placeholder="Click to add a cube description..."
          autoFocus
          onChange={(e) => setCubeDescription(e.target.value)}
          onBlur={() => setEditingDescription(false)}
        />
      ) : (
        <p
          className="cubeDescription"
          onClick={() => setEditingDescription(true)}
          title="Click to edit description"
        >
          {cubeDescription || (
            <span className="placeholderText">
              Click to add a cube description...
            </span>
          )}
        </p>
      )}

      <p className="cubeCount">{selectedPacks.length} packs selected</p>

      <button
        className={`saveCubeButton ${saveStatus === "saving" ? "saving" : ""}`}
        onClick={saveCube}
        disabled={selectedPacks.length === 0 || saveStatus === "saving"}
      >
        {saveStatus === "saving" ? "Saving..." : "Save Cube"}
      </button>

      {saveStatus === "saved" && (
        <p className="saveMessage success">Cube saved ✓</p>
      )}

      {saveStatus === "error" && (
        <p className="saveMessage error">Save failed</p>
      )}

      <button className="newCubeButton" onClick={newCube}>
        New Cube
      </button>

      <div className="cubePackScrollArea">
        {selectedPacks.length === 0 ? (
          <p className="emptyCube">Add packs to build your Jump Cube.</p>
        ) : (
          <div className="cubePackList">
            {selectedPacks.map((pack) => (
              <div className="cubePackItem" key={pack.id}>
                <span>{pack.name}</span>
                <small>{pack.description || "No description"}</small>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
