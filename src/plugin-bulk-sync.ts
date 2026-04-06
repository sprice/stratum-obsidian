import { Notice } from "obsidian";
import { createOrUpdateLiteratureNote } from "./literature-note";
import { log } from "./log";
import {
  type ZoteroCollectionSummary,
  type ZoteroLibraryCatalogItem,
  type ZoteroLibraryCatalogPageResponse,
  type ZoteroLibraryIdentity,
  ZoteroNotConnectedError,
  ZoteroRateLimitedError,
  ZoteroTokenInvalidError,
} from "./backend-client";
import { PLUGIN_NAME } from "./constants";
import type StratumPlugin from "./plugin";
import type { EnabledLibrary } from "./settings";
import {
  getActiveBulkSyncLibrary,
  getLibraryAutoSyncState,
  getLibraryBulkSyncState,
} from "./plugin-libraries";
import { applyZoteroLibraryChanges } from "./plugin-sync";
import {
  ensureZoteroConnection,
  isMissingZoteroItemError,
  markZoteroDisconnected,
  markZoteroTokenInvalid,
} from "./plugin-sync-helpers";
import {
  type BulkLibrarySyncState,
  buildDefaultBulkLibrarySyncState,
} from "./zotero-sync";

const BULK_LIBRARY_SYNC_PAGE_SIZE = 100;
const BULK_LIBRARY_SYNC_CONCURRENCY = 2;
const BULK_LIBRARY_SYNC_ITEM_START_GAP_MS = 250;
const BULK_LIBRARY_SYNC_UI_REFRESH_MS = 120;
const MAX_FAILED_ITEM_KEYS = 25;

type BulkSyncScope = {
  collectionKey: string | null;
  collectionName: string | null;
};

