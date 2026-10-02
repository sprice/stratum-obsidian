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
  const owned = entry.identity
    ? [...content.matchAll(blocks)].find(
        (match) => match[1] === encodeURIComponent(entry.identity!),
      )
    : undefined;
  let key = buildCitekey(entry);
  if (owned) {
    try {
      key = decodeURIComponent(owned[2]);
    } catch {
      throw new Error(
        "The managed bibliography marker has an invalid citation key.",
      );
    }
    const bodyKey = /^\s*@\w+\s*[({]\s*([^\s,]+)\s*,/.exec(owned[4])?.[1];
    if (bodyKey !== key)
      throw new Error(
        "The bibliography citation key was manually changed. Restore its managed key before inserting this citation.",
      );
  }
  assertValidCitationKey(key);
  const keys = [
    // Be conservative about inline entries too: ambiguity must never silently
    // attach a citation to another work. Ignore full-line BibTeX comments.
    ...content
      .replace(/^\s*%[^\n]*$/gm, "")
      .matchAll(/@\w+\s*[({]\s*([^\s,]+)\s*,/g),
  ].filter((match) => match[1] === key);
  if (keys.length > (owned ? 1 : 0)) {
    throw new Error(
      `Citation key ${key} already exists without unambiguous ownership. Use a unique Zotero citation key or resolve the duplicate in stratum.bib.`,
    );
  }
  return key;
}

export function updateManagedBibliography(
  content: string,
  entry: LiteratureNoteEntry,
  append: boolean,
): string {
  const key = append
    ? resolveBibliographyCitekey(content, entry)
    : buildCitekey(entry);
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
