import type { LiteratureNoteEntry } from "./library-search-modal";
import { buildBibtexEntry, buildCitekey } from "./bibtex-format";

// The baseline is encoded verbatim so manual edits are detected without a
// lossy hash or a separate state file. Unmarked entries are never adopted.
const blocks =
  /^% stratum:begin (\S+) (\S+) (\S+)\r?\n([\s\S]*?)\r?\n% stratum:end(?=\r?$)/gm;
function block(identity: string, key: string, body: string): string {
  return `% stratum:begin ${encodeURIComponent(identity)} ${encodeURIComponent(key)} ${encodeURIComponent(body)}\n${body}\n% stratum:end`;
}
export function updateManagedBibliography(
  content: string,
  entry: LiteratureNoteEntry,
  append: boolean,
): string {
  const key = buildCitekey(entry);
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
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`@\\w+\\s*[({]\\s*${escapedKey}\\s*,`).test(output))
    return output;
  const body = buildBibtexEntry(entry);
  const addition = identity ? block(identity, key, body) : body;
  output = `${output.trimEnd()}${output.trim() ? "\n\n" : ""}${addition}\n`;
  return output;
}
