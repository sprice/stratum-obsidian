import { Notice } from "obsidian";
import { createOrUpdateLiteratureNote } from "./literature-note";
import {
  type ZoteroLibraryCatalogItem,
  type ZoteroLibraryCatalogPageResponse,
  type ZoteroLibraryIdentity,
  ZoteroNotConnectedError,
  ZoteroRateLimitedError,
  ZoteroTokenInvalidError,
} from "./backend-client";
import { PLUGIN_NAME } from "./constants";
import type StratumPlugin from "./plugin";
import { getIdentityCacheKey } from "./plugin-note-index";
import { applyZoteroLibraryChanges } from "./plugin-sync";
import {
  ensureZoteroConnection,
  isMissingZoteroItemError,
  markZoteroDisconnected,
  markZoteroTokenInvalid,
} from "./plugin-sync-helpers";
import {
  DEFAULT_BULK_LIBRARY_SYNC_STATE,
  type BulkLibrarySyncState,
} from "./zotero-sync";

const BULK_LIBRARY_SYNC_PAGE_SIZE = 100;
const BULK_LIBRARY_SYNC_CONCURRENCY = 2;
const BULK_LIBRARY_SYNC_ITEM_START_GAP_MS = 250;
const BULK_LIBRARY_SYNC_UI_REFRESH_MS = 120;
const MAX_FAILED_ITEM_KEYS = 25;

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
  totalCount: number
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

function buildFreshBulkLibrarySyncState(): BulkLibrarySyncState {
  const now = new Date().toISOString();
  return {
    ...DEFAULT_BULK_LIBRARY_SYNC_STATE,
    phase: "running",
    startedAt: now,
    pageSize: BULK_LIBRARY_SYNC_PAGE_SIZE,
  };
}

function buildRunningBulkLibrarySyncState(
  currentState: BulkLibrarySyncState
): BulkLibrarySyncState {
  if (!isResumableBulkLibrarySyncState(currentState)) {
    return buildFreshBulkLibrarySyncState();
  }

  return {
    ...currentState,
    phase: "running",
    completedAt: null,
    lastError: null,
    retryAfterSeconds: null,
  };
}

function commitBulkCatalogPage(
  plugin: StratumPlugin,
  page: ZoteroLibraryCatalogPageResponse,
  result: CatalogPageResult
): void {
  const state = plugin.settings.bulkLibrarySync;
  state.snapshotLibraryVersion = page.snapshotLibraryVersion ?? state.snapshotLibraryVersion;
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
  itemKey: string
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

function shouldSkipCatalogItem(
  plugin: StratumPlugin,
  library: ZoteroLibraryIdentity,
  item: ZoteroLibraryCatalogItem
): boolean {
  const cacheKey = getIdentityCacheKey(getCatalogIdentity(library, item.key));
  const existingEntry = plugin.settings.itemFileMap[cacheKey];
  if (!existingEntry || existingEntry.zoteroVersion < item.version) {
    return false;
  }

  return Boolean(
    plugin.findExistingLiteratureNoteFile(getCatalogIdentity(library, item.key))
  );
}

async function syncCatalogItem(
  plugin: StratumPlugin,
  library: ZoteroLibraryIdentity,
  item: ZoteroLibraryCatalogItem,
  reserveStartSlot: () => Promise<void>
): Promise<"created" | "updated" | "skipped"> {
  if (shouldSkipCatalogItem(plugin, library, item)) {
    return "skipped";
  }

  const existingFile = plugin.findExistingLiteratureNoteFile(
    getCatalogIdentity(library, item.key)
  );
  if (shouldSkipCatalogItem(plugin, library, item)) {
    return "skipped";
  }

  await reserveStartSlot();
  const detail = await plugin.backend.getZoteroItemDetail(item.key);
  const writeResult = await createOrUpdateLiteratureNote({
    app: plugin.app,
    notesFolder: plugin.settings.notesFolder,
    filenameFormat: plugin.settings.filenameFormat,
    detail,
    existingFile,
  });
  plugin.rememberLiteratureNoteFile(detail, writeResult.file);
  return writeResult.created ? "created" : "updated";
}

async function processCatalogPage(
  plugin: StratumPlugin,
  page: ZoteroLibraryCatalogPageResponse
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
    nextStartAt = Math.max(nextStartAt, now) + BULK_LIBRARY_SYNC_ITEM_START_GAP_MS;
    if (waitMs > 0) {
      await delay(waitMs);
    }
  };

  const workerCount = Math.min(BULK_LIBRARY_SYNC_CONCURRENCY, page.items.length);
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
          page.library,
          item,
          reserveStartSlot
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
          console.error(`stratum: bulk sync failed for item ${item.key}`, error);
        }
      } finally {
        processedCount += 1;
        setBulkLibrarySyncPageProgress(plugin, processedCount, page.items.length);
      }
    }
  });

  await Promise.all(workers);
  if (fatalError !== null) {
    throwBulkSyncError(fatalError);
  }

  return result;
}

