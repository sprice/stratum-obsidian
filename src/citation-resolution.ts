import { buildCitekey } from "./bibtex-format";
import type { LiteratureNoteEntry } from "./library-search-modal";
import type { BibliographyBinding } from "./document-sources";
import type { CslItem } from "./csl-data";

export interface CitationResolution {
  key: string;
  identity?: string;
  candidates: string[];
  notes: LiteratureNoteEntry[];
  reference?: CslItem;
  problem?: "unknown-key" | "conflicting-key" | "missing-data";
}

/** Ownership and note availability are independent: duplicate notes are not duplicate sources. */
export function citationResolver(
  entries: LiteratureNoteEntry[],
  bindings: BibliographyBinding[],
  data: CslItem[] = [],
): (key: string) => CitationResolution {
  const owners = new Map<string, Set<string>>();
  const notes = new Map<string, LiteratureNoteEntry[]>();
  const references = new Map(data.map((item) => [item.id, item]));
  const add = (key: string, identity: string) => {
    const set = owners.get(key) ?? new Set<string>();
    set.add(identity);
    owners.set(key, set);
  };
  // An established bibliography key cannot be claimed by later Zotero metadata.
  const established = new Set(
    bindings
      .filter((binding) => !binding.identity.startsWith("ambiguous:"))
      .map((binding) => binding.key),
  );
  for (const entry of entries) {
    const identity = entry.identity || `file:${entry.file.path}`;
    notes.set(identity, [...(notes.get(identity) ?? []), entry]);
    const key = buildCitekey(entry);
    if (!established.has(key)) add(key, identity);
  }
  for (const binding of bindings) add(binding.key, binding.identity);
  return (key) => {
    const candidates = [...(owners.get(key) ?? [])];
    const matches = candidates.flatMap((id) => notes.get(id) ?? []);
    if (!candidates.length)
      return { key, candidates, notes: matches, problem: "unknown-key" };
    if (candidates.length > 1 || candidates[0].startsWith("ambiguous:"))
      return { key, candidates, notes: matches, problem: "conflicting-key" };
    const identity = candidates[0];
    const reference = references.get(identity);
    return {
      key,
      identity,
      candidates,
      notes: matches,
      reference,
      ...(!reference ? { problem: "missing-data" as const } : {}),
    };
  };
}
