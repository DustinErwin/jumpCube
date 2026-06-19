export const BASIC_LAND_SET_STORAGE_KEY = "jumpCubeBasicLandSetCode";

export function normalizeBasicLandSetCode(value) {
  return String(value || "").trim().toLowerCase();
}

export function getStoredBasicLandSetCode() {
  if (typeof window === "undefined") return "";

  return normalizeBasicLandSetCode(
    window.localStorage.getItem(BASIC_LAND_SET_STORAGE_KEY),
  );
}

export function setStoredBasicLandSetCode(value) {
  if (typeof window === "undefined") return;

  const normalizedValue = normalizeBasicLandSetCode(value);

  if (normalizedValue) {
    window.localStorage.setItem(BASIC_LAND_SET_STORAGE_KEY, normalizedValue);
  } else {
    window.localStorage.removeItem(BASIC_LAND_SET_STORAGE_KEY);
  }
}
