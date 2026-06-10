/*
 * Shared sanitizers for user-authored pack/cube text.
 *
 * Goals:
 * - Allow normal punctuation, accents, symbols, and emoji.
 * - Remove invisible/control characters that can spoof or break UI.
 * - Keep text single-line and bounded so compact panels do not break.
 */

export const TITLE_MAX_LENGTH = 40;
export const DESCRIPTION_MAX_LENGTH = 500;

const HORIZONTAL_SPACE_PATTERN = /[ \t\f\v]+/g;
const LINE_BREAK_PATTERN = /\r\n?|\n/g;

function isDisallowedCharacter(character) {
  const codePoint = character.codePointAt(0);

  return (
    codePoint <= 0x0008 ||
    codePoint === 0x000b ||
    codePoint === 0x000c ||
    (codePoint >= 0x000e && codePoint <= 0x001f) ||
    (codePoint >= 0x007f && codePoint <= 0x009f) ||
    codePoint === 0x00ad ||
    codePoint === 0x034f ||
    codePoint === 0x061c ||
    codePoint === 0x115f ||
    codePoint === 0x1160 ||
    codePoint === 0x17b4 ||
    codePoint === 0x17b5 ||
    codePoint === 0x180e ||
    codePoint === 0x200b ||
    codePoint === 0x200c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x2028 && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x206f) ||
    codePoint === 0xfeff ||
    codePoint === 0xffa0
  );
}

export function sanitizeUserText(value, {
  maxLength = DESCRIPTION_MAX_LENGTH,
  fallback = "",
  singleLine = false,
} = {}) {
  /*
   * value: unknown user input.
   * options:
   * - maxLength: final string cap after cleanup.
   * - fallback: returned when cleaned text is empty.
   * - singleLine: true for pack/cube titles; false for descriptions.
  */
  const rawText = String(value || "");
  const withoutControls = Array.from(rawText)
    .filter((character) => !isDisallowedCharacter(character))
    .join("");
  const normalizedLines = singleLine
    ? withoutControls.replace(LINE_BREAK_PATTERN, " ")
    : withoutControls.replace(LINE_BREAK_PATTERN, "\n");
  const cleanedText = normalizedLines
    .split("\n")
    .map((line) => line.replace(HORIZONTAL_SPACE_PATTERN, " ").trim())
    .join("\n")
    .trim()
    .slice(0, maxLength);

  return cleanedText || fallback;
}

export function sanitizeTitle(value, fallback = "Untitled") {
  return sanitizeUserText(value, {
    maxLength: TITLE_MAX_LENGTH,
    fallback,
    singleLine: true,
  });
}

export function sanitizeDescription(value) {
  return sanitizeUserText(value, {
    maxLength: DESCRIPTION_MAX_LENGTH,
    fallback: "",
    singleLine: true,
  });
}
