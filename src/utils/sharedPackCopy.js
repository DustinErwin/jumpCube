export const PENDING_SHARED_PACK_COPY_KEY = "jumpCubePendingSharedPackCopy";
export const PENDING_OPEN_PACK_KEY = "jumpCubePendingOpenPack";

export function savePendingSharedPackCopy(packId) {
  if (!packId || typeof window === "undefined") return;

  window.localStorage.setItem(PENDING_SHARED_PACK_COPY_KEY, packId);
}

export function takePendingSharedPackCopy() {
  if (typeof window === "undefined") return null;

  const packId = window.localStorage.getItem(PENDING_SHARED_PACK_COPY_KEY);

  if (packId) {
    window.localStorage.removeItem(PENDING_SHARED_PACK_COPY_KEY);
  }

  return packId;
}

export function savePendingOpenPack(packId) {
  if (!packId || typeof window === "undefined") return;

  window.localStorage.setItem(PENDING_OPEN_PACK_KEY, packId);
}

export function takePendingOpenPack() {
  if (typeof window === "undefined") return null;

  const packId = window.localStorage.getItem(PENDING_OPEN_PACK_KEY);

  if (packId) {
    window.localStorage.removeItem(PENDING_OPEN_PACK_KEY);
  }

  return packId;
}