async function runFinalBulkSyncCatchUp(plugin: StratumPlugin): Promise<void> {
  const changes = await plugin.backend.getZoteroLibraryChanges(
    plugin.settings.bulkLibrarySync.snapshotLibraryVersion
  );
  await applyZoteroLibraryChanges(plugin, changes);
  plugin.settings.zoteroAutoSync.libraryVersion = changes.latestLibraryVersion;
  plugin.settings.zoteroAutoSync.initialRefreshCompleted = true;
  plugin.settings.zoteroAutoSync.lastSuccessfulSyncAt = new Date().toISOString();
  plugin.settings.zoteroAutoSync.lastError = null;
}

function formatBulkSyncCompletionNotice(state: BulkLibrarySyncState): string {
  const parts = [
    `${PLUGIN_NAME}: synced ${state.processedCount} Zotero paper${
      state.processedCount === 1 ? "" : "s"
    }`,
  ];

  const changeSummary = [
    state.createdCount > 0
      ? `created ${state.createdCount} note${state.createdCount === 1 ? "" : "s"}`
      : null,
    state.updatedCount > 0
      ? `updated ${state.updatedCount} note${state.updatedCount === 1 ? "" : "s"}`
      : null,
    state.failedCount > 0
      ? `${state.failedCount} failed`
      : null,
  ].filter(Boolean);

  if (changeSummary.length > 0) {
    parts.push(`(${changeSummary.join(", ")})`);
  }

  return `${parts.join(" ")}.`;
}

