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
import { log } from "./log";
import type StratumPlugin from "./plugin";
import type { EnabledLibrary } from "./settings";
import {
  ensureZoteroConnection,
  getTrackedLiteratureNotes,
  isMissingZoteroItemError,
  markZoteroDisconnected,
  markZoteroTokenInvalid,
} from "./plugin-sync-helpers";
import { getLibraryAutoSyncState } from "./plugin-libraries";
import { refreshAutoSyncUi } from "./plugin-sync-status";
import { findAffectedPathsForDeletedChildKeys } from "./zotero-sync";
import {
  getIdentityFromFrontmatter,
  getItemKeyFromFrontmatter,
} from "./plugin-note-index";
import { PLUGIN_NAME } from "./constants";

function isTrackedNoteInLibrary(
  frontmatter: Record<string, unknown> | null,
  library: Pick<EnabledLibrary, "type" | "id">,
): boolean {
  const identity = getIdentityFromFrontmatter(frontmatter);
  return identity?.startsWith(`${library.type}/${library.id}/`) ?? false;
}

async function runInitialLiteratureRefreshForLibrary(
  plugin: StratumPlugin,
  library: EnabledLibrary,
): Promise<{
  updatedCount: number;
  deletedCount: number;
}> {
  const trackedNotes = getTrackedLiteratureNotes(plugin).filter((entry) =>
    isTrackedNoteInLibrary(entry.frontmatter, library),
  );
  log("sync", "initial refresh starting", {
    library: library.identity,
    noteCount: trackedNotes.length,
  });
  if (trackedNotes.length > 0) {
    new Notice(
      `${PLUGIN_NAME}: First sync: refreshing ${trackedNotes.length} literature note${
        trackedNotes.length === 1 ? "" : "s"
      } from ${library.name}…`,
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
      const detail = await plugin.backend.getZoteroItemDetail(itemKey, {
        library,
      });
      const enrichment = detail.item.doi
        ? await plugin.backend.getOpenAlexEnrichment(detail.item.doi)
        : null;
      const writeResult = await createOrUpdateLiteratureNote({
        app: plugin.app,
        notesFolder: plugin.settings.notesFolder,
        filenameFormat: plugin.settings.filenameFormat,
        detail,
        existingFile: entry.file,
        enrichment,
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
        }`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to refresh ${failures.length} literature note${
        failures.length === 1 ? "" : "s"
      }: ${failures.join("; ")}`,
    );
  }

  log("sync", "initial refresh completed", {
    library: library.identity,
    updatedCount,
    deletedCount,
  });
  return {
    updatedCount,
    deletedCount,
  };
}

export async function applyZoteroLibraryChanges(
  plugin: StratumPlugin,
  changes: ZoteroLibraryChangesResponse,
): Promise<{
  updatedCount: number;
  deletedCount: number;
}> {
  const trackedNotes = getTrackedLiteratureNotes(plugin).filter((entry) =>
    isTrackedNoteInLibrary(entry.frontmatter, changes.library),
  );
  const notesByPath = new Map(
    trackedNotes.map((entry) => [entry.file.path, entry] as const),
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
    changes.deletedItemKeys,
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
    left.localeCompare(right),
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
      const detail = await plugin.backend.getZoteroItemDetail(parentKey, {
        library: {
          type: changes.library.type,
          id: changes.library.id,
        },
      });
      const enrichment = detail.item.doi
        ? await plugin.backend.getOpenAlexEnrichment(detail.item.doi)
        : null;
      const writeResult = await createOrUpdateLiteratureNote({
        app: plugin.app,
        notesFolder: plugin.settings.notesFolder,
        filenameFormat: plugin.settings.filenameFormat,
        detail,
        existingFile: file,
        enrichment,
      });
      plugin.rememberLiteratureNoteFile(detail, writeResult.file);
      updatedCount += 1;
    } catch (error) {
      if (isMissingZoteroItemError(error)) {
        deletedParentFiles.set(file.path, file);
        continue;
      }

      failures.push(
        `${parentKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const file of Array.from(deletedParentFiles.values()).sort(
    (left, right) => left.path.localeCompare(right.path),
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
        `${file.basename}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to sync ${failures.length} literature note${
        failures.length === 1 ? "" : "s"
      }: ${failures.join("; ")}`,
    );
  }

  return {
    updatedCount,
    deletedCount,
  };
}

export async function runZoteroAutoSync(
  plugin: StratumPlugin,
  reason: "startup" | "focus" | "interval" | "manual",
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

  log("sync", "auto-sync starting", { reason });

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
  plugin.refreshViews();
  plugin.refreshSettingTab();

  try {
    const libraries = [...plugin.settings.enabledLibraries];
    if (libraries.length === 0) {
      if (reason === "manual") {
        new Notice(`${PLUGIN_NAME}: No Zotero libraries are enabled.`);
      }
      return;
    }

    const updatedLibraries: string[] = [];
    const failedLibraries: string[] = [];

    for (const library of libraries) {
      const state = getLibraryAutoSyncState(plugin, library);

      try {
        if (!state.initialRefreshCompleted) {
          const baseline = await plugin.backend.getZoteroLibraryChanges(null, {
            library,
          });
          const result = await runInitialLiteratureRefreshForLibrary(
            plugin,
            library,
          );
          state.libraryVersion = baseline.latestLibraryVersion;
          state.initialRefreshCompleted = true;
          state.lastSuccessfulSyncAt = new Date().toISOString();
          state.lastError = null;
          await plugin.saveSettings();
          plugin.refreshSettingTab();

          if (result.updatedCount > 0 || result.deletedCount > 0) {
            updatedLibraries.push(
              `${library.name}: ${result.updatedCount} updated${
                result.deletedCount > 0
                  ? `, ${result.deletedCount} removed`
                  : ""
              }`,
            );
          }
          continue;
        }

        const sinceVersion = state.libraryVersion;
        const changes = await plugin.backend.getZoteroLibraryChanges(
          sinceVersion,
          {
            library,
          },
        );
        log("sync", "library changes received", {
          library: library.identity,
          sinceVersion: sinceVersion ?? "null",
          latestVersion: changes.latestLibraryVersion ?? "null",
          changed: changes.changedParentKeys.length,
          deleted: changes.deletedItemKeys.length,
        });
        const result = await applyZoteroLibraryChanges(plugin, changes);
        state.libraryVersion = changes.latestLibraryVersion;
        state.lastSuccessfulSyncAt = new Date().toISOString();
        state.lastError = null;
        await plugin.saveSettings();
        plugin.refreshSettingTab();

        if (result.updatedCount > 0 || result.deletedCount > 0) {
          updatedLibraries.push(
            `${library.name}: ${result.updatedCount} updated${
              result.deletedCount > 0 ? `, ${result.deletedCount} removed` : ""
            }`,
          );
        }
      } catch (error) {
        if (error instanceof ZoteroTokenInvalidError) {
          throw error;
        }
        if (error instanceof ZoteroNotConnectedError) {
          throw error;
        }

        state.lastError =
          error instanceof Error ? error.message : String(error);
        await plugin.saveSettings();
        plugin.refreshSettingTab();
        failedLibraries.push(library.name);
      }
    }

    if (updatedLibraries.length > 0) {
      new Notice(`${PLUGIN_NAME}: ${updatedLibraries.join("; ")}.`);
    } else if (reason === "manual" && failedLibraries.length === 0) {
      new Notice(`${PLUGIN_NAME}: Zotero is already in sync.`);
    }

    if (
      failedLibraries.length > 0 &&
      reason !== "focus" &&
      reason !== "interval"
    ) {
      new Notice(
        `${PLUGIN_NAME}: Sync failed for ${failedLibraries.join(", ")}. See plugin settings for details.`,
      );
    }
  } catch (error) {
    if (error instanceof ZoteroTokenInvalidError) {
      markZoteroTokenInvalid(plugin);
      console.error("stratum: Zotero token invalid, connection cleared", error);
      new Notice(
        `${PLUGIN_NAME}: Zotero connection is no longer valid. Please reconnect in settings.`,
      );
    } else if (error instanceof ZoteroNotConnectedError) {
      markZoteroDisconnected(plugin);
      console.error("stratum: Zotero not connected, connection cleared", error);
      new Notice(
        `${PLUGIN_NAME}: Zotero is not connected. Please connect it again in settings.`,
      );
    } else {
      console.error("stratum: auto-sync failed", error);

      if (reason !== "focus" && reason !== "interval") {
        new Notice(
          `${PLUGIN_NAME}: ${
            error instanceof Error ? error.message : "Zotero sync failed."
          }`,
        );
      }
    }
  } finally {
    plugin.isAutoSyncRunning = false;
    log("sync", "auto-sync finished", { reason });
    refreshAutoSyncUi(plugin);
    plugin.refreshViews();
    plugin.refreshSettingTab();
  }
}
