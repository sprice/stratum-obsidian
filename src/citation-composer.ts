import { CitationComposer } from "./citation-composer-modal";
import { Notice, TFile, type Editor } from "obsidian";
import type StratumPlugin from "./plugin";
import {
  LiteratureNoteSearchModal,
  buildLiteratureNoteEntries,
  type LiteratureNoteEntry,
} from "./library-search-modal";
import {
  citationEntriesSignature,
  citationKeyIndex,
  preferCitedSources,
} from "./citation-keys";
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

interface ComposerSession {
  active: Set<{ close(): void }>;
  disposed: boolean;
}
const sessions = new WeakMap<StratumPlugin, ComposerSession>();
function composerSession(plugin: StratumPlugin): ComposerSession {
  let session = sessions.get(plugin);
  if (!session) {
    session = { active: new Set(), disposed: false };
    sessions.set(plugin, session);
    const tracked = session;
    plugin.register(() => {
      tracked.disposed = true;
      for (const composer of tracked.active) composer.close();
    });
  }
  return session;
}

export async function openCitationComposer(
  plugin: StratumPlugin,
  editor: Editor,
  initial?: { entry: LiteratureNoteEntry; from: number; to: number },
): Promise<void> {
  const session = composerSession(plugin);
  if (session.disposed) return;
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
  if (!initial && !existing && from !== to) {
    new Notice(
      "Select an insertion point for the citation. Selected text will be preserved.",
    );
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
  if (session.disposed) return;
  const bindings = readBibliographyBindings(bibliography);
  const index = citationKeyIndex(entries, bibliography);
  const resolveKey = index.key;
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
        `Cannot safely resolve @${item.key}. Resolve it in Citations before editing.`,
      );
      return;
    }
    selected.set(item.key, rows[0].entry);
  }
  if (initial) {
    const current = entries.find(
      (entry) =>
        entry.file.path === initial.entry.file.path &&
        entry.identity === initial.entry.identity,
    );
    if (!current)
      throw new Error("Source changed. Reopen the citation command.");
    const key = resolveKey(current);
    selected.set(key, current);
    draft.items.push(citationItem(key));
  }
  const entriesSignature = citationEntriesSignature(entries);
  const noteUnchanged = () =>
    !session.disposed &&
    editor.getValue() === original &&
    citationEntriesSignature(buildLiteratureNoteEntries(plugin)) ===
      entriesSignature &&
    plugin.app.workspace.getLeavesOfType("markdown").some((leaf) => {
      const view = leaf.view as unknown as { editor?: Editor; file?: TFile };
      return view.editor === editor && view.file === file;
    });
  const unchanged = () => modal.isActive && noteUnchanged();
  const modal = new CitationComposer(
    plugin,
    preferCitedSources(entries, original, bibliography),
    draft,
    selected,
    resolveKey,
    async () => {
      if (!unchanged())
        throw new Error(
          "The original note changed or closed. Reopen the citation command to avoid replacing the wrong text.",
        );
      // UI callbacks can still fire while disk I/O is pending (including native
      // toggles). Save precisely the draft that was confirmed, not mutable UI state.
      const confirmed: CitationDraft = {
        narrative: draft.narrative,
        items: draft.items.map((item) => ({ ...item })),
      };
      serializeCitation(confirmed);
      const sources = confirmed.items.map((item) => {
        const entry = selected.get(item.key);
        if (!entry) throw new Error("Select a source for every citation.");
        return entry;
      });
      const keys = await ensureBibEntries(
        plugin.app,
        sources,
        unchanged,
        confirmed.items.map((item) => item.key),
        entries,
      );
      if (!unchanged())
        throw new Error(
          "The note changed while saving references. No citation was inserted; reopen the command.",
        );
      const output = serializeCitation({
        ...confirmed,
        items: confirmed.items.map((item, i) => ({ ...item, key: keys[i] })),
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
    index.label,
  );
  const openDetails = () => {
    session.active.add(modal);
    modal.onDismiss = () => session.active.delete(modal);
    modal.open();
  };
  if (initial || existing) {
    openDetails();
    return;
  }
  class InitialSourcePicker extends LiteratureNoteSearchModal {
    onClose(): void {
      session.active.delete(this);
      super.onClose();
    }
  }
  const picker = new InitialSourcePicker(
    plugin.app,
    preferCitedSources(entries, original, bibliography),
    (entry) => {
      if (session.disposed) return;
      if (!noteUnchanged()) {
        new Notice(
          "The original note or sources changed. Reopen the citation command.",
        );
        return;
      }
      try {
        const key = resolveKey(entry);
        selected.set(key, entry);
        draft.items.push(citationItem(key));
        openDetails();
      } catch (error) {
        new Notice(
          error instanceof Error
            ? error.message
            : "Cannot safely resolve this citation key.",
        );
      }
    },
    index.label,
  );
  session.active.add(picker);
  picker.open();
}