type CatalogPageResult = {
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  failedItemKeys: string[];
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function throwBulkSyncError(error: Error): never {
  throw error;
}

function queueBulkLibrarySyncUiRefresh(plugin: StratumPlugin): void {
  if (plugin.bulkLibrarySyncUiRefreshTimer !== null) {
    return;
  }

  plugin.bulkLibrarySyncUiRefreshTimer = window.setTimeout(() => {
    plugin.bulkLibrarySyncUiRefreshTimer = null;
    plugin.refreshViews();
    plugin.refreshSettingTab();
    plugin.refreshAutoSyncUi();
  }, BULK_LIBRARY_SYNC_UI_REFRESH_MS);
}

function resetBulkLibrarySyncRuntime(plugin: StratumPlugin): void {
  plugin.bulkLibrarySyncCurrentPageProcessedCount = 0;
  plugin.bulkLibrarySyncCurrentPageTotalCount = 0;

  if (plugin.bulkLibrarySyncUiRefreshTimer !== null) {
    window.clearTimeout(plugin.bulkLibrarySyncUiRefreshTimer);
    plugin.bulkLibrarySyncUiRefreshTimer = null;
  }
}

function setBulkLibrarySyncPageProgress(
  plugin: StratumPlugin,
  processedCount: number,
  totalCount: number,
): void {
  plugin.bulkLibrarySyncCurrentPageProcessedCount = processedCount;
  plugin.bulkLibrarySyncCurrentPageTotalCount = totalCount;
  queueBulkLibrarySyncUiRefresh(plugin);
}

function pushFailedItemKey(target: string[], itemKey: string): void {
  if (target.includes(itemKey) || target.length >= MAX_FAILED_ITEM_KEYS) {
    return;
  }

  target.push(itemKey);
}

function isResumableBulkLibrarySyncState(state: BulkLibrarySyncState): boolean {
  return state.phase === "paused-rate-limit" || state.phase === "paused-error";
}

function buildBulkSyncScope(
  collection: ZoteroCollectionSummary | null,
): BulkSyncScope {
  return {
    collectionKey: collection?.key ?? null,
    collectionName: collection?.displayName ?? null,
  };
}

function doesBulkSyncStateMatchScope(
  state: BulkLibrarySyncState,
  scope: BulkSyncScope,
): boolean {
  return state.collectionKey === scope.collectionKey;
}

function buildFreshBulkLibrarySyncState(
  scope: BulkSyncScope,
): BulkLibrarySyncState {
  const now = new Date().toISOString();
  return {
    ...buildDefaultBulkLibrarySyncState(),
    phase: "running",
    startedAt: now,
    collectionKey: scope.collectionKey,
    collectionName: scope.collectionName,
    pageSize: BULK_LIBRARY_SYNC_PAGE_SIZE,
  };
}

function buildRunningBulkLibrarySyncState(
  currentState: BulkLibrarySyncState,
  scope: BulkSyncScope,
): BulkLibrarySyncState {
  if (
    !isResumableBulkLibrarySyncState(currentState) ||
    !doesBulkSyncStateMatchScope(currentState, scope)
  ) {
    return buildFreshBulkLibrarySyncState(scope);
  }

  return {
    ...currentState,
    phase: "running",
    completedAt: null,
    collectionKey: scope.collectionKey,
    collectionName: scope.collectionName,
    lastError: null,
    retryAfterSeconds: null,
  };
}

function commitBulkCatalogPage(
  plugin: StratumPlugin,
  library: EnabledLibrary,
  page: ZoteroLibraryCatalogPageResponse,
  result: CatalogPageResult,
): void {
  const state = getLibraryBulkSyncState(plugin, library);
  state.snapshotLibraryVersion =
    page.snapshotLibraryVersion ?? state.snapshotLibraryVersion;
  state.totalResults = page.totalResults ?? state.totalResults;
  state.nextStart = page.nextStart ?? page.start + page.limit;
  state.processedCount += page.items.length;
  state.createdCount += result.createdCount;
  state.updatedCount += result.updatedCount;
  state.skippedCount += result.skippedCount;
  state.failedCount += result.failedCount;
  for (const itemKey of result.failedItemKeys) {
    pushFailedItemKey(state.failedItemKeys, itemKey);
  }
}

function getCatalogIdentity(
  library: ZoteroLibraryIdentity,
  itemKey: string,
): {
  libraryType: string;
  libraryId: string;
  itemKey: string;
} {
  return {
    libraryType: library.type,
    libraryId: library.id,
    itemKey,
  };
}

async function syncCatalogItem(
  plugin: StratumPlugin,
  library: EnabledLibrary,
  item: ZoteroLibraryCatalogItem,
  reserveStartSlot: () => Promise<void>,
): Promise<"created" | "updated" | "skipped"> {
  const existingFile = plugin.findExistingLiteratureNoteFile(
    getCatalogIdentity(library, item.key),
  );

  await reserveStartSlot();
  const detail = await plugin.backend.getZoteroItemDetail(item.key, {
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
    existingFile,
    enrichment,
  });
  plugin.rememberLiteratureNoteFile(detail, writeResult.file);
  return writeResult.created ? "created" : "updated";
}

async function processCatalogPage(
  plugin: StratumPlugin,
  library: EnabledLibrary,
  page: ZoteroLibraryCatalogPageResponse,
): Promise<CatalogPageResult> {
  const result: CatalogPageResult = {
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    failedItemKeys: [],
  };

  setBulkLibrarySyncPageProgress(plugin, 0, page.items.length);
  if (page.items.length === 0) {
    return result;
  }

  let nextIndex = 0;
  let processedCount = 0;
  let fatalError: Error | null = null;
  let nextStartAt = Date.now();

  const reserveStartSlot = async (): Promise<void> => {
    const now = Date.now();
    const waitMs = Math.max(0, nextStartAt - now);
    nextStartAt =
      Math.max(nextStartAt, now) + BULK_LIBRARY_SYNC_ITEM_START_GAP_MS;
    if (waitMs > 0) {
      await delay(waitMs);
    }
  };

  const workerCount = Math.min(
    BULK_LIBRARY_SYNC_CONCURRENCY,
    page.items.length,
  );
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      if (fatalError) {
        return;
      }

      const index = nextIndex;
      nextIndex += 1;
      if (index >= page.items.length) {
        return;
      }

      const item = page.items[index];
      try {
        const outcome = await syncCatalogItem(
          plugin,
          library,
          item,
          reserveStartSlot,
        );
        if (outcome === "created") {
          result.createdCount += 1;
        } else if (outcome === "updated") {
          result.updatedCount += 1;
        } else {
          result.skippedCount += 1;
        }
      } catch (error) {
        if (
          error instanceof ZoteroRateLimitedError ||
          error instanceof ZoteroTokenInvalidError ||
          error instanceof ZoteroNotConnectedError
        ) {
          fatalError =
            fatalError ??
            (error instanceof Error ? error : new Error(String(error)));
        } else if (isMissingZoteroItemError(error)) {
          result.skippedCount += 1;
        } else {
          result.failedCount += 1;
          pushFailedItemKey(result.failedItemKeys, item.key);
          console.error(
            `stratum: bulk sync failed for item ${item.key}`,
            error,
          );
        }
      } finally {
        processedCount += 1;
        setBulkLibrarySyncPageProgress(
          plugin,
          processedCount,
          page.items.length,
        );
      }
    }
  });

  await Promise.all(workers);
  if (fatalError !== null) {
    throwBulkSyncError(fatalError);
  }

  return result;
}

