import { Notice, Platform, TFile } from "obsidian";
import {
  createOrUpdateLiteratureNote,
  markLiteratureNoteDeleted,
} from "./literature-note";
import {
  type ZoteroItemDetail,
  ZoteroNotConnectedError,
  ZoteroTokenInvalidError,
} from "./backend-client";
import { PLUGIN_NAME } from "./constants";
import { loadEnrichmentForNoteWrite } from "./plugin-enrichment";
import {
  shouldMarkLiteratureNoteDeletedAfterRefreshMiss,
  shouldUseLocalOpenedNoteRefresh,
} from "./plugin-note-refresh-policy";
import { getLibraryAutoSyncState } from "./plugin-libraries";
import { getLibraryFromFrontmatter } from "./plugin-local-sync";
import {
  getIdentityFromFrontmatter,
  getItemKeyFromFrontmatter,
} from "./plugin-note-index";
import type StratumPlugin from "./plugin";
import {
  isMissingZoteroItemError,
  markZoteroDisconnected,
  markZoteroTokenInvalid,
} from "./plugin-sync-helpers";
import {
  LocalZoteroApiDisabledError,
  LocalZoteroApiError,
  LocalZoteroApiVersionMismatchError,
  LocalZoteroHttpServerUnavailableError,
  LocalZoteroUnavailableError,
  loadLocalZoteroItemDetail,
  loadLocalZoteroLibraries,
} from "./zotero-local";

async function tryLoadLocalDetail(
  plugin: StratumPlugin,
  params: {
    library: NonNullable<ReturnType<typeof getLibraryFromFrontmatter>>;
    itemKey: string;
  },
): Promise<ZoteroItemDetail | null> {
  if (!Platform.isDesktopApp) {
    return null;
  }

  let userId = plugin.localZoteroUserId;
  if (!userId) {
    const response = await loadLocalZoteroLibraries({
      port: plugin.settings.zoteroLocalApiPort,
    });
    plugin.localZoteroUserId = response.userId;
    userId = response.userId;
  }

  return loadLocalZoteroItemDetail({
    port: plugin.settings.zoteroLocalApiPort,
    userId,
    library: params.library,
    itemKey: params.itemKey,
  });
}

function showRefreshNotice(plugin: StratumPlugin, error: unknown): void {
  if (error instanceof ZoteroTokenInvalidError) {
    markZoteroTokenInvalid(plugin);
    new Notice(
      `${PLUGIN_NAME}: Zotero connection is no longer valid. Please reconnect in settings.`,
    );
    return;
  }

  if (error instanceof ZoteroNotConnectedError) {
    markZoteroDisconnected(plugin);
    new Notice(
      `${PLUGIN_NAME}: Zotero is not connected. Please connect it again in settings.`,
    );
    return;
  }

  if (
    error instanceof LocalZoteroApiDisabledError ||
    error instanceof LocalZoteroApiVersionMismatchError ||
    error instanceof LocalZoteroHttpServerUnavailableError
  ) {
    new Notice(`${PLUGIN_NAME}: ${error.message}`);
    return;
  }

  if (error instanceof LocalZoteroUnavailableError) {
    new Notice(`${PLUGIN_NAME}: ${error.message}`);
  }
}

function resolveTerminalRefreshError(
  localError: unknown,
  backendError: unknown,
): unknown {
  if (
    backendError instanceof ZoteroTokenInvalidError ||
    backendError instanceof ZoteroNotConnectedError
  ) {
    return backendError;
  }

  if (localError instanceof LocalZoteroUnavailableError) {
    return localError;
  }

  return backendError ?? localError;
}

function getRefreshTarget(
  plugin: StratumPlugin,
  file: TFile,
): {
  frontmatter: Record<string, unknown> | null;
  library: NonNullable<ReturnType<typeof getLibraryFromFrontmatter>>;
  itemKey: string;
} | null {
  const frontmatter =
    (plugin.app.metadataCache.getFileCache(file)?.frontmatter as
      | Record<string, unknown>
      | undefined) ?? null;
  const itemKey = getItemKeyFromFrontmatter(frontmatter);
  if (!itemKey) {
    return null;
  }

  if (frontmatter?.stratum_note_type !== "literature-note") {
    return null;
  }

  const library = getLibraryFromFrontmatter({
    libraryType:
      typeof frontmatter?.zotero_library_type === "string"
        ? frontmatter.zotero_library_type
        : null,
    libraryId:
      typeof frontmatter?.zotero_library_id === "string"
        ? frontmatter.zotero_library_id
        : null,
    groupName:
      typeof frontmatter?.zotero_group_name === "string"
        ? frontmatter.zotero_group_name
        : null,
  });
  if (!library) {
    return null;
  }

  const identity = getIdentityFromFrontmatter(frontmatter);
  if (identity !== `${library.type}/${library.id}/${itemKey}`) {
    return null;
  }

  return {
    frontmatter,
    library,
    itemKey,
  };
}

