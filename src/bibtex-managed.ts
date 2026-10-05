import type { LiteratureNoteEntry } from "./library-search-modal";
import {
  assertValidCitationKey,
  buildBibtexEntry,
  buildCitekey,
} from "./bibtex-format";

// The baseline is encoded verbatim so manual edits are detected without a
// lossy hash or a separate state file. Unmarked entries are never adopted.
const blocks =
  /^% stratum:begin (\S+) (\S+) (\S+)\r?\n([\s\S]*?)\r?\n% stratum:end(?=\r?$)/gm;
function block(identity: string, key: string, body: string): string {
  return `% stratum:begin ${encodeURIComponent(identity)} ${encodeURIComponent(key)} ${encodeURIComponent(body)}\n${body}\n% stratum:end`;
}
/** Reuse a managed item's established key even after Zotero metadata changes. */
export function resolveBibliographyCitekey(
  content: string,
  entry: LiteratureNoteEntry,
): string {
  return bibliographyKeyResolver(content)(entry);
}

/** Parse the bibliography once when building a picker for a large library. */
export function bibliographyKeyResolver(
  content: string,
): (entry: LiteratureNoteEntry) => string {
  const owned = new Map<string, RegExpMatchArray[]>();
  for (const match of content.matchAll(blocks))
    owned.set(match[1], [...(owned.get(match[1]) ?? []), match]);
  const counts = new Map<string, number>();
  for (const match of content
    .replace(/^\s*%[^\n]*$/gm, "")
    .matchAll(/@\w+\s*[({]\s*([^\s,]+)\s*,/g))
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  return (entry) => {
    const candidates = entry.identity
      ? (owned.get(encodeURIComponent(entry.identity)) ?? [])
      : [];
    let error: unknown;
    for (const match of candidates.length ? candidates : [undefined]) {
      try {
        const key = match ? decodeURIComponent(match[2]) : buildCitekey(entry);
        if (
          match &&
          /^\s*@\w+\s*[({]\s*([^\s,]+)\s*,/.exec(match[4])?.[1] !== key
        )
          throw new Error(
            "The bibliography citation key was manually changed. Repair it in Citations before inserting this citation.",
          );
        assertValidCitationKey(key);
        if ((counts.get(key) ?? 0) > (match ? 1 : 0))
          throw new Error(
            `Citation key ${key} already exists without unambiguous ownership. Repair this reference in Citations.`,
          );
        return key;
      } catch (cause) {
        error = cause;
      }
    }
    throw error;
  };
}

export function updateManagedBibliography(
  content: string,
  entry: LiteratureNoteEntry,
  append: boolean,
  explicitKey?: string,
): string {
  if (explicitKey) {
    assertValidCitationKey(explicitKey);
    const owns = [...content.matchAll(blocks)].some(
      (match) =>
        match[1] === encodeURIComponent(entry.identity ?? "") &&
        match[2] === encodeURIComponent(explicitKey) &&
        /^\s*@\w+\s*[({]\s*([^\s,]+)\s*,/.exec(match[4])?.[1] === explicitKey,
    );
    const count = [
      ...content
        .replace(/^\s*%[^\n]*$/gm, "")
        .matchAll(/@\w+\s*[({]\s*([^\s,]+)\s*,/g),
    ].filter((match) => match[1] === explicitKey).length;
    if (count > (owns ? 1 : 0))
      throw new Error(
        "Citation key already exists without unambiguous ownership.",
      );
  }
  const key =
    explicitKey ??
    (append ? resolveBibliographyCitekey(content, entry) : buildCitekey(entry));
  const identity = entry.identity;
  let found = false;
  let output = content.replace(
    blocks,
    (
      whole: string,
      owner: string,
      storedKey: string,
      baseline: string,
      body: string,
    ) => {
      if (!identity || owner !== encodeURIComponent(identity)) {
        if (append && storedKey === encodeURIComponent(key))
          throw new Error(
            `Citation key ${key} belongs to another Zotero item.`,
          );
        return whole;
      }
      if (append && storedKey !== encodeURIComponent(key)) return whole;
      found = true;
      // Keep edits to an owned entry; never overwrite them during a refresh.
      if (encodeURIComponent(body) !== baseline) return whole;
      let oldKey: string;
      try {
        oldKey = decodeURIComponent(storedKey);
      } catch {
        return whole;
      }
      // Retain existing keys during sync so citations in other notes still work.
      return block(identity, oldKey, buildBibtexEntry(entry, oldKey));
    },
  );
  if (!append || found) return output;
  const body = buildBibtexEntry(entry, key);
  const addition = identity ? block(identity, key, body) : body;
  output = `${output.trimEnd()}${output.trim() ? "\n\n" : ""}${addition}\n`;
  return output;
}