async function runFinalBulkSyncCatchUp(
  plugin: StratumPlugin,
  collectionKey: string | null,
): Promise<void> {
  if (collectionKey) {
    return;
  }

  const library = getActiveBulkSyncLibrary(plugin);
  if (!library) {
    return;
  }

  const bulkState = getLibraryBulkSyncState(plugin, library);
  const autoSyncState = getLibraryAutoSyncState(plugin, library);
  const changes = await plugin.backend.getZoteroLibraryChanges(
    bulkState.snapshotLibraryVersion,
    {
      library,
    },
  );
  await applyZoteroLibraryChanges(plugin, changes);
  autoSyncState.libraryVersion = changes.latestLibraryVersion;
  autoSyncState.initialRefreshCompleted = true;
  autoSyncState.lastSuccessfulSyncAt = new Date().toISOString();
  autoSyncState.lastError = null;
}

function formatBulkSyncCompletionNotice(
  library: EnabledLibrary,
  state: BulkLibrarySyncState,
): string {
  const parts = [
    state.collectionName
      ? `${PLUGIN_NAME}: synced ${state.processedCount} paper${
          state.processedCount === 1 ? "" : "s"
        } from ${state.collectionName}`
      : `${PLUGIN_NAME}: synced ${state.processedCount} paper${
          state.processedCount === 1 ? "" : "s"
        } in ${library.name}`,
  ];

  const changeSummary = [
    state.createdCount > 0
      ? `created ${state.createdCount} note${state.createdCount === 1 ? "" : "s"}`
      : null,
    state.updatedCount > 0
      ? `updated ${state.updatedCount} note${state.updatedCount === 1 ? "" : "s"}`
      : null,
    state.failedCount > 0 ? `${state.failedCount} failed` : null,
  ].filter(Boolean);

  if (changeSummary.length > 0) {
    parts.push(`(${changeSummary.join(", ")})`);
  }

  return `${parts.join(" ")}.`;
}

async function retryFailedCatalogItems(
  plugin: StratumPlugin,
  library: EnabledLibrary,
): Promise<{
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  remainingFailedItemKeys: string[];
}> {
  const state = getLibraryBulkSyncState(plugin, library);
  const failedItemKeys = [...state.failedItemKeys];
  if (failedItemKeys.length === 0) {
    return {
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      remainingFailedItemKeys: [],
    };
  }

  const result = {
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    remainingFailedItemKeys: [] as string[],
  };

  setBulkLibrarySyncPageProgress(plugin, 0, failedItemKeys.length);
  for (let index = 0; index < failedItemKeys.length; index += 1) {
    const itemKey = failedItemKeys[index];
    try {
      const detail = await plugin.backend.getZoteroItemDetail(itemKey, {
        library,
      });
      const enrichment = detail.item.doi
        ? await plugin.backend.getOpenAlexEnrichment(detail.item.doi)
        : null;
      const existingFile = plugin.findExistingLiteratureNoteFile({
        libraryType: detail.library.type,
        libraryId: detail.library.id,
        itemKey,
      });
      const writeResult = await createOrUpdateLiteratureNote({
        app: plugin.app,
        notesFolder: plugin.settings.notesFolder,
        filenameFormat: plugin.settings.filenameFormat,
        detail,
        existingFile,
        enrichment,
      });
      plugin.rememberLiteratureNoteFile(detail, writeResult.file);
      if (writeResult.created) {
        result.createdCount += 1;
      } else {
        result.updatedCount += 1;
      }
    } catch (error) {
      if (
        error instanceof ZoteroRateLimitedError ||
        error instanceof ZoteroTokenInvalidError ||
        error instanceof ZoteroNotConnectedError
      ) {
        throw error;
      }

      if (isMissingZoteroItemError(error)) {
        result.skippedCount += 1;
      } else {
        pushFailedItemKey(result.remainingFailedItemKeys, itemKey);
        console.error(`stratum: bulk retry failed for item ${itemKey}`, error);
      }
    } finally {
      setBulkLibrarySyncPageProgress(plugin, index + 1, failedItemKeys.length);
    }
  }

  return result;
}