function recordRefreshSuccess(
  plugin: StratumPlugin,
  library: NonNullable<ReturnType<typeof getLibraryFromFrontmatter>>,
): void {
  const state = getLibraryAutoSyncState(plugin, library);
  state.initialRefreshCompleted = true;
  state.lastSuccessfulSyncAt = new Date().toISOString();
  state.lastError = null;
}

function recordRefreshFailure(
  plugin: StratumPlugin,
  library: NonNullable<ReturnType<typeof getLibraryFromFrontmatter>>,
  error: unknown,
): void {
  const state = getLibraryAutoSyncState(plugin, library);
  state.initialRefreshCompleted = true;
  state.lastError =
    error instanceof Error && error.message.trim()
      ? error.message
      : "Literature note refresh failed.";
}

async function runOpenedLiteratureNoteRefresh(
  plugin: StratumPlugin,
  file: TFile,
): Promise<void> {
  const target = getRefreshTarget(plugin, file);
  if (!target) {
    return;
  }
  const { itemKey, library } = target;

  let detail: ZoteroItemDetail | null = null;
  let localMissing = false;
  let backendMissing = false;
  let localError: unknown = null;
  let backendError: unknown = null;
  const useLocalRefresh = shouldUseLocalOpenedNoteRefresh({
    isDesktopApp: Platform.isDesktopApp,
    bulkSyncEnabled: plugin.settings.bulkSyncEnabled,
  });

  if (useLocalRefresh) {
    try {
      detail = await tryLoadLocalDetail(plugin, {
        library,
        itemKey,
      });
    } catch (error) {
      if (error instanceof LocalZoteroApiError && error.status === 404) {
        localMissing = true;
      } else {
        localError = error;
      }
    }
  }

  if (!detail && plugin.backend.hasSession()) {
    try {
      detail = await plugin.backend.getZoteroItemDetail(itemKey, { library });
    } catch (error) {
      backendError = error;
      if (isMissingZoteroItemError(error)) {
        backendMissing = true;
      }
    }
  }

  if (!detail) {
    if (
      shouldMarkLiteratureNoteDeletedAfterRefreshMiss({
        usedLocal: useLocalRefresh,
        localMissing,
        backendMissing,
      })
    ) {
      await markLiteratureNoteDeleted({
        app: plugin.app,
        file,
      });
      recordRefreshSuccess(plugin, library);
      return;
    }

    const terminalError = resolveTerminalRefreshError(localError, backendError);
    if (terminalError) {
      recordRefreshFailure(plugin, library, terminalError);
      showRefreshNotice(plugin, terminalError);
    }
    return;
  }

  const enrichment = await loadEnrichmentForNoteWrite(plugin, {
    doi: detail.item.doi,
  });
  const writeResult = await createOrUpdateLiteratureNote({
    app: plugin.app,
    notesFolder: plugin.settings.notesFolder,
    filenameFormat: plugin.settings.filenameFormat,
    detail,
    existingFile: file,
    enrichment,
  });
  plugin.rememberLiteratureNoteFile(detail, writeResult.file);
  recordRefreshSuccess(plugin, library);
}

export function refreshOpenedLiteratureNote(
  plugin: StratumPlugin,
  file: TFile,
): Promise<void> | null {
  if (plugin.isBulkLibrarySyncRunning()) {
    return null;
  }

  const target = getRefreshTarget(plugin, file);
  if (!target) {
    return null;
  }

  const existing = plugin.noteRefreshPromises.get(file.path);
  if (existing) {
    return existing;
  }

  const pending = runOpenedLiteratureNoteRefresh(plugin, file)
    .catch((error) => {
      recordRefreshFailure(plugin, target.library, error);
      showRefreshNotice(plugin, error);
      console.error("stratum: literature note refresh failed", error);
    })
    .finally(() => {
      plugin.noteRefreshPromises.delete(file.path);
      plugin.refreshAutoSyncUi();
    });

  plugin.noteRefreshPromises.set(file.path, pending);
  plugin.refreshAutoSyncUi();
  return pending;
}

export function refreshReaderLiteratureNote(
  plugin: StratumPlugin,
  file: TFile,
): Promise<void> | null {
  return refreshOpenedLiteratureNote(plugin, file);
}
