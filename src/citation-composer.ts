import { CitationComposer } from "./citation-composer-modal";
import { Notice, TFile, type Editor } from "obsidian";
import type StratumPlugin from "./plugin";
import {
  buildLiteratureNoteEntries,
  type LiteratureNoteEntry,
} from "./library-search-modal";
import { resolveBibliographyCitekey } from "./bibtex-managed";
import {
  collectDocumentSources,
  readBibliographyBindings,
} from "./document-sources";
import { ensureBibEntries } from "./bibtex";
import {
  citationAt,
  citationItem,
  serializeCitation,
  type CitationDraft,
} from "./citation-model";

const openComposers = new WeakMap<StratumPlugin, Set<CitationComposer>>();

export async function openCitationComposer(
  plugin: StratumPlugin,
  editor: Editor,
  initial?: { entry: LiteratureNoteEntry; from: number; to: number },
): Promise<void> {
  const original = editor.getValue();
  const file = plugin.app.workspace.activeEditor?.file;
  const from = initial?.from ?? editor.posToOffset(editor.getCursor("from"));
  const to = initial?.to ?? editor.posToOffset(editor.getCursor("to"));
  const existing = initial ? null : citationAt(original, from);
  if (
    existing &&
    from !== to &&
    (from !== existing.from || to !== existing.to)
  ) {
    new Notice("Select the whole citation or click inside it to edit.");
    return;
  }
  if (existing && !existing.draft) {
    new Notice(
      "This citation uses syntax the composer cannot edit safely. Edit it directly in your note.",
    );
    return;
  }
  const entries = buildLiteratureNoteEntries(plugin);
  if (!entries.length) {
    new Notice(
      "Sync literature notes before inserting citations. Use the sync panel to get started.",
    );
    return;
  }
  const bib = plugin.app.vault.getAbstractFileByPath("stratum.bib");
  const bibliography =
    bib instanceof TFile ? await plugin.app.vault.read(bib) : "";
  const bindings = readBibliographyBindings(bibliography);
  const resolveKey = (entry: LiteratureNoteEntry) =>
    resolveBibliographyCitekey(bibliography, entry);
  const draft: CitationDraft = existing?.draft ?? {
    items: [],
    narrative: false,
  };
  const selected = new Map<string, LiteratureNoteEntry>();
  for (const item of draft.items) {
    const rows = collectDocumentSources(
      serializeCitation({ items: [item], narrative: false }),
      entries,
      bindings,
      () => null,
    );
    if (!rows[0]?.entry || rows[0].issue) {
      new Notice(
        `Cannot safely resolve @${item.key}. Resolve it in Sources before editing.`,
      );
      return;
    }
    selected.set(item.key, rows[0].entry);
  }
  if (initial) {
    const key = resolveKey(initial.entry);
    selected.set(key, initial.entry);
    draft.items.push(citationItem(key));
  }
  const unchanged = () =>
    modal.isActive &&
    editor.getValue() === original &&
    plugin.app.workspace.getLeavesOfType("markdown").some((leaf) => {
      const view = leaf.view as unknown as { editor?: Editor; file?: TFile };
      return view.editor === editor && view.file === file;
    });
  const modal = new CitationComposer(
    plugin,
    entries,
    draft,
    selected,
    resolveKey,
    async () => {
      if (!unchanged())
        throw new Error(
          "The original note changed or closed. Reopen the citation command to avoid replacing the wrong text.",
        );
      serializeCitation(draft);
      const sources = draft.items.map((item) => {
        const entry = selected.get(item.key);
        if (!entry) throw new Error("Select a source for every citation.");
        return entry;
      });
      const keys = await ensureBibEntries(plugin.app, sources, unchanged);
      if (!unchanged())
        throw new Error(
          "The note changed while saving references. No citation was inserted; reopen the command.",
        );
      const output = serializeCitation({
        ...draft,
        items: draft.items.map((item, i) => ({ ...item, key: keys[i] })),
      });
      editor.replaceRange(
        output,
        editor.offsetToPos(existing?.from ?? from),
        editor.offsetToPos(existing?.to ?? to),
      );
      editor.setCursor(
        editor.offsetToPos((existing?.from ?? from) + output.length),
      );
      editor.focus();
    },
  );
  let active = openComposers.get(plugin);
  if (!active) {
    active = new Set();
    openComposers.set(plugin, active);
    const tracked = active;
    plugin.register(() => {
      for (const composer of tracked) composer.close();
    });
  }
  const tracked = active;
  tracked.add(modal);
  modal.onDismiss = () => tracked.delete(modal);
  modal.open();
}
