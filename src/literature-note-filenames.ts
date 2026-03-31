import type { ZoteroItemDetail } from "./backend-client";

export type LiteratureNoteFilenameFormat = "readable" | "citekey";

const MAX_READABLE_TITLE_LENGTH = 80;
const ILLEGAL_FILENAME_CHARACTERS = /[/\\:*?"<>|]/g;
const SIGNIFICANT_TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function stripCombiningMarks(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export function removeIllegalFilenameCharacters(value: string): string {
  return collapseWhitespace(value.replace(ILLEGAL_FILENAME_CHARACTERS, ""));
}

function truncateAtWordBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const truncated = value.slice(0, maxLength);
  const lastSpaceIndex = truncated.lastIndexOf(" ");
  if (lastSpaceIndex >= 0) {
    return truncated.slice(0, lastSpaceIndex).trimEnd();
  }

  return truncated.trimEnd();
}

function getCreatorLastName(creator: string): string {
  const normalized = collapseWhitespace(creator);
  if (!normalized) {
    return "";
  }

  if (normalized.includes(",")) {
    return collapseWhitespace(normalized.split(",")[0] ?? "");
  }

  const parts = normalized.split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function findQualifyingHyphenSeparator(title: string): number {
  let index = title.indexOf(" - ");
  while (index >= 0) {
    const before = title.slice(0, index).trim();
    const after = title.slice(index + 3).trim();
    if (before.length >= 20 && after.length >= 20) {
      return index;
    }

    index = title.indexOf(" - ", index + 3);
  }

  return -1;
}

function findSubtitleSeparatorIndex(title: string): number {
  const candidates = [
    title.indexOf(":"),
    title.indexOf(" — "),
    findQualifyingHyphenSeparator(title),
  ].filter((index) => index >= 0);

  if (candidates.length === 0) {
    return -1;
  }

  return Math.min(...candidates);
}

function splitSubtitle(title: string): string {
  const separatorIndex = findSubtitleSeparatorIndex(title);
  if (separatorIndex < 0) {
    return title;
  }

  return title.slice(0, separatorIndex);
}

function toAsciiWord(value: string): string {
  return stripCombiningMarks(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getFirstSignificantTitleWord(title: string): string {
  const words = collapseWhitespace(title).match(/[\p{L}\p{N}]+/gu) ?? [];

  const significant =
    words.find(
      (word) => !SIGNIFICANT_TITLE_STOP_WORDS.has(word.toLowerCase()),
    ) ??
    words[0] ??
    "untitled";

  return significant;
}

function toAlphabeticSuffix(index: number): string {
  let value = index;
  let output = "";

  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(97 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }

  return output;
}

export function getCollisionSuffix(collisionIndex: number): string {
  if (collisionIndex <= 0) {
    return "";
  }

  return toAlphabeticSuffix(collisionIndex + 1);
}

export function getReadableAuthorLabel(creators: string[]): string {
  const lastNames = creators
    .map((creator) => getCreatorLastName(creator))
    .filter(Boolean);

  if (lastNames.length === 0) {
    return "Unknown Author";
  }

  if (lastNames.length === 1) {
    return lastNames[0];
  }

  if (lastNames.length === 2) {
    return `${lastNames[0]} & ${lastNames[1]}`;
  }

  return `${lastNames[0]} et al`;
}

export function getReadableYearLabel(year: string | null): string {
  return collapseWhitespace(year ?? "") || "n.d.";
}

export function getReadableTitleVariants(rawTitle: string): {
  mainTitle: string;
  fileTitle: string;
  fullTitle: string;
} {
  const normalizedFullTitle = collapseWhitespace(rawTitle) || "Untitled";
  const mainTitle =
    removeIllegalFilenameCharacters(splitSubtitle(normalizedFullTitle)) ||
    "Untitled";
  const fileTitle =
    truncateAtWordBoundary(mainTitle, MAX_READABLE_TITLE_LENGTH) || "Untitled";

  return {
    mainTitle,
    fileTitle,
    fullTitle: normalizedFullTitle,
  };
}

export function getReadableFileStem(
  detail: ZoteroItemDetail,
  collisionSuffix = "",
): string {
  const authorLabel = getReadableAuthorLabel(detail.item.creators);
  const yearLabel = `${getReadableYearLabel(detail.item.year)}${collisionSuffix}`;
  const title = getReadableTitleVariants(detail.item.title).fileTitle;
  return (
    removeIllegalFilenameCharacters(`${authorLabel} ${yearLabel} - ${title}`) ||
    "Untitled"
  );
}

export function getGeneratedCitekeyStem(
  detail: ZoteroItemDetail,
  collisionSuffix = "",
): string {
  const firstCreatorLastName =
    toAsciiWord(getCreatorLastName(detail.item.creators[0] ?? "")) || "unknown";
  const year = toAsciiWord(detail.item.year ?? "") || "nd";
  const significantTitleWord =
    toAsciiWord(getFirstSignificantTitleWord(detail.item.title)) || "untitled";

  return `@${firstCreatorLastName}${year}${collisionSuffix}${significantTitleWord}`;
}

export function getGeneratedFileStem(
  detail: ZoteroItemDetail,
  format: LiteratureNoteFilenameFormat,
  collisionSuffix = "",
): string {
  return format === "citekey"
    ? getGeneratedCitekeyStem(detail, collisionSuffix)
    : getReadableFileStem(detail, collisionSuffix);
}

export function getGeneratedFileName(
  detail: ZoteroItemDetail,
  format: LiteratureNoteFilenameFormat,
  collisionSuffix = "",
): string {
  return `${getGeneratedFileStem(detail, format, collisionSuffix)}.md`;
}

export function getAsciiFallbackFileStem(stem: string): string {
  return (
    removeIllegalFilenameCharacters(stripCombiningMarks(stem)) || "Untitled"
  );
}

export function isLegacyManagedFileStem(stem: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*--(?:user|group)-[a-z0-9-]+-[a-z0-9]+$/i.test(
    stem,
  );
}

export function resolveExistingFilenameStemState(params: {
  currentStem: string;
  storedStem: string | null;
  desiredStem: string;
  previousVersion: number | null;
  currentVersion: number;
}): {
  shouldRename: boolean;
  nextStoredStem: string | null;
} {
  const {
    currentStem,
    storedStem,
    desiredStem,
    previousVersion,
    currentVersion,
  } = params;

  if (storedStem) {
    if (currentStem !== storedStem) {
      return {
        shouldRename: false,
        nextStoredStem: storedStem,
      };
    }

    return {
      shouldRename: desiredStem !== currentStem,
      nextStoredStem: desiredStem !== currentStem ? desiredStem : currentStem,
    };
  }

  const isRecognizedManagedStem =
    currentStem === desiredStem || isLegacyManagedFileStem(currentStem);
  if (!isRecognizedManagedStem) {
    return {
      shouldRename: false,
      nextStoredStem: null,
    };
  }

  const versionChanged =
    previousVersion !== null && previousVersion !== currentVersion;
  if (versionChanged && desiredStem !== currentStem) {
    return {
      shouldRename: true,
      nextStoredStem: desiredStem,
    };
  }

  return {
    shouldRename: false,
    nextStoredStem: currentStem,
  };
}
