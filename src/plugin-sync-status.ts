import { getSyncStatusLabel } from "./zotero-sync";
import {
  getActiveBulkSyncLibrary,
  getLibraryBulkSyncState,
} from "./plugin-libraries";
import type StratumPlugin from "./plugin";

const AUTO_SYNC_STATUS_REFRESH_MS = 60_000;

function getRunningBulkSyncLabel(plugin: StratumPlugin): string | null {
  const activeBulkSyncLibrary = getActiveBulkSyncLibrary(plugin);
  if (!activeBulkSyncLibrary) {
    return null;
  }

  const state = getLibraryBulkSyncState(plugin, activeBulkSyncLibrary);
  const processedCount = plugin.getBulkLibrarySyncProcessedCount();
  const totalResults = state.totalResults;
  const stageVerb =
    plugin.bulkLibrarySyncStage === "enrichment" ? "enriching" : "syncing";

  if (totalResults && totalResults > 0) {
    return `Zotero: ${stageVerb} ${Math.min(processedCount, totalResults)}/${totalResults}`;
  }

  return `Zotero: ${stageVerb}...`;
}

export function getAutoSyncStatusLabel(plugin: StratumPlugin): string {
  const runningBulkSyncLabel = getRunningBulkSyncLabel(plugin);
  if (runningBulkSyncLabel) {
    return runningBulkSyncLabel;
  }

  const states = Object.values(plugin.settings.libraryAutoSync);
  const latestSuccessfulSyncAt =
    states
      .map((state) => state.lastSuccessfulSyncAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  const firstError =
    states
      .map((state) => state.lastError)
      .find((value): value is string => Boolean(value)) ?? null;

  return getSyncStatusLabel({
    isSyncing: plugin.isZoteroAutoSyncRunning(),
    isBulkSyncing: plugin.isBulkLibrarySyncRunning(),
    state: {
      libraryVersion: null,
      lastSuccessfulSyncAt: latestSuccessfulSyncAt,
      lastError: firstError,
      initialRefreshCompleted: states.every(
        (state) => state.initialRefreshCompleted,
      ),
    },
  });
}

export function refreshAutoSyncUi(plugin: StratumPlugin): void {
  if (!plugin.statusBarItemEl) {
    return;
  }

  const activeBulkSyncLibrary = getActiveBulkSyncLibrary(plugin);
  const activeBulkSyncState = activeBulkSyncLibrary
    ? getLibraryBulkSyncState(plugin, activeBulkSyncLibrary)
    : null;
  const activeBulkSyncCollection = activeBulkSyncState?.collectionName ?? null;
  const firstError =
    Object.values(plugin.settings.libraryAutoSync)
      .map((state) => state.lastError)
      .find((value): value is string => Boolean(value)) ?? null;
  const runningBulkSyncLabel = getRunningBulkSyncLabel(plugin);
  const bulkProcessedCount = plugin.getBulkLibrarySyncProcessedCount();
  const bulkTotalResults = activeBulkSyncState?.totalResults ?? null;
  const bulkStageVerb =
    plugin.bulkLibrarySyncStage === "enrichment" ? "Enriching" : "Syncing";

  plugin.statusBarItemEl.setText(getAutoSyncStatusLabel(plugin));
  plugin.statusBarItemEl.setAttribute(
    "aria-label",
    plugin.isBulkLibrarySyncRunning()
      ? bulkTotalResults && bulkTotalResults > 0
        ? activeBulkSyncCollection
          ? `${bulkStageVerb} ${Math.min(bulkProcessedCount, bulkTotalResults)} of ${bulkTotalResults} papers from ${activeBulkSyncCollection}`
          : activeBulkSyncLibrary
            ? `${bulkStageVerb} ${Math.min(bulkProcessedCount, bulkTotalResults)} of ${bulkTotalResults} papers in ${activeBulkSyncLibrary.name}`
            : `${bulkStageVerb} ${Math.min(bulkProcessedCount, bulkTotalResults)} of ${bulkTotalResults} Zotero papers`
        : activeBulkSyncCollection
          ? `${bulkStageVerb} papers from ${activeBulkSyncCollection}`
          : activeBulkSyncLibrary
            ? `${bulkStageVerb} papers in ${activeBulkSyncLibrary.name}`
            : "Zotero bulk sync is running"
      : firstError
        ? `Zotero sync status: ${firstError}`
        : getAutoSyncStatusLabel(plugin),
  );
  plugin.statusBarItemEl.title = plugin.isBulkLibrarySyncRunning()
    ? activeBulkSyncCollection
      ? bulkTotalResults && bulkTotalResults > 0
        ? `${bulkStageVerb} ${Math.min(bulkProcessedCount, bulkTotalResults)} of ${bulkTotalResults} papers from ${activeBulkSyncCollection}`
        : `${bulkStageVerb} papers from ${activeBulkSyncCollection}`
      : activeBulkSyncLibrary
        ? bulkTotalResults && bulkTotalResults > 0
          ? `${bulkStageVerb} ${Math.min(bulkProcessedCount, bulkTotalResults)} of ${bulkTotalResults} papers in ${activeBulkSyncLibrary.name}`
          : `${bulkStageVerb} papers in ${activeBulkSyncLibrary.name}`
        : (runningBulkSyncLabel ?? "Bulk Zotero sync is running")
    : firstError
      ? firstError
      : "Zotero sync status";
}

export function startAutoSyncStatusRefresh(plugin: StratumPlugin): void {
  stopAutoSyncStatusRefresh(plugin);
  const timer = window.setInterval(() => {
    refreshAutoSyncUi(plugin);
  }, AUTO_SYNC_STATUS_REFRESH_MS);
  plugin.autoSyncStatusTimer = timer;
  plugin.registerInterval(timer);
}

export function stopAutoSyncStatusRefresh(plugin: StratumPlugin): void {
  if (plugin.autoSyncStatusTimer === null) {
    return;
  }

  window.clearInterval(plugin.autoSyncStatusTimer);
  plugin.autoSyncStatusTimer = null;
}
