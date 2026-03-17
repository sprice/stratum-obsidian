import { getSyncStatusLabel } from "./zotero-sync";
import type StratumPlugin from "./plugin";

const AUTO_SYNC_STATUS_REFRESH_MS = 60_000;

export function getAutoSyncStatusLabel(plugin: StratumPlugin): string {
  return getSyncStatusLabel({
    isSyncing: plugin.isAutoSyncRunning,
    autoSyncEnabled: plugin.settings.autoSyncEnabled,
    state: plugin.settings.zoteroAutoSync,
  });
}

export function refreshAutoSyncUi(plugin: StratumPlugin): void {
  if (plugin.statusBarItemEl) {
    plugin.statusBarItemEl.setText(getAutoSyncStatusLabel(plugin));
    plugin.statusBarItemEl.setAttribute(
      "aria-label",
      plugin.settings.zoteroAutoSync.lastError
        ? `Zotero sync status: ${plugin.settings.zoteroAutoSync.lastError}`
        : getAutoSyncStatusLabel(plugin)
    );
    plugin.statusBarItemEl.title = plugin.settings.zoteroAutoSync.lastError
      ? plugin.settings.zoteroAutoSync.lastError
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

  const intervalMs = Math.max(1, plugin.settings.autoSyncIntervalMinutes) * 60_000;
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
