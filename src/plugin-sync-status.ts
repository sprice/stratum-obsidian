import { getSyncStatusLabel } from "./zotero-sync";
import {
  getActiveBulkSyncLibrary,
  getLibraryAutoSyncState,
} from "./plugin-libraries";
import type StratumPlugin from "./plugin";

const AUTO_SYNC_STATUS_REFRESH_MS = 60_000;

export function getAutoSyncStatusLabel(plugin: StratumPlugin): string {
  const latestSuccessfulSyncAt =
    plugin.settings.enabledLibraries
      .map(
        (library) =>
          getLibraryAutoSyncState(plugin, library).lastSuccessfulSyncAt,
      )
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  const firstError =
    plugin.settings.enabledLibraries
      .map((library) => getLibraryAutoSyncState(plugin, library).lastError)
      .find((value): value is string => Boolean(value)) ?? null;

  return getSyncStatusLabel({
    isSyncing: plugin.isAutoSyncRunning,
    isBulkSyncing: plugin.isBulkLibrarySyncRunning(),
    autoSyncEnabled: plugin.settings.autoSyncEnabled,
    state: {
      libraryVersion: null,
      lastSuccessfulSyncAt: latestSuccessfulSyncAt,
      lastError: firstError,
      initialRefreshCompleted: plugin.settings.enabledLibraries.every(
        (library) =>
          getLibraryAutoSyncState(plugin, library).initialRefreshCompleted,
      ),
    },
  });
}

export function refreshAutoSyncUi(plugin: StratumPlugin): void {
  if (plugin.statusBarItemEl) {
    const activeBulkSyncLibrary = getActiveBulkSyncLibrary(plugin);
    const firstError =
      plugin.settings.enabledLibraries
        .map((library) => getLibraryAutoSyncState(plugin, library).lastError)
        .find((value): value is string => Boolean(value)) ?? null;
    plugin.statusBarItemEl.setText(getAutoSyncStatusLabel(plugin));
    plugin.statusBarItemEl.setAttribute(
      "aria-label",
      plugin.isBulkLibrarySyncRunning()
        ? activeBulkSyncLibrary
          ? `Zotero bulk sync is running in ${activeBulkSyncLibrary.name}`
          : "Zotero bulk sync is running"
        : firstError
          ? `Zotero sync status: ${firstError}`
          : getAutoSyncStatusLabel(plugin),
    );
    plugin.statusBarItemEl.title = plugin.isBulkLibrarySyncRunning()
      ? activeBulkSyncLibrary
        ? `Bulk Zotero sync is running in ${activeBulkSyncLibrary.name}`
        : "Bulk Zotero sync is running"
      : firstError
        ? firstError
        : "Click to sync Zotero changes now";
  }
}

export function clearAutoSyncInterval(plugin: StratumPlugin): void {
  if (plugin.autoSyncIntervalTimer === null) {
    return;
  }

  window.clearInterval(plugin.autoSyncIntervalTimer);
  plugin.autoSyncIntervalTimer = null;
}

export function configureAutoSyncInterval(plugin: StratumPlugin): void {
  clearAutoSyncInterval(plugin);
  if (!plugin.settings.autoSyncEnabled) {
    refreshAutoSyncUi(plugin);
    return;
  }

  const intervalMs =
    Math.max(1, plugin.settings.autoSyncIntervalMinutes) * 60_000;
  const timer = window.setInterval(() => {
    void plugin.runZoteroAutoSync("interval");
  }, intervalMs);
  plugin.autoSyncIntervalTimer = timer;
  plugin.registerInterval(timer);
  refreshAutoSyncUi(plugin);
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
