import { formatPandocCitation } from "./bibtex-format";
import { parseSourceOccurrences } from "./source-occurrences";

export const locatorLabels = {
  "p.": "Page",
  "pp.": "Pages",
  "chap.": "Chapter",
  "sec.": "Section",
  "para.": "Paragraph",
  "vol.": "Volume",
};
export type LocatorLabel = keyof typeof locatorLabels;
export interface CitationItem {
  key: string;
  prefix: string;
  suffix: string;
  locator: string;
  label: LocatorLabel;
  suppressAuthor: boolean;
}
export interface CitationDraft {
  items: CitationItem[];
  narrative: boolean;
}
export function citationItem(key: string): CitationItem {
  return {
    key,
    prefix: "",
    suffix: "",
    locator: "",
    label: "p.",
    suppressAuthor: false,
  };
}
export function serializeCitation(draft: CitationDraft): string {
  if (!draft.items.length) throw new Error("Add at least one source.");
  if (draft.narrative && draft.items.length !== 1)
    throw new Error(
      "Narrative citations need one source. Use a parenthetical citation for a group.",
    );
  const parts = draft.items.map((item) => {
    for (const text of [item.prefix, item.suffix, item.locator]) {
      if (/[[\]{};@\n\r\\]/.test(text))
        throw new Error(
          "Citation details cannot contain brackets, braces, semicolons, @, backslashes, or line breaks.",
        );
    }
    if (
      item.locator.trim() &&
      !/^[\p{L}\p{N}][\p{L}\p{N}\s,.:–—-]*$/u.test(item.locator.trim())
    )
      throw new Error(
        "Use a page, range, or section identifier for the locator.",
      );
    const key = formatPandocCitation(item.key).slice(1, -1);
    const tail = [
      item.locator.trim() ? `${item.label} ${item.locator.trim()}` : "",
      item.suffix.trim(),
    ]
      .filter(Boolean)
      .join(", ");
    if (draft.narrative) {
      if (item.suppressAuthor)
        throw new Error("Narrative citations cannot suppress the author.");
      if (item.prefix.trim())
        throw new Error(
          "Write the introductory text before a narrative citation in your note.",
        );
      return `${key}${tail ? ` [${tail}]` : ""}`;
    }
    return `${item.prefix.trim() ? `${item.prefix.trim()} ` : ""}${item.suppressAuthor ? "-" : ""}${key}${tail ? `, ${tail}` : ""}`;
  });
  return draft.narrative ? parts[0] : `[${parts.join("; ")}]`;
}

/** Conservative editing: unknown syntax is rejected instead of simplified. */
export function parseCitation(raw: string): CitationDraft | null {
  const narrative = !raw.startsWith("[");
  const body = narrative ? raw : raw.endsWith("]") ? raw.slice(1, -1) : "";
  const chunks = narrative ? [body] : body.split(";");
  const items: CitationItem[] = [];
  for (const chunk of chunks) {
    const match =
      /^(.*?)\s*(-?)@(?:\{([^{}]+)\}|([\p{L}\p{N}_](?:[\p{L}\p{N}_]|[.:$&+?~/-](?=[\p{L}\p{N}_]))*))(.*)$/u.exec(
        chunk.trim(),
      );
    if (!match) return null;
    const item = citationItem(match[3] ?? match[4]);
    item.prefix = match[1].trim();
    item.suppressAuthor = match[2] === "-";
    let tail = match[5].trim();
    if (narrative && tail) {
      if (!tail.startsWith("[") || !tail.endsWith("]")) return null;
      tail = tail.slice(1, -1).trim();
    } else if (tail) {
      if (!tail.startsWith(",")) return null;
      tail = tail.slice(1).trim();
    }
    const locator = /^(p\.|pp\.|chap\.|sec\.|para\.|vol\.)\s+(.+)$/u.exec(tail);
    if (locator) {
      item.label = locator[1] as LocatorLabel;
      const parts = locator[2].split(/,\s*/);
      item.locator = parts.shift() ?? "";
      // Retain disjoint page lists as one locator; prose after a comma is a suffix.
      while (
        parts.length &&
        /^(?:[0-9]+|[ivxlcdm]+)(?:\s*[-–—]\s*(?:[0-9]+|[ivxlcdm]+))?$/i.test(
          parts[0],
        )
      ) {
        item.locator += `, ${parts.shift()}`;
      }
      item.suffix = parts.join(", ");
    } else item.suffix = tail;
    items.push(item);
  }
  const draft = { items, narrative };
  try {
    serializeCitation(draft);
    return draft;
  } catch {
    return null;
  }
}

export function citationAt(
  text: string,
  offset: number,
): { from: number; to: number; draft: CitationDraft | null } | null {
  const occurrences = parseSourceOccurrences(text).filter(
    (o) => o.kind === "citation",
  );
  // Find whole outer groups so nested/unsupported syntax never falls back to
  // editing only an inner key and leaving broken brackets around it.
  let depth = 0;
  let start = -1;
  for (let i = 0; i <= text.length; i++) {
    let slashes = 0;
    for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) slashes++;
    if (slashes % 2) continue;
    if (text[i] === "[") {
      if (depth++ === 0) start = i;
    }
    if (
      (text[i] === "]" && depth > 0 && --depth === 0) ||
      (i === text.length && depth > 0)
    ) {
      const to = Math.min(i + 1, text.length);
      if (
        offset >= start &&
        offset <= to &&
        occurrences.some((o) => o.from > start && o.to <= to)
      ) {
        return {
          from: start,
          to,
          draft: depth ? null : parseCitation(text.slice(start, to)),
        };
      }
    }
  }
  for (const occurrence of occurrences) {
    let from = occurrence.from;
    if (text[from - 1] === "-") from--;
    let to = occurrence.to;
    const tail = /^\s+\[[^[\]\n]*\]/.exec(text.slice(to));
    if (tail) to += tail[0].length;
    if (offset >= from && offset <= to)
      return { from, to, draft: parseCitation(text.slice(from, to)) };
  }
  return null;
}
