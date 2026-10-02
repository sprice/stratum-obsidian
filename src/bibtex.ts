import { TFile, type App } from "obsidian";
import type { LiteratureNoteEntry } from "./library-search-modal";
import { buildCitekey } from "./bibtex-format";
import { updateManagedBibliography } from "./bibtex-managed";
export { buildCitekey } from "./bibtex-format";
const BIB_FILENAME = "stratum.bib";

// Serialize creates as well as updates; two simultaneous citations must not
// race to create the bibliography, or lose each other's entries.
const pending = new WeakMap<App, Promise<unknown>>();
function write(
  app: App,
  entry: LiteratureNoteEntry,
  append: boolean,
): Promise<void> {
  const previous = pending.get(app) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const file = app.vault.getAbstractFileByPath(BIB_FILENAME);
      if (file instanceof TFile) {
        await app.vault.process(file, (content) =>
          updateManagedBibliography(content, entry, append),
        );
      } else if (file) {
        throw new Error(`${BIB_FILENAME} is not a file.`);
      } else if (append) {
        await app.vault.create(
          BIB_FILENAME,
          updateManagedBibliography("", entry, true),
        );
      }
    });
  pending.set(app, next);
  return next;
}
export async function ensureBibEntry(
  app: App,
  entry: LiteratureNoteEntry,
): Promise<string> {
  await write(app, entry, true);
  return buildCitekey(entry);
}
export function refreshManagedBibEntry(
  app: App,
  entry: LiteratureNoteEntry,
): Promise<void> {
  return write(app, entry, false);
}
