import { Notice, TFile } from "obsidian";
import type {
  OpenAlexEnrichmentBatchResult,
  ZoteroCollectionSummary,
} from "./backend-client";
import { PLUGIN_NAME } from "./constants";
import { getNormalizedDoiLookupKey } from "./doi";
import { log } from "./log";
import {
  getLibraryAutoSyncState,
  getLibraryBulkSyncState,
} from "./plugin-libraries";
import type StratumPlugin from "./plugin";
import type { EnabledLibrary } from "./settings";
import {
  type BulkLibrarySyncState,
  buildDefaultBulkLibrarySyncState,
  formatBulkLibrarySyncCompletionMessage,
} from "./zotero-sync";
import {
  LocalZoteroApiError,
  LocalZoteroUnavailableError,
  loadLocalZoteroCatalogPage,
} from "./zotero-local";
import {
  loadLocalZoteroItemDetailForPlugin,
  resolveLocalZoteroUserId,
  writeLiteratureNoteFromDetail,
} from "./plugin-note-sync";

// Keep this at or below OpenAlex's documented batch-ID limit.
const BULK_LIBRARY_SYNC_PAGE_SIZE = 50;
const BULK_LIBRARY_SYNC_CONCURRENCY = 2;
const BULK_LIBRARY_SYNC_UI_REFRESH_MS = 120;

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
  touchedNotes: TouchedNote[];
};

type TouchedNote = {
  file: TFile | null;
  itemKey: string;
  doi: string | null;
};

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
  plugin.bulkLibrarySyncStage = null;
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

function buildBulkSyncScope(
  collection: ZoteroCollectionSummary | null,
): BulkSyncScope {
  return {
    collectionKey: collection?.key ?? null,
    collectionName: collection?.displayName ?? null,
  };
}

function buildRunningBulkLibrarySyncState(
  scope: BulkSyncScope,
  startedAt: string,
): BulkLibrarySyncState {
  return {
    ...buildDefaultBulkLibrarySyncState(),
    phase: "running",
    startedAt,
    collectionKey: scope.collectionKey,
    collectionName: scope.collectionName,
    pageSize: BULK_LIBRARY_SYNC_PAGE_SIZE,
  };
}

function pushFailedItemKey(target: string[], itemKey: string): void {
  if (target.includes(itemKey)) {
    return;
  }

  target.push(itemKey);
}

function normalizeBulkSyncError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string" && error.trim()) {
    return new Error(error);
  }

  return new Error("Bulk sync failed.");
}

function commitBulkCatalogPage(
  plugin: StratumPlugin,
  library: EnabledLibrary,
  page: Awaited<ReturnType<typeof loadLocalZoteroCatalogPage>>,
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
  state.failedItemKeys = [...state.failedItemKeys];
  for (const itemKey of result.failedItemKeys) {
    pushFailedItemKey(state.failedItemKeys, itemKey);
  }
}

function primeBulkCatalogPage(
  plugin: StratumPlugin,
  library: EnabledLibrary,
  page: Awaited<ReturnType<typeof loadLocalZoteroCatalogPage>>,
): void {
  const state = getLibraryBulkSyncState(plugin, library);
  state.snapshotLibraryVersion =
    page.snapshotLibraryVersion ?? state.snapshotLibraryVersion;
  state.totalResults = page.totalResults ?? state.totalResults;
}

function mergeCatalogResults(
  initial: CatalogPageResult,
  retry: CatalogPageResult,
): CatalogPageResult {
  return {
    createdCount: initial.createdCount + retry.createdCount,
    updatedCount: initial.updatedCount + retry.updatedCount,
    skippedCount: initial.skippedCount + retry.skippedCount,
    failedCount: retry.failedCount,
    failedItemKeys: [...retry.failedItemKeys],
    touchedNotes: [...initial.touchedNotes, ...retry.touchedNotes],
  };
}

function getConnectedCloudZoteroUserId(plugin: StratumPlugin): string | null {
  return (
    plugin.zoteroConnection?.zoteroUserId ??
    plugin.settings.lastKnownZoteroUserId
  );
}

async function seedCloudAutoSyncBaselineAfterBulkSync(
  plugin: StratumPlugin,
  library: EnabledLibrary,
  collectionKey: string | null,
): Promise<void> {
  if (collectionKey) {
    return;
  }

  try {
    const baseline = await plugin.backend.getZoteroLibraryChanges(null, {
      library,
    });
    const autoSyncState = getLibraryAutoSyncState(plugin, library);
    autoSyncState.libraryVersion = baseline.latestLibraryVersion;
    autoSyncState.initialRefreshCompleted = true;
    autoSyncState.lastSuccessfulSyncAt = new Date().toISOString();
    autoSyncState.lastError = null;
  } catch (error) {
    console.error("stratum: failed to seed cloud auto-sync baseline", error);
  }
}