async function retryFailedCatalogItems(plugin: StratumPlugin): Promise<{
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  remainingFailedItemKeys: string[];
}> {
  const failedItemKeys = [...plugin.settings.bulkLibrarySync.failedItemKeys];
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
      const detail = await plugin.backend.getZoteroItemDetail(itemKey);
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

export function getBulkLibrarySyncProcessedCount(plugin: StratumPlugin): number {
  return (
    plugin.settings.bulkLibrarySync.processedCount +
    plugin.bulkLibrarySyncCurrentPageProcessedCount
  );
}

export async function runBulkLibrarySync(plugin: StratumPlugin): Promise<void> {
  if (plugin.bulkLibrarySyncRunPromise) {
    new Notice(`${PLUGIN_NAME}: Zotero bulk sync is already running.`);
    return;
  }

  const runPromise = (async () => {
    try {
      if (plugin.isAutoSyncRunning) {
        new Notice(`${PLUGIN_NAME}: Wait for the current Zotero sync to finish first.`);
        return;
      }

      if (!(await ensureZoteroConnection(plugin, { refresh: true }))) {
        new Notice(`${PLUGIN_NAME}: Connect Zotero before syncing your library.`);
        return;
      }

      await plugin.rebuildItemFileMap();

      const shouldResume = isResumableBulkLibrarySyncState(plugin.settings.bulkLibrarySync);
      plugin.settings.bulkLibrarySync = buildRunningBulkLibrarySyncState(
        plugin.settings.bulkLibrarySync
      );
      await plugin.saveSettings();
      resetBulkLibrarySyncRuntime(plugin);
      queueBulkLibrarySyncUiRefresh(plugin);

      if (shouldResume) {
        new Notice(`${PLUGIN_NAME}: resuming Zotero paper sync...`);
      } else {
        new Notice(`${PLUGIN_NAME}: syncing all Zotero papers...`);
      }

      while (true) {
        const state = plugin.settings.bulkLibrarySync;
        const page = await plugin.backend.getZoteroLibraryCatalogPage({
          start: state.nextStart,
          limit: state.pageSize,
        });
        state.snapshotLibraryVersion =
          state.snapshotLibraryVersion ?? page.snapshotLibraryVersion;
        state.totalResults = page.totalResults ?? state.totalResults;
        queueBulkLibrarySyncUiRefresh(plugin);

        const pageResult = await processCatalogPage(plugin, page);
        commitBulkCatalogPage(plugin, page, pageResult);
        resetBulkLibrarySyncRuntime(plugin);
        await plugin.saveSettings();
        queueBulkLibrarySyncUiRefresh(plugin);

        if (!page.hasMore || page.nextStart === null) {
          break;
        }
      }

      const retryResult = await retryFailedCatalogItems(plugin);
      plugin.settings.bulkLibrarySync.createdCount += retryResult.createdCount;
      plugin.settings.bulkLibrarySync.updatedCount += retryResult.updatedCount;
      plugin.settings.bulkLibrarySync.skippedCount += retryResult.skippedCount;
      plugin.settings.bulkLibrarySync.failedItemKeys = retryResult.remainingFailedItemKeys;
      plugin.settings.bulkLibrarySync.failedCount = retryResult.remainingFailedItemKeys.length;
      resetBulkLibrarySyncRuntime(plugin);
      await plugin.saveSettings();
      queueBulkLibrarySyncUiRefresh(plugin);

      if (retryResult.remainingFailedItemKeys.length > 0) {
        plugin.settings.bulkLibrarySync.phase = "paused-error";
        plugin.settings.bulkLibrarySync.lastError =
          retryResult.remainingFailedItemKeys.length === 1
            ? "1 paper still failed to sync. Resume to retry it."
            : `${retryResult.remainingFailedItemKeys.length} papers still failed to sync. Resume to retry them.`;
        plugin.settings.bulkLibrarySync.retryAfterSeconds = null;
        await plugin.saveSettings();
        new Notice(`${PLUGIN_NAME}: ${plugin.settings.bulkLibrarySync.lastError}`);
        return;
      }

      await runFinalBulkSyncCatchUp(plugin);
      plugin.settings.bulkLibrarySync.phase = "completed";
      plugin.settings.bulkLibrarySync.completedAt = new Date().toISOString();
      plugin.settings.bulkLibrarySync.lastError = null;
      plugin.settings.bulkLibrarySync.retryAfterSeconds = null;
      await plugin.saveSettings();
      new Notice(formatBulkSyncCompletionNotice(plugin.settings.bulkLibrarySync));
    } catch (error) {
      if (error instanceof ZoteroTokenInvalidError) {
        markZoteroTokenInvalid(plugin);
        plugin.settings.bulkLibrarySync.phase = "paused-error";
        plugin.settings.bulkLibrarySync.lastError =
          "Zotero connection is no longer valid. Please reconnect in settings.";
        plugin.settings.bulkLibrarySync.retryAfterSeconds = null;
        await plugin.saveSettings();
        new Notice(
          `${PLUGIN_NAME}: Zotero connection is no longer valid. Please reconnect in settings.`
        );
      } else if (error instanceof ZoteroNotConnectedError) {
        markZoteroDisconnected(plugin);
        plugin.settings.bulkLibrarySync.phase = "paused-error";
        plugin.settings.bulkLibrarySync.lastError =
          "Zotero is not connected. Please connect it again in settings.";
        plugin.settings.bulkLibrarySync.retryAfterSeconds = null;
        await plugin.saveSettings();
        new Notice(`${PLUGIN_NAME}: Zotero is not connected. Please connect it again in settings.`);
      } else if (error instanceof ZoteroRateLimitedError) {
        plugin.settings.bulkLibrarySync.phase = "paused-rate-limit";
        plugin.settings.bulkLibrarySync.lastError = error.message;
        plugin.settings.bulkLibrarySync.retryAfterSeconds = error.retryAfterSeconds;
        await plugin.saveSettings();
        new Notice(`${PLUGIN_NAME}: ${error.message}`);
      } else {
        plugin.settings.bulkLibrarySync.phase = "paused-error";
        plugin.settings.bulkLibrarySync.lastError =
          error instanceof Error ? error.message : String(error);
        plugin.settings.bulkLibrarySync.retryAfterSeconds = null;
        await plugin.saveSettings();
        console.error("stratum: bulk Zotero sync failed", error);
        new Notice(
          `${PLUGIN_NAME}: ${
            error instanceof Error ? error.message : "Bulk Zotero sync failed."
          }`
        );
      }
    } finally {
      resetBulkLibrarySyncRuntime(plugin);
      plugin.bulkLibrarySyncRunPromise = null;
      plugin.refreshViews();
      plugin.refreshSettingTab();
      plugin.refreshAutoSyncUi();
    }
  })();

  plugin.bulkLibrarySyncRunPromise = runPromise;
  await runPromise;
}
