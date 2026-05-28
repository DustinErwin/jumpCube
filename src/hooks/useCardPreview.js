import { useState } from "react";

export function useCardPreview(delay = 250) {
  const [preview, setPreview] = useState(null);
  const [hoverTimer, setHoverTimer] = useState(null);

  function startPreview(card, e) {
    const timer = setTimeout(() => {
      setPreview({
        card,
        x: e.clientX,
        y: e.clientY,
      });
    }, delay);

    setHoverTimer(timer);
  }

  function movePreview(e) {
    setPreview((prev) =>
      prev
        ? {
            ...prev,
            x: e.clientX,
            y: e.clientY,
          }
        : null,
    );
  }

  function stopPreview() {
    clearTimeout(hoverTimer);
    setPreview(null);
  }

  return {
    preview,
    startPreview,
    movePreview,
    stopPreview,
  };
}
