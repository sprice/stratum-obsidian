import { TFile, type App } from "obsidian";
import { buildCitekey } from "./bibtex-format";
import { bibliographyKeyResolver } from "./bibtex-managed";
import { readBibliographyBindings } from "./document-sources";
import { citationResolver } from "./citation-resolution";
import type { LiteratureNoteEntry } from "./library-search-modal";
import { parseSourceOccurrences } from "./source-occurrences";

export async function readCitationBibliography(app: App): Promise<string> {
  const file = app.vault.getAbstractFileByPath("stratum.bib");
  if (file && !(file instanceof TFile))
    throw new Error("stratum.bib is not a file.");
  return file instanceof TFile ? app.vault.read(file) : "";
}

/** The displayed key is the insertion key, or an explicit blocked state. */
export function citationKeyIndex(
  entries: LiteratureNoteEntry[],
  bibliography: string,
) {
  const resolve = citationResolver(
    entries,
    readBibliographyBindings(bibliography),
  );
  const preferred = bibliographyKeyResolver(bibliography);
  const keys = new Map<LiteratureNoteEntry, string>();
  const errors = new Map<LiteratureNoteEntry, string>();
  for (const entry of entries) {
    try {
      const key = preferred(entry);
      const owner = resolve(key);
      if (
        owner.problem === "conflicting-key" ||
        owner.identity !== (entry.identity || `file:${entry.file.path}`)
      )
        throw new Error(
          "Conflicting citation key. Repair this reference in Citations.",
        );
      keys.set(entry, key);
    } catch (error) {
      errors.set(
        entry,
        error instanceof Error ? error.message : "Citation key needs repair.",
      );
    }
  }
  return {
    key(this: void, entry: LiteratureNoteEntry): string {
      const key = keys.get(entry);
      if (!key)
        throw new Error(
          errors.get(entry) ?? "Source changed. Reopen the citation command.",
        );
      return key;
    },
    label(this: void, entry: LiteratureNoteEntry): string {
      const key = keys.get(entry);
      return key ? `@${key}` : `@${buildCitekey(entry)} · needs repair`;
    },
  };
}

export function preferCitedSources(
  entries: LiteratureNoteEntry[],
  text: string,
  bibliography: string,
): LiteratureNoteEntry[] {
  const resolve = citationResolver(
    entries,
    readBibliographyBindings(bibliography),
  );
  const cited = new Set(
    parseSourceOccurrences(text)
      .filter((o) => o.kind === "citation")
      .map((o) => resolve(o.target).identity)
      .filter(Boolean),
  );
  return [...entries].sort(
    (a, b) =>
      Number(cited.has(b.identity ?? undefined)) -
      Number(cited.has(a.identity ?? undefined)),
  );
}

export function citationEntriesSignature(
  entries: LiteratureNoteEntry[],
): string {
  return JSON.stringify(
    entries
      .map(({ file, ...entry }) => ({ ...entry, path: file.path }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  );
}
