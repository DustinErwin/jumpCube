export const CONTENT_MODERATION_MESSAGE =
  "Please remove inappropriate language or hate speech. Keep community text respectful.";

// Keep these lowercase. Matching normalizes common number substitutions,
// repeated letters, and separators before checking whole words or phrases.
const BLOCKED_WORDS = [
  "asshole",
  "bastard",
  "bitch",
  "cunt",
  "dickhead",
  "fuck",
  "motherfucker",
  "shit",
  "whore",
  "chink",
  "coon",
  "cracker",
  "dyke",
  "fag",
  "faggot",
  "gook",
  "homo",
  "jap",
  "kike",
  "nigga",
  "nigger",
  "paki",
  "retard",
  "shemale",
  "spic",
  "tranny",
  "wetback",
];

const BLOCKED_PHRASES = [
  "white power",
  "heil hitler",
  "gas the jews",
  "kill all jews",
  "kill all gays",
  "kill all blacks",
  "kill all muslims",
  "kill all trans",
];

const LEET_CHARACTERS = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
};

function normalizeModeratedText(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[0134578]/g, (character) => LEET_CHARACTERS[character])
    .replace(/[^a-z]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function collapseRepeatedLetters(value) {
  return value.replace(/([a-z])\1+/g, "$1");
}

function getWordCandidates(words) {
  const candidates = new Set(words);

  // Detect separators used between individual letters, such as f.a.g.
  for (let start = 0; start < words.length; start += 1) {
    if (words[start].length !== 1) continue;

    let joinedLetters = "";

    for (let end = start; end < words.length && words[end].length === 1; end += 1) {
      joinedLetters += words[end];

      if (joinedLetters.length >= 3) candidates.add(joinedLetters);
      if (joinedLetters.length >= 12) break;
    }
  }

  return [...candidates];
}

export function hasBlockedContent(value) {
  const normalizedText = normalizeModeratedText(value);

  if (!normalizedText) return false;

  const paddedText = ` ${normalizedText} `;
  const words = getWordCandidates(normalizedText.split(" "));

  const hasBlockedWord = BLOCKED_WORDS.some((term) => {
    const termPattern = new RegExp(`^${term}(?:s|es|ed|ing|er|ers|y)?$`);

    return words.some((word) =>
      termPattern.test(word) || termPattern.test(collapseRepeatedLetters(word)),
    );
  });

  if (hasBlockedWord) return true;

  return BLOCKED_PHRASES.some((phrase) =>
    paddedText.includes(` ${phrase} `),
  );
}

export function getContentModerationMessage(value) {
  return hasBlockedContent(value) ? CONTENT_MODERATION_MESSAGE : "";
}

export function hasBlockedContentInFields(...values) {
  return values.some(hasBlockedContent);
}
