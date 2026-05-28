import { useState } from "react";
import "./PackLibraryModal.css";

export default function PackLibraryModal({
  isOpen,
  packs,
  onClose,
  onOpenPack,
  onDeletePack,
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  if (!isOpen) return null;

  return (
    <div className="packModalOverlay" onClick={onClose}>
      <div className="packModal" onClick={(e) => e.stopPropagation()}>
        <div className="packModalHeader">
          <h2>My Packs</h2>

          <button onClick={onClose}>×</button>
        </div>

        {packs.length === 0 ? (
          <p className="emptyPackList">No saved packs yet.</p>
        ) : (
          <div className="packModalList">
            {packs.map((pack) => (
              <div className="packModalItem" key={pack.id}>
                <button
                  className="packModalOpen"
                  onClick={() => onOpenPack(pack.id)}
                >
                  <span>{pack.name}</span>

                  <small>{pack.description || "No description"}</small>
                </button>

                <button
                  className={`packDeleteButton ${
                    confirmDeleteId === pack.id ? "confirming" : ""
                  }`}
                  onClick={() => {
                    if (confirmDeleteId === pack.id) {
                      onDeletePack(pack.id);
                      setConfirmDeleteId(null);
                      return;
                    }

                    setConfirmDeleteId(pack.id);

                    setTimeout(() => {
                      setConfirmDeleteId((current) =>
                        current === pack.id ? null : current,
                      );
                    }, 3000);
                  }}
                >
                  {confirmDeleteId === pack.id ? "Confirm?" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
