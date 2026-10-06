import { canOpenStratumTab, selectStratumTab } from "./plugin-tabs";
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
import { openCitationComposer } from "./citation-composer";
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

  plugin.libraryNoteActionError = null;

  const actionLibrary = getSelectedSearchLibrary(plugin);
  const showError = (message: string) => {
    if (actionLibrary) {
      plugin.libraryNoteActionError = {
        key: result.key,
        libraryIdentity: actionLibrary.identity,
        message,
      };
    }
    plugin.refreshViews();
  };

  if (!plugin.backend.hasSession()) {
    showError("Sign in before creating a literature note.");
    return;
  }

  plugin.activeNoteActionKey = result.key;
  plugin.isLibraryPickerOpen = false;
  plugin.highlightedLibrarySearchIndex = -1;
  plugin.refreshViews();

  let savedNote = false;
  try {
    if (!(await ensureZoteroConnection(plugin, { refresh: true }))) {
      showError("Connect Zotero in settings, then try again.");
      return;
    }

    const selectedLibrary = getSelectedSearchLibrary(plugin);
    if (
      !selectedLibrary ||
      selectedLibrary.identity !== actionLibrary?.identity
    ) {
      throw new Error("The selected Zotero library is no longer available.");
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

    savedNote = true;
    plugin.selectedLibraryNoteFile = writeResult.file;
    await plugin.app.workspace.getLeaf(true).openFile(writeResult.file);
    plugin.library.clearSelection({ resetQuery: true });
    new Notice(
      writeResult.created
        ? `${PLUGIN_NAME}: created literature note for ${detail.item.title}.`
        : `${PLUGIN_NAME}: updated literature note for ${detail.item.title}.`,
    );
  } catch (error) {
    console.error("stratum: failed to create literature note", error);
    let message = savedNote
      ? "The literature note was saved, but could not be opened. Please try Open note."
      : "Could not create or update the literature note. Please try again.";
    if (error instanceof ZoteroTokenInvalidError) {
      markZoteroTokenInvalid(plugin);
      message = "Reconnect Zotero in settings, then try again.";
    } else if (error instanceof ZoteroNotConnectedError) {
      markZoteroDisconnected(plugin);
      message = "Connect Zotero in settings, then try again.";
    }
    if (actionLibrary) {
      plugin.libraryNoteActionError = {
        key: result.key,
        libraryIdentity: actionLibrary.identity,
        message,
      };
    }
  } finally {
    plugin.activeNoteActionKey = null;
    plugin.refreshViews();
  }
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
  if (!canOpenStratumTab(plugin, "reader")) return;
  const entries = buildLiteratureNoteEntries(plugin);
  if (entries.length === 0) {
    new Notice(
      `${PLUGIN_NAME}: No literature notes found. Use the side panel to create some first.`,
    );
    return;
  }

  new LiteratureNoteSearchModal(plugin.app, entries, (entry) => {
    if (!selectStratumTab(plugin, "reader")) return;
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
  const sourcePath = plugin.app.workspace.activeEditor?.file?.path ?? "";
  const entries = buildLiteratureNoteEntries(plugin);
  if (entries.length === 0) {
    new Notice(
      `${PLUGIN_NAME}: No literature notes found. Use the side panel to create some first.`,
    );
    return;
  }

  new LiteratureNoteSearchModal(plugin.app, entries, (entry) => {
    const active = plugin.app.workspace.activeEditor;
    const target = active?.editor ?? editor;
    const link = plugin.app.fileManager.generateMarkdownLink(
      entry.file,
      active?.editor ? (active.file?.path ?? sourcePath) : sourcePath,
      "",
      entry.preferredLinkText ?? "",
    );
    target.replaceSelection(link);
  }).open();
}

export function insertPandocCitation(
  plugin: StratumPlugin,
  editor: Editor,
): void {
  void openCitationComposer(plugin, editor).catch((error: unknown) => {
    new Notice(
      error instanceof Error
        ? error.message
        : "Could not open citation composer.",
    );
  });
}
