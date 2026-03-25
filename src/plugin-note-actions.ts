import { Notice } from "obsidian";
import {
  createOrUpdateLiteratureNote,
  getLiteratureNoteSummary,
} from "./literature-note";
import { promptExistingLiteratureNote } from "./literature-note-update-modal";
import { PLUGIN_NAME } from "./constants";
import { type ZoteroSearchResult, ZoteroTokenInvalidError } from "./backend-client";
import type StratumPlugin from "./plugin";
import { markZoteroTokenInvalid } from "./plugin-sync-helpers";

export async function createLiteratureNote(
  plugin: StratumPlugin,
  result: ZoteroSearchResult
): Promise<void> {
  if (plugin.isBulkLibrarySyncRunning()) {
    new Notice(`${PLUGIN_NAME}: Wait for the Zotero bulk sync to finish first.`);
    return;
  }

  if (plugin.activeNoteActionKey) {
    return;
  }

  if (!plugin.backend.hasSession()) {
    new Notice(`${PLUGIN_NAME}: sign in before creating a literature note.`);
    return;
  }

  plugin.activeNoteActionKey = result.key;
  plugin.isLibraryPickerOpen = false;
  plugin.highlightedLibrarySearchIndex = -1;
  plugin.refreshViews();

  try {
    const detail = await plugin.backend.getZoteroItemDetail(result.key);
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

    const writeResult = await createOrUpdateLiteratureNote({
      app: plugin.app,
      notesFolder: plugin.settings.notesFolder,
      filenameFormat: plugin.settings.filenameFormat,
      detail,
      existingFile,
    });

    plugin.rememberLiteratureNoteFile(detail, writeResult.file);

    await plugin.app.workspace.getLeaf(true).openFile(writeResult.file);
    new Notice(
      writeResult.created
        ? `${PLUGIN_NAME}: created literature note for ${detail.item.title}.`
        : `${PLUGIN_NAME}: updated literature note for ${detail.item.title}.`
    );
  } catch (error) {
    console.error("stratum: failed to create literature note", error);
    if (error instanceof ZoteroTokenInvalidError) {
      markZoteroTokenInvalid(plugin);
      new Notice(
        `${PLUGIN_NAME}: Zotero connection is no longer valid. Please reconnect in settings.`
      );
    } else {
      new Notice(
        `${PLUGIN_NAME}: ${
          error instanceof Error
            ? error.message
            : "Literature note creation failed."
        }`
      );
    }
  } finally {
    plugin.activeNoteActionKey = null;
    plugin.refreshViews();
  }
}