async function syncCatalogItem(
  plugin: StratumPlugin,
  library: EnabledLibrary,
  itemKey: string,
): Promise<{
  outcome: "created" | "updated";
  touched: TouchedNote;
}> {
  const existingFile = plugin.findExistingLiteratureNoteFile({
    libraryType: library.type,
    libraryId: library.id,
    itemKey,
  });
  const detail = await loadLocalZoteroItemDetailForPlugin(plugin, {
    library,
    itemKey,
  });
  const writeResult = await writeLiteratureNoteFromDetail(plugin, {
    detail,
    existingFile,
    enrichmentMode: "skip",
  });

  return {
    outcome: writeResult.created ? "created" : "updated",
    touched: {
      file: writeResult.file,
      itemKey,
      doi: detail.item.doi,
    },
  };
}

async function processCatalogPage(
  plugin: StratumPlugin,
  library: EnabledLibrary,
  page: Awaited<ReturnType<typeof loadLocalZoteroCatalogPage>>,
): Promise<CatalogPageResult> {
  const result: CatalogPageResult = {
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    failedItemKeys: [],
    touchedNotes: [],
  };

  setBulkLibrarySyncPageProgress(plugin, 0, page.items.length);
  if (page.items.length === 0) {
    return result;
  }

  let nextIndex = 0;
  let processedCount = 0;
  let fatalError: unknown = null;
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
        const synced = await syncCatalogItem(plugin, library, item.key);
        if (synced.outcome === "created") {
          result.createdCount += 1;
        } else {
          result.updatedCount += 1;
        }
        result.touchedNotes.push(synced.touched);
      } catch (error) {
        if (
          error instanceof LocalZoteroUnavailableError ||
          (error instanceof LocalZoteroApiError && error.status !== 404)
        ) {
          fatalError = fatalError ?? normalizeBulkSyncError(error);
        } else if (
          error instanceof LocalZoteroApiError &&
          error.status === 404
        ) {
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
  if (fatalError) {
    throw normalizeBulkSyncError(fatalError);
  }

  return result;
}

async function loadEnrichmentLookup(
  plugin: StratumPlugin,
  touchedNotes: TouchedNote[],
): Promise<Record<string, OpenAlexEnrichmentBatchResult>> {
  const dois = Array.from(
    new Set(
      touchedNotes
        .map((note) => note.doi)
        .filter((doi): doi is string => Boolean(doi)),
    ),
  );
  if (dois.length === 0) {
    return {};
  }

  return await plugin.backend.getOpenAlexEnrichments(dois, {
    throwOnFailure: true,
  });
}

async function retryFailedCatalogItems(
  plugin: StratumPlugin,
  library: EnabledLibrary,
  failedItemKeys: string[],
): Promise<CatalogPageResult> {
  const result: CatalogPageResult = {
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    failedItemKeys: [],
    touchedNotes: [],
  };

  if (failedItemKeys.length === 0) {
    return result;
  }

  setBulkLibrarySyncPageProgress(plugin, 0, failedItemKeys.length);
  for (let index = 0; index < failedItemKeys.length; index += 1) {
    const itemKey = failedItemKeys[index];
    try {
      const synced = await syncCatalogItem(plugin, library, itemKey);
      if (synced.outcome === "created") {
        result.createdCount += 1;
      } else {
        result.updatedCount += 1;
      }
      result.touchedNotes.push(synced.touched);
    } catch (error) {
      if (
        error instanceof LocalZoteroUnavailableError ||
        (error instanceof LocalZoteroApiError && error.status !== 404)
      ) {
        throw error;
      }

      if (error instanceof LocalZoteroApiError && error.status === 404) {
        result.skippedCount += 1;
      } else {
        result.failedCount += 1;
        pushFailedItemKey(result.failedItemKeys, itemKey);
        console.error(`stratum: bulk retry failed for item ${itemKey}`, error);
      }
    } finally {
      setBulkLibrarySyncPageProgress(plugin, index + 1, failedItemKeys.length);
    }
  }

  return result;
}

async function runEnrichmentPass(
  plugin: StratumPlugin,
  library: EnabledLibrary,
  touchedNotes: TouchedNote[],
  options?: {
    batchItemCount?: number;
    alreadyCompletedInBatch?: number;
  },
): Promise<number> {
  const batchItemCount = options?.batchItemCount ?? touchedNotes.length;
  const alreadyCompletedInBatch = options?.alreadyCompletedInBatch ?? 0;

  if (batchItemCount === 0) {
    return 0;
  }

  plugin.bulkLibrarySyncStage = "enrichment";
  let processedCount = alreadyCompletedInBatch;
  let enrichmentFailureCount = 0;
  setBulkLibrarySyncPageProgress(plugin, processedCount, batchItemCount);
  if (touchedNotes.length === 0) {
    return 0;
  }

  let enrichmentLookup: Record<string, OpenAlexEnrichmentBatchResult> = {};
  try {
    enrichmentLookup = await loadEnrichmentLookup(plugin, touchedNotes);
  } catch (error) {
    console.error("stratum: bulk enrichment batch request failed", error);
    for (const note of touchedNotes) {
      if (getNormalizedDoiLookupKey(note.doi)) {
        enrichmentFailureCount += 1;
      } else {
        log("bulk-sync", "skipping enrichment for item without DOI", {
          library: library.identity,
          itemKey: note.itemKey,
        });
      }
      processedCount += 1;
      setBulkLibrarySyncPageProgress(plugin, processedCount, batchItemCount);
    }
    return enrichmentFailureCount;
  }

  let userId: string;
  try {
    userId = await resolveLocalZoteroUserId(plugin);
  } catch (error) {
    console.error(
      "stratum: bulk enrichment could not resolve local user",
      error,
    );
    for (const note of touchedNotes) {
      if (getNormalizedDoiLookupKey(note.doi)) {
        enrichmentFailureCount += 1;
      }
      processedCount += 1;
      setBulkLibrarySyncPageProgress(plugin, processedCount, batchItemCount);
    }
    return enrichmentFailureCount;
  }

  for (const note of touchedNotes) {
    let enrichmentKey = getNormalizedDoiLookupKey(note.doi);
    try {
      plugin.localZoteroUserId = userId;
      const detail = await loadLocalZoteroItemDetailForPlugin(plugin, {
        library,
        itemKey: note.itemKey,
      });
      enrichmentKey = getNormalizedDoiLookupKey(detail.item.doi);
      if (!enrichmentKey) {
        continue;
      }

      if (
        !Object.prototype.hasOwnProperty.call(enrichmentLookup, enrichmentKey)
      ) {
        enrichmentFailureCount += 1;
        console.error(
          `stratum: bulk enrichment response missing DOI ${enrichmentKey} for item ${note.itemKey}`,
        );
        continue;
      }

      const existingFile =
        note.file ??
        plugin.findExistingLiteratureNoteFile({
          libraryType: detail.library.type,
          libraryId: detail.library.id,
          itemKey: note.itemKey,
        });
      if (!existingFile) {
        enrichmentFailureCount += 1;
        continue;
      }

      const enrichmentResult = enrichmentLookup[enrichmentKey];
      if (enrichmentResult.status === "temporary_failure") {
        enrichmentFailureCount += 1;
        continue;
      }

      await writeLiteratureNoteFromDetail(plugin, {
        detail,
        existingFile,
        enrichmentMode: "provided",
        enrichment: enrichmentResult.enrichment,
      });
    } catch (error) {
      if (enrichmentKey) {
        enrichmentFailureCount += 1;
      }
      console.error(
        `stratum: bulk enrichment failed for item ${note.itemKey}`,
        error,
      );
    } finally {
      processedCount += 1;
      setBulkLibrarySyncPageProgress(plugin, processedCount, batchItemCount);
    }
  }

  return enrichmentFailureCount;
}

export function getBulkLibrarySyncProcessedCount(
  plugin: StratumPlugin,
): number {
  const activeIdentity = plugin.settings.activeBulkSyncLibrary;
  if (!activeIdentity) {
    return 0;
  }

  const activeLibrary =
    plugin.localSyncLibraries.find(
      (library) => library.identity === activeIdentity,
    ) ??
    plugin.settings.enabledLibraries.find(
      (library) => library.identity === activeIdentity,
    ) ??
    null;
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
      if (plugin.isZoteroAutoSyncRunning()) {
        new Notice(
          `${PLUGIN_NAME}: Wait for the current Zotero sync to finish first.`,
        );
        return;
      }

      if (!plugin.backend.hasSession()) {
        new Notice(`${PLUGIN_NAME}: Sign in to Stratum before bulk syncing.`);
        return;
      }

      if (!plugin.zoteroConnection?.connected) {
        new Notice(`${PLUGIN_NAME}: Connect Zotero before bulk syncing.`);
        return;
      }

      const enabledLibrary = plugin.settings.enabledLibraries.find(
        (entry) => entry.identity === library.identity,
      );
      if (!enabledLibrary) {
        new Notice(
          `${PLUGIN_NAME}: Enable ${library.name} in plugin settings before bulk syncing it.`,
        );
        return;
      }

      if (
        !plugin.localSyncLibraries.length &&
        plugin.settings.bulkSyncEnabled
      ) {
        await plugin.localSync.refreshLibraries();
      }

      const userId = await resolveLocalZoteroUserId(plugin);
      if (!userId) {
        new Notice(
          `${PLUGIN_NAME}: Could not resolve your local Zotero account.`,
        );
        return;
      }
      const connectedCloudUserId = getConnectedCloudZoteroUserId(plugin);
      if (connectedCloudUserId && connectedCloudUserId !== userId) {
        new Notice(
          `${PLUGIN_NAME}: Local Zotero is signed into a different account than the Zotero account connected to Stratum.`,
        );
        return;
      }

      const startedAt = new Date().toISOString();
      await plugin.rebuildItemFileMap();

      const scope = buildBulkSyncScope(collection);
      let enrichmentFailureCount = 0;
      plugin.settings.libraryBulkSync[library.identity] =
        buildRunningBulkLibrarySyncState(scope, startedAt);
      plugin.settings.activeBulkSyncLibrary = library.identity;
      await plugin.saveSettings();
      resetBulkLibrarySyncRuntime(plugin);
      queueBulkLibrarySyncUiRefresh(plugin);

      new Notice(
        scope.collectionName
          ? `${PLUGIN_NAME}: syncing all papers from ${scope.collectionName}...`
          : `${PLUGIN_NAME}: syncing all papers in ${library.name}...`,
      );

      while (true) {
        plugin.bulkLibrarySyncStage = "catalog";
        const state = getLibraryBulkSyncState(plugin, library);
        const page = await loadLocalZoteroCatalogPage({
          port: plugin.settings.zoteroLocalApiPort,
          library,
          start: state.nextStart,
          limit: state.pageSize,
          collectionKey: state.collectionKey,
        });
        primeBulkCatalogPage(plugin, library, page);
        const pageResult = await processCatalogPage(plugin, library, page);
        const retryResult = await retryFailedCatalogItems(
          plugin,
          library,
          pageResult.failedItemKeys,
        );
        const batchResult = mergeCatalogResults(pageResult, retryResult);

        log("bulk-sync", "starting enrichment batch", {
          library: library.identity,
          collectionKey: scope.collectionKey,
          touchedNotes: batchResult.touchedNotes.length,
          batchSize: page.items.length,
          pageStart: page.start,
        });
        enrichmentFailureCount += await runEnrichmentPass(
          plugin,
          library,
          batchResult.touchedNotes,
          {
            batchItemCount: page.items.length,
            alreadyCompletedInBatch:
              batchResult.skippedCount + batchResult.failedCount,
          },
        );

        commitBulkCatalogPage(plugin, library, page, batchResult);
        resetBulkLibrarySyncRuntime(plugin);
        await plugin.saveSettings();
        queueBulkLibrarySyncUiRefresh(plugin);

        if (!page.hasMore || page.nextStart === null) {
          break;
        }
      }

      const completedState = getLibraryBulkSyncState(plugin, library);
      completedState.phase = "completed";
      completedState.completedAt = new Date().toISOString();
      completedState.enrichmentFailureCount = enrichmentFailureCount;
      completedState.lastError = null;
      completedState.retryAfterSeconds = null;
      await seedCloudAutoSyncBaselineAfterBulkSync(
        plugin,
        enabledLibrary,
        scope.collectionKey,
      );
      await plugin.saveSettings();
      new Notice(
        formatBulkLibrarySyncCompletionMessage({
          state: completedState,
          libraryName: library.name,
          collectionName: completedState.collectionName,
        }),
      );
    } catch (error) {
      const state = getLibraryBulkSyncState(plugin, library);
      state.phase = "paused-error";
      state.lastError =
        error instanceof Error ? error.message : "Bulk Zotero sync failed.";
      state.retryAfterSeconds = null;
      await plugin.saveSettings();
      console.error("stratum: bulk Zotero sync failed", error);
      new Notice(`${PLUGIN_NAME}: ${state.lastError}`);
    } finally {
      resetBulkLibrarySyncRuntime(plugin);
      plugin.settings.activeBulkSyncLibrary = null;
      await plugin.saveSettings();
      plugin.bulkLibrarySyncRunPromise = null;
      plugin.notifyLocalLiveSyncAfterBulkSync();
      plugin.refreshViews();
      plugin.refreshSettingTab();
      plugin.refreshAutoSyncUi();
    }
  })();

  plugin.bulkLibrarySyncRunPromise = runPromise;
  await runPromise;
}
