import {
  ExistingLiteratureNoteMatch,
  IDENTITY_FRONTMATTER_KEY,
  ITEM_KEY_FRONTMATTER_KEY,
  LIBRARY_ID_FRONTMATTER_KEY,
  LIBRARY_TYPE_FRONTMATTER_KEY,
  type LiteratureNoteCandidate,
  type LiteratureNoteIdentity,
} from "./literature-note-content-types";

function getLegacyItemIdentity(itemKey: string): string {
  return itemKey;
}

function prioritizeCandidates(
  entries: LiteratureNoteCandidate[],
  preferredFolder?: string,
): LiteratureNoteCandidate[] {
  const normalizedPreferredFolder = preferredFolder?.replace(/\/+$/, "");

  return [...entries].sort((left, right) => {
    const leftPreferred =
      normalizedPreferredFolder &&
      left.path.startsWith(`${normalizedPreferredFolder}/`)
        ? 1
        : 0;
    const rightPreferred =
      normalizedPreferredFolder &&
      right.path.startsWith(`${normalizedPreferredFolder}/`)
        ? 1
        : 0;

    if (leftPreferred !== rightPreferred) {
      return rightPreferred - leftPreferred;
    }

    return left.path.localeCompare(right.path);
  });
}

export function findExistingLiteratureNoteMatch(
  entries: LiteratureNoteCandidate[],
  identity: LiteratureNoteIdentity,
  preferredFolder?: string,
): ExistingLiteratureNoteMatch | null {
  const itemIdentity = `${identity.libraryType}/${identity.libraryId}/${identity.itemKey}`;
  const legacyIdentity = getLegacyItemIdentity(identity.itemKey);
  const buckets: LiteratureNoteCandidate[][] = [[], [], []];

  for (const entry of entries) {
    const frontmatter = entry.frontmatter ?? {};

    if (frontmatter[IDENTITY_FRONTMATTER_KEY] === itemIdentity) {
      buckets[0].push(entry);
      continue;
    }

    if (
      frontmatter[LIBRARY_ID_FRONTMATTER_KEY] === identity.libraryId &&
      frontmatter[LIBRARY_TYPE_FRONTMATTER_KEY] === identity.libraryType &&
      frontmatter[ITEM_KEY_FRONTMATTER_KEY] === identity.itemKey
    ) {
      buckets[1].push(entry);
      continue;
    }

    if (
      frontmatter[IDENTITY_FRONTMATTER_KEY] === legacyIdentity ||
      frontmatter[ITEM_KEY_FRONTMATTER_KEY] === identity.itemKey
    ) {
      buckets[2].push(entry);
    }
  }

  for (const bucket of buckets) {
    if (bucket.length === 0) {
      continue;
    }

    const prioritized = prioritizeCandidates(bucket, preferredFolder);
    return {
      candidate: prioritized[0],
      duplicateCount: prioritized.length,
    };
  }

  return null;
}
