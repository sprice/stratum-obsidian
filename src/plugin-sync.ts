import { Notice, TFile } from "obsidian";
import {
  createOrUpdateLiteratureNote,
  markLiteratureNoteDeleted,
} from "./literature-note";
import {
  type ZoteroLibraryChangesResponse,
  ZoteroNotConnectedError,
  ZoteroTokenInvalidError,
} from "./backend-client";
import type StratumPlugin from "./plugin";
import {
  ensureZoteroConnection,
  getTrackedLiteratureNotes,
  isMissingZoteroItemError,
  markZoteroDisconnected,
  markZoteroTokenInvalid,
} from "./plugin-sync-helpers";
import { refreshAutoSyncUi } from "./plugin-sync-status";
import {
  findAffectedPathsForDeletedChildKeys,
} from "./zotero-sync";
import {
  getItemKeyFromFrontmatter,
} from "./plugin-note-index";
import { PLUGIN_NAME } from "./constants";

async function runInitialLiteratureRefresh(plugin: StratumPlugin): Promise<{
  updatedCount: number;
  deletedCount: number;
}> {
  const trackedNotes = getTrackedLiteratureNotes(plugin);
  if (trackedNotes.length > 0) {
    new Notice(
      `${PLUGIN_NAME}: First sync: refreshing ${trackedNotes.length} literature notes from Zotero…`
    );
  }

  let updatedCount = 0;
  let deletedCount = 0;
  const failures: string[] = [];

  for (const entry of trackedNotes) {
    const itemKey = getItemKeyFromFrontmatter(entry.frontmatter);
    if (!itemKey) {
      continue;
    }

    try {
      const detail = await plugin.backend.getZoteroItemDetail(itemKey);
      const writeResult = await createOrUpdateLiteratureNote({
        app: plugin.app,
        notesFolder: plugin.settings.notesFolder,
        filenameFormat: plugin.settings.filenameFormat,
        detail,
        existingFile: entry.file,
      });
      plugin.rememberLiteratureNoteFile(detail, writeResult.file);
      updatedCount += 1;
    } catch (error) {
      if (isMissingZoteroItemError(error)) {
        const result = await markLiteratureNoteDeleted({
          app: plugin.app,
          file: entry.file,
        });
        if (result.changed) {
          deletedCount += 1;
        }
        continue;
      }

      failures.push(
        `${entry.file.basename}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to refresh ${failures.length} literature note${
        failures.length === 1 ? "" : "s"
      }: ${failures.join("; ")}`
    );
  }

  return {
    updatedCount,
    deletedCount,
  };
}

export async function applyZoteroLibraryChanges(
  plugin: StratumPlugin,
  changes: ZoteroLibraryChangesResponse
): Promise<{
  updatedCount: number;
  deletedCount: number;
}> {
  const trackedNotes = getTrackedLiteratureNotes(plugin);
  const notesByPath = new Map(
    trackedNotes.map((entry) => [entry.file.path, entry] as const)
  );
  const deletedItemKeys = new Set(changes.deletedItemKeys);
  const deletedParentFiles = new Map<string, TFile>();
  const refreshParentKeys = new Set<string>(changes.changedParentKeys);

  for (const entry of trackedNotes) {
    const itemKey = getItemKeyFromFrontmatter(entry.frontmatter);
    if (itemKey && deletedItemKeys.has(itemKey)) {
      deletedParentFiles.set(entry.file.path, entry.file);
    }
  }

  for (const path of findAffectedPathsForDeletedChildKeys(
    trackedNotes.map((entry) => ({
      path: entry.file.path,
      frontmatter: entry.frontmatter,
    })),
    changes.deletedItemKeys
  )) {
    const entry = notesByPath.get(path);
    if (!entry) {
      continue;
    }

    const itemKey = getItemKeyFromFrontmatter(entry.frontmatter);
    if (!itemKey || deletedItemKeys.has(itemKey)) {
      continue;
    }

    refreshParentKeys.add(itemKey);
  }

  let updatedCount = 0;
  let deletedCount = 0;
  const failures: string[] = [];

  for (const parentKey of Array.from(refreshParentKeys).sort((left, right) =>
    left.localeCompare(right)
  )) {
    const file = plugin.findExistingLiteratureNoteFile({
      libraryType: changes.library.type,
      libraryId: changes.library.id,
      itemKey: parentKey,
    });
    if (!file || deletedParentFiles.has(file.path)) {
      continue;
    }

    try {
      const detail = await plugin.backend.getZoteroItemDetail(parentKey);
      const writeResult = await createOrUpdateLiteratureNote({
        app: plugin.app,
        notesFolder: plugin.settings.notesFolder,
        filenameFormat: plugin.settings.filenameFormat,
        detail,
        existingFile: file,
      });
      plugin.rememberLiteratureNoteFile(detail, writeResult.file);
      updatedCount += 1;
    } catch (error) {
      if (isMissingZoteroItemError(error)) {
        deletedParentFiles.set(file.path, file);
        continue;
      }

      failures.push(
        `${parentKey}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  for (const file of Array.from(deletedParentFiles.values()).sort((left, right) =>
    left.path.localeCompare(right.path)
  )) {
    try {
      const result = await markLiteratureNoteDeleted({
        app: plugin.app,
        file,
      });
      if (result.changed) {
        deletedCount += 1;
      }
    } catch (error) {
      failures.push(
        `${file.basename}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to sync ${failures.length} literature note${
        failures.length === 1 ? "" : "s"
      }: ${failures.join("; ")}`
    );
  }

  return {
    updatedCount,
    deletedCount,
  };
}

export async function runZoteroAutoSync(
  plugin: StratumPlugin,
  reason: "startup" | "focus" | "interval" | "manual"
): Promise<void> {
  if (plugin.isBulkLibrarySyncRunning()) {
    if (reason === "manual") {
      new Notice(`${PLUGIN_NAME}: Zotero bulk sync is already running.`);
    }
    return;
  }

  if (plugin.isAutoSyncRunning) {
    if (reason === "manual") {
      new Notice(`${PLUGIN_NAME}: Zotero sync is already running.`);
    }
    return;
  }

  if (
    !(await ensureZoteroConnection(plugin, {
      refresh: reason === "manual",
    }))
  ) {
    if (reason === "manual") {
      new Notice(`${PLUGIN_NAME}: Connect Zotero before syncing changes.`);
    }
    return;
  }

  plugin.isAutoSyncRunning = true;
  refreshAutoSyncUi(plugin);

  try {
    if (!plugin.settings.zoteroAutoSync.initialRefreshCompleted) {
      const baseline = await plugin.backend.getZoteroLibraryChanges(null);
      const result = await runInitialLiteratureRefresh(plugin);
      plugin.settings.zoteroAutoSync.libraryVersion = baseline.latestLibraryVersion;
      plugin.settings.zoteroAutoSync.initialRefreshCompleted = true;
      plugin.settings.zoteroAutoSync.lastSuccessfulSyncAt = new Date().toISOString();
      plugin.settings.zoteroAutoSync.lastError = null;
      await plugin.saveSettings();

      if (result.updatedCount > 0 || result.deletedCount > 0) {
        new Notice(
          `${PLUGIN_NAME}: First sync updated ${result.updatedCount} literature note${
            result.updatedCount === 1 ? "" : "s"
          }${
            result.deletedCount > 0
              ? ` and marked ${result.deletedCount} as removed from Zotero`
              : ""
          }.`
        );
      }

      return;
    }

    const changes = await plugin.backend.getZoteroLibraryChanges(
      plugin.settings.zoteroAutoSync.libraryVersion
    );
    const result = await applyZoteroLibraryChanges(plugin, changes);
    plugin.settings.zoteroAutoSync.libraryVersion = changes.latestLibraryVersion;
    plugin.settings.zoteroAutoSync.lastSuccessfulSyncAt = new Date().toISOString();
    plugin.settings.zoteroAutoSync.lastError = null;
    await plugin.saveSettings();

    if (result.updatedCount > 0 || result.deletedCount > 0) {
      new Notice(
        `${PLUGIN_NAME}: Updated ${result.updatedCount} literature note${
          result.updatedCount === 1 ? "" : "s"
        } from Zotero${
          result.deletedCount > 0
            ? ` and marked ${result.deletedCount} removed item${
                result.deletedCount === 1 ? "" : "s"
              }`
            : ""
        }.`
      );
    } else if (reason === "manual") {
      new Notice(`${PLUGIN_NAME}: Zotero is already in sync.`);
    }
  } catch (error) {
    if (error instanceof ZoteroTokenInvalidError) {
      markZoteroTokenInvalid(plugin);
      console.error("stratum: Zotero token invalid, connection cleared", error);
      new Notice(
        `${PLUGIN_NAME}: Zotero connection is no longer valid. Please reconnect in settings.`
      );
    } else if (error instanceof ZoteroNotConnectedError) {
      markZoteroDisconnected(plugin);
      console.error("stratum: Zotero not connected, connection cleared", error);
      new Notice(`${PLUGIN_NAME}: Zotero is not connected. Please connect it again in settings.`);
    } else {
      plugin.settings.zoteroAutoSync.lastError =
        error instanceof Error ? error.message : String(error);
      await plugin.saveSettings();
      console.error("stratum: auto-sync failed", error);

      if (reason !== "focus" && reason !== "interval") {
        new Notice(
          `${PLUGIN_NAME}: ${
            error instanceof Error ? error.message : "Zotero sync failed."
          }`
        );
      }
    }
  } finally {
    plugin.isAutoSyncRunning = false;
    refreshAutoSyncUi(plugin);
  }
}
