import { Notice, TFile } from "obsidian";
import { markLiteratureNoteDeleted } from "./literature-note";
import {
  ZoteroNotConnectedError,
  ZoteroTokenInvalidError,
} from "./backend-client";
import { PLUGIN_NAME } from "./constants";
import { shouldMarkLiteratureNoteDeletedAfterRefreshMiss } from "./plugin-note-refresh-policy";
import { getLibraryAutoSyncState } from "./plugin-libraries";
import { getLibraryFromFrontmatter } from "./plugin-local-sync";
import {
  getIdentityFromFrontmatter,
  getItemKeyFromFrontmatter,
} from "./plugin-note-index";
import type StratumPlugin from "./plugin";
import {
  markZoteroDisconnected,
  markZoteroTokenInvalid,
} from "./plugin-sync-helpers";
import {
  LocalZoteroApiDisabledError,
  LocalZoteroApiVersionMismatchError,
  LocalZoteroHttpServerUnavailableError,
  LocalZoteroUnavailableError,
} from "./zotero-local";
import {
  loadZoteroItemDetailForNoteSync,
  writeLiteratureNoteFromDetail,
} from "./plugin-note-sync";

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
  const {
    detail,
    usedLocal,
    localMissing,
    backendMissing,
    localError,
    backendError,
  } = await loadZoteroItemDetailForNoteSync(plugin, {
    library,
    itemKey,
    sourcePreference: "auto",
  });

  if (!detail) {
    if (
      shouldMarkLiteratureNoteDeletedAfterRefreshMiss({
        usedLocal,
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

  await writeLiteratureNoteFromDetail(plugin, {
    detail,
    existingFile: file,
    enrichmentMode: "load",
  });
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
