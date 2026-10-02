import {
  ExistingLiteratureNoteMatch,
  IDENTITY_FRONTMATTER_KEY,
  ITEM_KEY_FRONTMATTER_KEY,
  LIBRARY_ID_FRONTMATTER_KEY,
  LIBRARY_TYPE_FRONTMATTER_KEY,
  type LiteratureNoteCandidate,
  type LiteratureNoteIdentity,
} from "./literature-note-content-types";

export function getLiteratureNoteMatchPriority(
  frontmatter: Record<string, unknown> | null | undefined,
  identity: LiteratureNoteIdentity,
): number | null {
  const fm = frontmatter ?? {};
  const expected = `${identity.libraryType}/${identity.libraryId}/${identity.itemKey}`;
  const storedIdentity = fm[IDENTITY_FRONTMATTER_KEY];
  // A legacy key is ambiguous; it must never override explicit library identity.
  if (
    (storedIdentity != null &&
      storedIdentity !== expected &&
      storedIdentity !== identity.itemKey) ||
    (fm[ITEM_KEY_FRONTMATTER_KEY] != null &&
      fm[ITEM_KEY_FRONTMATTER_KEY] !== identity.itemKey) ||
    (fm[LIBRARY_TYPE_FRONTMATTER_KEY] != null &&
      fm[LIBRARY_TYPE_FRONTMATTER_KEY] !== identity.libraryType) ||
    (fm[LIBRARY_ID_FRONTMATTER_KEY] != null &&
      fm[LIBRARY_ID_FRONTMATTER_KEY] !== identity.libraryId)
  ) {
    return null;
  }
  if (storedIdentity === expected) return 0;
  if (fm[ITEM_KEY_FRONTMATTER_KEY] === identity.itemKey) {
    return fm[LIBRARY_ID_FRONTMATTER_KEY] === identity.libraryId &&
      fm[LIBRARY_TYPE_FRONTMATTER_KEY] === identity.libraryType
      ? 1
      : 2;
  }
  return storedIdentity === identity.itemKey ? 2 : null;
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
  const buckets: LiteratureNoteCandidate[][] = [[], [], []];
  for (const entry of entries) {
    const priority = getLiteratureNoteMatchPriority(
      entry.frontmatter,
      identity,
    );
    if (priority !== null) buckets[priority].push(entry);
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