export function getBulkLibrarySyncProcessedCount(
  plugin: StratumPlugin,
): number {
  const activeLibrary = getActiveBulkSyncLibrary(plugin);
  if (!activeLibrary) {
    return 0;
  }

  return (
    getLibraryBulkSyncState(plugin, activeLibrary).processedCount +
    plugin.bulkLibrarySyncCurrentPageProcessedCount
  );
}

export async function runBulkLibrarySync(
  plugin: StratumPlugin,
  library: EnabledLibrary,
  collection: ZoteroCollectionSummary | null,
): Promise<void> {
  if (plugin.bulkLibrarySyncRunPromise) {
    new Notice(`${PLUGIN_NAME}: Zotero bulk sync is already running.`);
    return;
  }

  const runPromise = (async () => {
    try {
      if (plugin.isAutoSyncRunning) {
        new Notice(
          `${PLUGIN_NAME}: Wait for the current Zotero sync to finish first.`,
        );
        return;
      }

      if (!(await ensureZoteroConnection(plugin, { refresh: true }))) {
        new Notice(
          `${PLUGIN_NAME}: Connect Zotero before syncing your library.`,
        );
        return;
      }

      await plugin.rebuildItemFileMap();

      const state = getLibraryBulkSyncState(plugin, library);
      const scope = buildBulkSyncScope(collection);
      if (
        isResumableBulkLibrarySyncState(state) &&
        !doesBulkSyncStateMatchScope(state, scope)
      ) {
        new Notice(
          state.collectionName
            ? `${PLUGIN_NAME}: Resume the paused sync for ${state.collectionName} before starting a different collection.`
            : `${PLUGIN_NAME}: Resume the paused library sync before starting a different collection.`,
        );
        return;
      }
      const shouldResume =
        isResumableBulkLibrarySyncState(state) &&
        doesBulkSyncStateMatchScope(state, scope);
      plugin.settings.libraryBulkSync[library.identity] =
        buildRunningBulkLibrarySyncState(state, scope);
      plugin.settings.activeBulkSyncLibrary = library.identity;
      await plugin.saveSettings();
      resetBulkLibrarySyncRuntime(plugin);
      queueBulkLibrarySyncUiRefresh(plugin);

      log("bulk-sync", "starting", {
        library: library.identity,
        collection: scope.collectionKey,
        resuming: shouldResume,
      });
      if (shouldResume) {
        new Notice(
          scope.collectionName
            ? `${PLUGIN_NAME}: resuming paper sync from ${scope.collectionName}...`
            : `${PLUGIN_NAME}: resuming paper sync in ${library.name}...`,
        );
      } else {
        new Notice(
          scope.collectionName
            ? `${PLUGIN_NAME}: syncing all papers from ${scope.collectionName}...`
            : `${PLUGIN_NAME}: syncing all papers in ${library.name}...`,
        );
      }

      while (true) {
        const libraryState = getLibraryBulkSyncState(plugin, library);
        log("bulk-sync", "fetching catalog page", {
          library: library.identity,
          start: libraryState.nextStart,
          limit: libraryState.pageSize,
        });
        const page = await plugin.backend.getZoteroLibraryCatalogPage({
          start: libraryState.nextStart,
          limit: libraryState.pageSize,
          library,
          collectionKey: libraryState.collectionKey,
        });
        libraryState.snapshotLibraryVersion =
          libraryState.snapshotLibraryVersion ?? page.snapshotLibraryVersion;
        libraryState.totalResults =
          page.totalResults ?? libraryState.totalResults;
        queueBulkLibrarySyncUiRefresh(plugin);

        const pageResult = await processCatalogPage(plugin, library, page);
        log("bulk-sync", "page processed", {
          library: library.identity,
          created: pageResult.createdCount,
          updated: pageResult.updatedCount,
          skipped: pageResult.skippedCount,
          failed: pageResult.failedCount,
        });
        commitBulkCatalogPage(plugin, library, page, pageResult);
        resetBulkLibrarySyncRuntime(plugin);
        await plugin.saveSettings();
        queueBulkLibrarySyncUiRefresh(plugin);

        if (!page.hasMore || page.nextStart === null) {
          break;
        }
      }

      const retryResult = await retryFailedCatalogItems(plugin, library);
      const retryState = getLibraryBulkSyncState(plugin, library);
      retryState.createdCount += retryResult.createdCount;
      retryState.updatedCount += retryResult.updatedCount;
      retryState.skippedCount += retryResult.skippedCount;
      retryState.failedItemKeys = retryResult.remainingFailedItemKeys;
      retryState.failedCount = retryResult.remainingFailedItemKeys.length;
      resetBulkLibrarySyncRuntime(plugin);
      await plugin.saveSettings();
      queueBulkLibrarySyncUiRefresh(plugin);

      if (retryResult.remainingFailedItemKeys.length > 0) {
        retryState.phase = "paused-error";
        retryState.lastError =
          retryResult.remainingFailedItemKeys.length === 1
            ? "1 paper still failed to sync. Resume to retry it."
            : `${retryResult.remainingFailedItemKeys.length} papers still failed to sync. Resume to retry them.`;
        retryState.retryAfterSeconds = null;
        await plugin.saveSettings();
        new Notice(`${PLUGIN_NAME}: ${retryState.lastError}`);
        return;
      }

      resetBulkLibrarySyncRuntime(plugin);
      log("bulk-sync", "running final catch-up", { library: library.identity });
      await runFinalBulkSyncCatchUp(plugin, scope.collectionKey);
      const completedState = getLibraryBulkSyncState(plugin, library);
      completedState.phase = "completed";
      log("bulk-sync", "completed", {
        library: library.identity,
        processed: completedState.processedCount,
        created: completedState.createdCount,
        updated: completedState.updatedCount,
      });
      completedState.completedAt = new Date().toISOString();
      completedState.lastError = null;
      completedState.retryAfterSeconds = null;
      await plugin.saveSettings();
      new Notice(formatBulkSyncCompletionNotice(library, completedState));
    } catch (error) {
      const state = getLibraryBulkSyncState(plugin, library);
      if (error instanceof ZoteroTokenInvalidError) {
        markZoteroTokenInvalid(plugin);
        state.phase = "paused-error";
        state.lastError =
          "Zotero connection is no longer valid. Please reconnect in settings.";
        state.retryAfterSeconds = null;
        await plugin.saveSettings();
        new Notice(
          `${PLUGIN_NAME}: Zotero connection is no longer valid. Please reconnect in settings.`,
        );
      } else if (error instanceof ZoteroNotConnectedError) {
        markZoteroDisconnected(plugin);
        state.phase = "paused-error";
        state.lastError =
          "Zotero is not connected. Please connect it again in settings.";
        state.retryAfterSeconds = null;
        await plugin.saveSettings();
        new Notice(
          `${PLUGIN_NAME}: Zotero is not connected. Please connect it again in settings.`,
        );
      } else if (error instanceof ZoteroRateLimitedError) {
        state.phase = "paused-rate-limit";
        state.lastError = error.message;
        state.retryAfterSeconds = error.retryAfterSeconds;
        await plugin.saveSettings();
        new Notice(`${PLUGIN_NAME}: ${error.message}`);
      } else {
        state.phase = "paused-error";
        state.lastError =
          error instanceof Error ? error.message : String(error);
        state.retryAfterSeconds = null;
        await plugin.saveSettings();
        console.error("stratum: bulk Zotero sync failed", error);
        new Notice(
          `${PLUGIN_NAME}: ${
            error instanceof Error ? error.message : "Bulk Zotero sync failed."
          }`,
        );
      }
    } finally {
      resetBulkLibrarySyncRuntime(plugin);
      plugin.settings.activeBulkSyncLibrary = null;
      await plugin.saveSettings();
      plugin.bulkLibrarySyncRunPromise = null;
      log("bulk-sync", "cleanup done, refreshing UI");
      plugin.refreshViews();
      plugin.refreshSettingTab();
      plugin.refreshAutoSyncUi();
    }
  })();

  plugin.bulkLibrarySyncRunPromise = runPromise;
  await runPromise;
}
