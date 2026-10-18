import { Platform, TFile } from "obsidian";
import { getLibraryAutoSyncState } from "./plugin-libraries";
import { refreshOpenedLiteratureNote } from "./plugin-note-refresh";
import type StratumPlugin from "./plugin";
import { refreshLocalSyncLibraries } from "./plugin-local-sync";
import {
  loadLocalZoteroHeartbeat,
  LocalZoteroApiError,
  LocalZoteroUnavailableError,
} from "./zotero-local";

const POLL_MS = 30_000;
const RETRY_MS = 60_000;

function enabled(plugin: StratumPlugin): boolean {
  return (
    !plugin.isUnloaded &&
    Platform.isDesktopApp &&
    plugin.settings.bulkSyncEnabled &&
    plugin.backend.hasSession() &&
    Boolean(plugin.zoteroConnection?.connected)
  );
}

function schedule(plugin: StratumPlugin, delay: number): void {
  if (plugin.localLiveSyncDebounceTimer !== null) {
    window.clearTimeout(plugin.localLiveSyncDebounceTimer);
  }
  plugin.localLiveSyncDebounceTimer = null;
  if (!enabled(plugin)) return;
  plugin.localLiveSyncDebounceTimer = window.setTimeout(() => {
    plugin.localLiveSyncDebounceTimer = null;
    void poll(plugin);
  }, delay);
}

function setStatus(plugin: StratumPlugin, message: string | null): void {
  if (plugin.localLiveSyncError === message) return;
  plugin.localLiveSyncError = message;
  plugin.refreshViews();
}

async function runPoll(plugin: StratumPlugin): Promise<void> {
  if (!enabled(plugin) || plugin.isBulkLibrarySyncRunning()) return;
  const port = plugin.settings.zoteroLocalApiPort;
  const accountId = plugin.settings.accountId;
  const current = () =>
    enabled(plugin) &&
    plugin.settings.accountId === accountId &&
    plugin.settings.zoteroLocalApiPort === port &&
    !plugin.isBulkLibrarySyncRunning();
  if (!current()) return;
  if (!plugin.localSyncLibraries.length) {
    await refreshLocalSyncLibraries(plugin);
    if (!plugin.localSyncLibraries.length) {
      throw new Error(
        plugin.localSyncLibrariesError ??
          "No local Zotero libraries available.",
      );
    }
  }
  for (const library of [...plugin.localSyncLibraries]) {
    const libraryCurrent = () =>
      current() &&
      plugin.localSyncLibraries.some(
        (entry) => entry.type === library.type && entry.id === library.id,
      );
    const heartbeat = await loadLocalZoteroHeartbeat({ port, library }).catch(
      async (error: unknown) => {
        // A removed group or a switched local account invalidates discovery.
        // Refresh it on a missing library, without adding work to idle polls.
        if (
          error instanceof LocalZoteroApiError &&
          error.status === 404 &&
          current()
        ) {
          await refreshLocalSyncLibraries(plugin);
        }
        throw error;
      },
    );
    if (!libraryCurrent()) return;
    const checkpoint = plugin.settings.localZoteroHeartbeats[library.identity];
    const sameSource =
      checkpoint &&
      checkpoint.accountId === (accountId ?? null) &&
      checkpoint.port === port &&
      checkpoint.serverId === heartbeat.serverId &&
      checkpoint.libraryVersion <= heartbeat.libraryVersion;
    if (sameSource && checkpoint.libraryVersion === heartbeat.libraryVersion)
      continue;

    // First contact (or a different Zotero database) establishes a baseline.
    // Only a reported library change starts note work, never plugin startup.
    if (sameSource) {
      let complete = true;
      const prefix = `${library.type}/${library.id}/`;
      for (const [identity, entry] of Object.entries(
        plugin.settings.itemFileMap,
      )) {
        if (!identity.startsWith(prefix)) continue;
        if (!libraryCurrent()) return;
        const file =
          plugin.app.vault.getAbstractFileByPath(entry.filePath) ??
          plugin.findExistingLiteratureNoteFile({
            libraryType: library.type,
            libraryId: library.id,
            itemKey: entry.zoteroItemKey,
          });
        if (!(file instanceof TFile)) continue;
        const refresh = refreshOpenedLiteratureNote(plugin, file, {
          background: true,
          sourceMissing: true,
          canRefresh: libraryCurrent,
        });
        if (!refresh) {
          // Metadata may still be loading for this note. Keep its checkpoint
          // pending, but let other notes and libraries receive their changes.
          complete = false;
          continue;
        }
        if (!plugin.localLiveSyncApplyingChanges) {
          plugin.localLiveSyncApplyingChanges = true;
          plugin.refreshAutoSyncUi();
        }
        await refresh;
        if (!libraryCurrent()) return;
        if (getLibraryAutoSyncState(plugin, library).lastError) {
          throw new Error(
            "Automatic refresh paused; unfinished notes will be retried.",
          );
        }
      }
      if (!complete) continue;
    }
    if (!libraryCurrent()) return;
    // Reconcile the changed library, including hard-deleted child items for
    // which the local API has no deletion feed. Never advance after failure.
    plugin.settings.localZoteroHeartbeats[library.identity] = {
      accountId: accountId ?? null,
      port,
      ...heartbeat,
    };
    try {
      await plugin.saveSettings();
    } catch (error) {
      if (checkpoint)
        plugin.settings.localZoteroHeartbeats[library.identity] = checkpoint;
      else delete plugin.settings.localZoteroHeartbeats[library.identity];
      throw error;
    }
  }
  setStatus(plugin, null);
}

function poll(plugin: StratumPlugin): Promise<void> {
  if (plugin.localLiveSyncRunPromise) return plugin.localLiveSyncRunPromise;
  let delay = POLL_MS;
  const pending = runPoll(plugin)
    .catch((error: unknown) => {
      delay = RETRY_MS;
      if (!enabled(plugin)) return;
      const message =
        error instanceof LocalZoteroUnavailableError
          ? "Zotero unavailable. Saved notes remain available."
          : error instanceof LocalZoteroApiError && error.status === 403
            ? "Enable Zotero’s local API in Settings → Advanced to resume automatic refresh."
            : error instanceof Error
              ? error.message
              : "Automatic refresh paused. Will retry.";
      setStatus(plugin, message);
    })
    .finally(() => {
      plugin.localLiveSyncRunPromise = null;
      if (plugin.localLiveSyncApplyingChanges) {
        plugin.localLiveSyncApplyingChanges = false;
        plugin.refreshAutoSyncUi();
        plugin.refreshViews();
      }
      schedule(plugin, delay);
    });
  plugin.localLiveSyncRunPromise = pending;
  return pending;
}

export function notifyLocalLiveSyncAfterBulkSync(plugin: StratumPlugin): void {
  schedule(plugin, 0);
}

export function reconcileLocalLiveSync(plugin: StratumPlugin): void {
  if (!enabled(plugin)) {
    schedule(plugin, 0);
    setStatus(plugin, null);
    return;
  }
  if (!plugin.localLiveSyncFocusRegistered) {
    plugin.localLiveSyncFocusRegistered = true;
    plugin.registerDomEvent(window, "focus", () => schedule(plugin, 0));
  }
  if (!plugin.localLiveSyncRunPromise) schedule(plugin, 0);
}
