import { getContentModerationMessage } from "./contentModeration";

export const PACK_TAG_LIMIT = 5;
export const PACK_TAG_WORD_LIMIT = 3;
export const PACK_TAG_WORD_MAX_LENGTH = 12;

export const PACK_TAG_COLORS = [
  { id: "red", label: "Red", value: "#ef6a5b" },
  { id: "orange", label: "Orange", value: "#e99a45" },
  { id: "gold", label: "Gold", value: "#d8bd58" },
  { id: "green", label: "Green", value: "#66b878" },
  { id: "blue", label: "Blue", value: "#68a8e8" },
  { id: "purple", label: "Purple", value: "#ad83df" },
  { id: "gray", label: "Gray", value: "#a7adb4" },
];

const DEFAULT_TAG_COLOR = "gray";
const LEGACY_TAG_COLORS = {
  Aggro: "red",
  Combo: "purple",
  Control: "blue",
  Midrange: "gold",
  Ramp: "green",
  Tempo: "gray",
};

function cleanTagSpacing(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function formatPackTagName(value) {
  return cleanTagSpacing(value)
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z]{2,5}$/.test(word)) return word;

      return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

export function normalizePackTagName(value) {
  return cleanTagSpacing(value).toLowerCase();
}

export function validatePackTagName(value) {
  const cleaned = cleanTagSpacing(value);

  if (!cleaned) return "Enter a tag name.";
  const moderationMessage = getContentModerationMessage(cleaned);

  if (moderationMessage) return moderationMessage;
  if (!/^[A-Za-z ]+$/.test(cleaned)) {
    return "Use letters and spaces only.";
  }

  const words = cleaned.split(" ");

  if (words.length > PACK_TAG_WORD_LIMIT) {
    return `Use ${PACK_TAG_WORD_LIMIT} words or fewer.`;
  }

  if (words.some((word) => word.length > PACK_TAG_WORD_MAX_LENGTH)) {
    return `Each word must be ${PACK_TAG_WORD_MAX_LENGTH} letters or fewer.`;
  }

  return "";
}

export function getPackTagColor(colorId) {
  return (
    PACK_TAG_COLORS.find((color) => color.id === colorId) ||
    PACK_TAG_COLORS.find((color) => color.id === DEFAULT_TAG_COLOR)
  );
}

export function normalizePackTag(tag) {
  const source = typeof tag === "string" ? { name: tag } : tag || {};
  const name = formatPackTagName(source.name);

  if (!name) return null;

  return {
    id: source.id || null,
    name,
    normalizedName: source.normalizedName || source.normalized_name || normalizePackTagName(name),
    color: source.color || LEGACY_TAG_COLORS[name] || DEFAULT_TAG_COLOR,
    usageCount: Number(source.usageCount ?? source.usage_count ?? 0),
  };
}

export function normalizePackTags(tags, limit = PACK_TAG_LIMIT) {
  const uniqueTags = new Map();

  (Array.isArray(tags) ? tags : tags ? [tags] : []).forEach((tag) => {
    const normalizedTag = normalizePackTag(tag);

    if (normalizedTag && !uniqueTags.has(normalizedTag.normalizedName)) {
      uniqueTags.set(normalizedTag.normalizedName, normalizedTag);
    }
  });

  return [...uniqueTags.values()].slice(0, limit);
}

export function getPackTagStyle(tag) {
  const color = getPackTagColor(normalizePackTag(tag)?.color);

  return {
    "--pack-tag-color": color.value,
  };
}
