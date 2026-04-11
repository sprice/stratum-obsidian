import { Notice, type Editor } from "obsidian";
import { getLiteratureNoteSummary } from "./literature-note";
import { promptExistingLiteratureNote } from "./literature-note-update-modal";
import { PLUGIN_NAME } from "./constants";
import {
  type ZoteroSearchResult,
  ZoteroTokenInvalidError,
} from "./backend-client";
import { getSelectedSearchLibrary } from "./plugin-libraries";
import type StratumPlugin from "./plugin";
import {
  ensureZoteroConnection,
  markZoteroDisconnected,
  markZoteroTokenInvalid,
} from "./plugin-sync-helpers";
import { ZoteroNotConnectedError } from "./zotero-errors";
import {
  buildLiteratureNoteEntries,
  LiteratureNoteSearchModal,
} from "./library-search-modal";
import { buildCitekey, ensureBibEntry } from "./bibtex";
import { buildLiteratureNoteWikiLink } from "./literature-note-links";
import {
  requireZoteroItemDetailForNoteSync,
  writeLiteratureNoteFromDetail,
} from "./plugin-note-sync";

export async function createLiteratureNote(
  plugin: StratumPlugin,
  result: ZoteroSearchResult,
): Promise<void> {
  if (plugin.isBulkLibrarySyncRunning()) {
    new Notice(
      `${PLUGIN_NAME}: Wait for the Zotero bulk sync to finish first.`,
    );
    return;
  }

  if (plugin.activeNoteActionKey) {
    return;
  }

  if (!plugin.backend.hasSession()) {
    new Notice(`${PLUGIN_NAME}: sign in before creating a literature note.`);
    return;
  }

  if (!(await ensureZoteroConnection(plugin, { refresh: true }))) {
    new Notice(
      `${PLUGIN_NAME}: Connect Zotero before creating a literature note.`,
    );
    return;
  }

  plugin.activeNoteActionKey = result.key;
  plugin.isLibraryPickerOpen = false;
  plugin.highlightedLibrarySearchIndex = -1;
  plugin.refreshViews();

  try {
    const selectedLibrary = getSelectedSearchLibrary(plugin);
    if (!selectedLibrary) {
      throw new Error("Select a Zotero library before creating a note.");
    }
    const detail = await requireZoteroItemDetailForNoteSync(plugin, {
      library: selectedLibrary,
      itemKey: result.key,
      sourcePreference: "cloud",
    });
    const existingFile = plugin.findExistingLiteratureNoteFile({
      libraryType: detail.library.type,
      libraryId: detail.library.id,
      itemKey: result.key,
    });
    const summary = getLiteratureNoteSummary(detail);

    if (existingFile) {
      const action = await promptExistingLiteratureNote({
        app: plugin.app,
        file: existingFile,
        title: detail.item.title,
        summary,
      });

      if (action === "cancel") {
        return;
      }

      if (action === "open") {
        await plugin.app.workspace.getLeaf(true).openFile(existingFile);
        return;
      }
    }

    const writeResult = await writeLiteratureNoteFromDetail(plugin, {
      detail,
      existingFile,
      enrichmentMode: "load",
    });

    await plugin.app.workspace.getLeaf(true).openFile(writeResult.file);
    plugin.library.clearSelection({ resetQuery: true });
    new Notice(
      writeResult.created
        ? `${PLUGIN_NAME}: created literature note for ${detail.item.title}.`
        : `${PLUGIN_NAME}: updated literature note for ${detail.item.title}.`,
    );
  } catch (error) {
    console.error("stratum: failed to create literature note", error);
    if (error instanceof ZoteroTokenInvalidError) {
      markZoteroTokenInvalid(plugin);
      new Notice(
        `${PLUGIN_NAME}: Zotero connection is no longer valid. Please reconnect in settings.`,
      );
    } else if (error instanceof ZoteroNotConnectedError) {
      markZoteroDisconnected(plugin);
      new Notice(
        `${PLUGIN_NAME}: Zotero is not connected. Please connect it again in settings.`,
      );
    } else {
      new Notice(
        `${PLUGIN_NAME}: ${
          error instanceof Error
            ? error.message
            : "Literature note creation failed."
        }`,
      );
    }
  } finally {
    plugin.activeNoteActionKey = null;
    plugin.refreshViews();
  }
}

function getActiveEditor(plugin: StratumPlugin): Editor | null {
  return plugin.app.workspace.activeEditor?.editor ?? null;
}

export function openLiteratureNoteFromModal(plugin: StratumPlugin): void {
  const entries = buildLiteratureNoteEntries(plugin);
  if (entries.length === 0) {
    new Notice(
      `${PLUGIN_NAME}: No literature notes found. Use the side panel to create some first.`,
    );
    return;
  }

  new LiteratureNoteSearchModal(plugin.app, entries, (entry) => {
    void plugin.app.workspace.getLeaf(true).openFile(entry.file);
  }).open();
}

export function openLiteratureNoteInPanel(plugin: StratumPlugin): void {
  const entries = buildLiteratureNoteEntries(plugin);
  if (entries.length === 0) {
    new Notice(
      `${PLUGIN_NAME}: No literature notes found. Use the side panel to create some first.`,
    );
    return;
  }

  new LiteratureNoteSearchModal(plugin.app, entries, (entry) => {
    plugin.activeViewTab = "reader";
    plugin.readerNoteFile = entry.file;
    void plugin
      .activateView()
      .then(() => {
        plugin.refreshViews();
      })
      .catch((error) => {
        console.error(
          "stratum: failed to open literature note in panel",
          error,
        );
        new Notice(`${PLUGIN_NAME}: Failed to open the reader panel.`);
      });
  }).open();
}

export function insertLiteratureNoteLink(
  plugin: StratumPlugin,
  editor: Editor,
): void {
  const entries = buildLiteratureNoteEntries(plugin);
  if (entries.length === 0) {
    new Notice(
      `${PLUGIN_NAME}: No literature notes found. Use the side panel to create some first.`,
    );
    return;
  }

  new LiteratureNoteSearchModal(plugin.app, entries, (entry) => {
    const target = getActiveEditor(plugin) ?? editor;
    const wikilink = buildLiteratureNoteWikiLink({
      basename: entry.file.basename,
      preferredLinkText: entry.preferredLinkText,
    });
    target.replaceSelection(wikilink);
  }).open();
}

export function insertPandocCitation(
  plugin: StratumPlugin,
  editor: Editor,
): void {
  const entries = buildLiteratureNoteEntries(plugin);
  if (entries.length === 0) {
    new Notice(
      `${PLUGIN_NAME}: No literature notes found. Use the side panel to create some first.`,
    );
    return;
  }

  new LiteratureNoteSearchModal(plugin.app, entries, (entry) => {
    const target = getActiveEditor(plugin) ?? editor;
    const citekey = buildCitekey(entry);
    void ensureBibEntry(plugin.app, entry).then(() => {
      target.replaceSelection(`[@${citekey}]`);
    });
  }).open();
}
