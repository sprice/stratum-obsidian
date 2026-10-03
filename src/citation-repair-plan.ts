import type { LiteratureNoteEntry } from "./library-search-modal";
import { citationResolver } from "./citation-resolution";
import { readBibliographyBindings } from "./document-sources";
import {
  resolveBibliographyCitekey,
  updateManagedBibliography,
} from "./bibtex-managed";
import { buildCitekey, formatPandocCitation } from "./bibtex-format";
import { citationAt } from "./citation-model";
import { parseSourceOccurrences } from "./source-occurrences";

export function planCitationRepair(
  text: string,
  oldKey: string,
  entry: LiteratureNoteEntry,
  entries: LiteratureNoteEntry[],
  bibliography: string,
  occurrence: number | "all",
) {
  if (!entry.identity || !/^(user|group)\/[^/]+\/[^/]+$/.test(entry.identity))
    throw new Error(
      "Sync this source first so it has a verified Zotero identity.",
    );
  const bindings = readBibliographyBindings(bibliography);
  const resolve = citationResolver(entries, bindings);
  let key: string | undefined;
  try {
    const established = resolveBibliographyCitekey(bibliography, entry);
    if (resolve(established).identity === entry.identity) key = established;
  } catch {
    /* Conflicting or manually changed keys need a new alias. */
  }
  if (!key || key === oldKey) {
    const base = buildCitekey({ ...entry, citationKey: null });
    const occupied = new Set([
      ...entries.map(buildCitekey),
      ...bindings.map((b) => b.key),
      ...[
        ...bibliography
          .replace(/^\s*%.*$/gm, "")
          .matchAll(/@\w+\s*[{(]\s*([^\s,]+)\s*,/g),
      ].map((m) => m[1]),
      ...parseSourceOccurrences(text)
        .filter((o) => o.kind === "citation")
        .map((o) => o.target),
    ]);
    key = base;
    for (let suffix = 2; occupied.has(key); suffix++) key = `${base}-${suffix}`;
  }
  const occurrences = parseSourceOccurrences(text).filter(
    (o) => o.kind === "citation" && o.target === oldKey,
  );
  const selected =
    occurrence === "all"
      ? occurrences
      : [occurrences[occurrence]].filter(Boolean);
  if (!selected.length)
    throw new Error("This citation is no longer in the paper.");
  const replacement = formatPandocCitation(key).slice(1, -1);
  const edits = selected.map((o) => {
    if (!citationAt(text, o.from)?.draft)
      throw new Error(
        "This occurrence uses unsupported citation syntax. Edit it directly; no changes were made.",
      );
    return {
      from: o.from,
      to: o.to,
      before: text.slice(o.from, o.to),
      after: replacement,
      excerpt: o.excerpt,
    };
  });
  return {
    key,
    edits,
    // Reusing a key is not permission to refresh shared reference metadata.
    bibliography: bindings.some(
      (binding) => binding.key === key && binding.identity === entry.identity,
    )
      ? bibliography
      : bibliography +
        (bibliography ? "\n" : "") +
        updateManagedBibliography("", entry, true, key),
  };
}
