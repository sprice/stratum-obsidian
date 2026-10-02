import { TFile, type App } from "obsidian";
import type { LiteratureNoteEntry } from "./library-search-modal";
import { buildCitekey } from "./bibtex-format";
import {
  resolveBibliographyCitekey,
  updateManagedBibliography,
} from "./bibtex-managed";
export { buildCitekey } from "./bibtex-format";
const BIB_FILENAME = "stratum.bib";

// Serialize creates as well as updates; two simultaneous citations must not
// race to create the bibliography, or lose each other's entries.
const pending = new WeakMap<App, Promise<unknown>>();
function write(
  app: App,
  entry: LiteratureNoteEntry,
  append: boolean,
  canWrite: () => boolean = () => true,
): Promise<string> {
  const previous = pending.get(app) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      let citekey = buildCitekey(entry);
      if (!canWrite()) return citekey;
      const file = app.vault.getAbstractFileByPath(BIB_FILENAME);
      if (file instanceof TFile) {
        await app.vault.process(file, (content) => {
          if (!canWrite()) return content;
          if (append) citekey = resolveBibliographyCitekey(content, entry);
          return updateManagedBibliography(content, entry, append);
        });
      } else if (file) {
        throw new Error(`${BIB_FILENAME} is not a file.`);
      } else if (append) {
        await app.vault.create(
          BIB_FILENAME,
          updateManagedBibliography("", entry, true),
        );
      }
      return citekey;
    });
  pending.set(app, next);
  return next;
}
export async function ensureBibEntry(
  app: App,
  entry: LiteratureNoteEntry,
): Promise<string> {
  return write(app, entry, true);
}
export async function refreshManagedBibEntry(
  app: App,
  entry: LiteratureNoteEntry,
  canWrite?: () => boolean,
): Promise<void> {
  await write(app, entry, false, canWrite);
}

/** Validate the entire group before committing any bibliography changes. */
export function ensureBibEntries(
  app: App,
  entries: LiteratureNoteEntry[],
  canWrite: () => boolean,
): Promise<string[]> {
  const previous = pending.get(app) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const file = app.vault.getAbstractFileByPath(BIB_FILENAME);
      let keys: string[] = [];
      const update = (content: string) => {
        if (!canWrite())
          throw new Error(
            "The original note changed. Reopen the citation command.",
          );
        keys = [];
        for (const entry of entries) {
          keys.push(resolveBibliographyCitekey(content, entry));
          content = updateManagedBibliography(content, entry, true);
        }
        return content;
      };
      if (file instanceof TFile) await app.vault.process(file, update);
      else if (file) throw new Error(`${BIB_FILENAME} is not a file.`);
      else await app.vault.create(BIB_FILENAME, update(""));
      return keys;
    });
  pending.set(app, next);
  return next;
}
