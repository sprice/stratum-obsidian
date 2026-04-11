import { Platform, TFile } from "obsidian";
import { getTrackedChildItemKeysFromFrontmatter } from "./literature-note-frontmatter";
import { log } from "./log";
import {
  getTrackedLibraryRefreshCandidates,
  shouldTriggerLocalLiveSyncFromWatchEvent,
  type TrackedRefreshCandidate,
} from "./plugin-local-live-sync-utils";
import { refreshOpenedLiteratureNote } from "./plugin-note-refresh";
import type StratumPlugin from "./plugin";
import {
  getDefaultZoteroDataDir as getSharedDefaultZoteroDataDir,
  getRuntimePlatform,
  resolveHomeDir,
} from "./zotero-data-dir";
import {
  loadLocalZoteroItemVersions,
} from "./zotero-local";

const LOCAL_ZOTERO_DB_FILE_NAME = "zotero.sqlite";
const LOCAL_LIVE_SYNC_DEBOUNCE_MS = 1500;
type RuntimePlatform = string;

type LiveSyncLibrary = {
  type: "user" | "group";
  id: string;
  identity: string;
  name: string;
};

type PathModuleLike = {
  normalize(target: string): string;
  join(...parts: string[]): string;
  posix: {
    normalize(target: string): string;
    join(...parts: string[]): string;
  };
  win32: {
    normalize(target: string): string;
    join(...parts: string[]): string;
  };
};

type FsWatcherLike = {
  close(): void;
  on(event: "error", listener: (error: unknown) => void): unknown;
};

type FsModuleLike = {
  existsSync(target: string): boolean;
  statSync(target: string): {
    isDirectory(): boolean;
  };
  watch(
    target: string,
    options: {
      persistent: boolean;
    },
    listener: (
      eventType: string,
      filename?: string | Uint8Array | null,
    ) => void,
  ): FsWatcherLike;
};

function getNodeRequire(): ((moduleName: string) => unknown) | null {
  const maybeRequire = (
    window as Window & {
      require?: (moduleName: string) => unknown;
    }
  ).require;
  return typeof maybeRequire === "function" ? maybeRequire : null;
}

function getPathModule(platform: RuntimePlatform): PathModuleLike | null {
  const nodeRequire = getNodeRequire();
  if (!nodeRequire) {
    return null;
  }

  const module = nodeRequire("node:path");
  if (
    module &&
    typeof module === "object" &&
    "posix" in module &&
    "win32" in module &&
    "normalize" in module &&
    "join" in module
  ) {
    const pathModule = module as PathModuleLike;
    return platform === "win32"
      ? { ...pathModule, ...pathModule.win32 }
      : pathModule;
  }

  return null;
}

function getFsModule(): FsModuleLike | null {
  const nodeRequire = getNodeRequire();
  if (!nodeRequire) {
    return null;
  }

  const module = nodeRequire("node:fs");
  if (
    module &&
    typeof module === "object" &&
    "existsSync" in module &&
    "statSync" in module &&
    "watch" in module
  ) {
    return module as FsModuleLike;
  }

  return null;
}

export function getDefaultZoteroDataDir(options?: {
  platform?: RuntimePlatform;
  homeDir?: string;
}): string {
  return getSharedDefaultZoteroDataDir(options);
}

export function normalizeZoteroDataDir(
  value: string,
  options?: {
    platform?: RuntimePlatform;
    homeDir?: string;
  },
): string {
  const platform = options?.platform ?? getRuntimePlatform();
  const homeDir = options?.homeDir ?? resolveHomeDir();
  const pathModule = getPathModule(platform);
  if (!pathModule) {
    return value.trim() || getDefaultZoteroDataDir(options);
  }
  const trimmed = value.trim();
  const fallback = getDefaultZoteroDataDir({
    platform,
    homeDir,
  });
  const raw = trimmed || fallback;
  let expanded = raw;

  if (raw === "~") {
    expanded = homeDir;
  } else if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    expanded = pathModule.join(homeDir, raw.slice(2));
  }

  return pathModule.normalize(expanded);
}

export function validateZoteroDataDir(
  value: string,
  options?: {
    platform?: RuntimePlatform;
    homeDir?: string;
  },
): {
  resolvedPath: string;
  error: string | null;
} {
  const platform = options?.platform ?? getRuntimePlatform();
  const resolvedPath = normalizeZoteroDataDir(value, options);
  const pathModule = getPathModule(platform);
  const fsModule = getFsModule();
  if (!pathModule || !fsModule) {
    return {
      resolvedPath,
      error:
        "Desktop filesystem access is not available in this Obsidian environment.",
    };
  }

  try {
    const stat = fsModule.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      return {
        resolvedPath,
        error: `Zotero data directory is not a folder: ${resolvedPath}`,
      };
    }
  } catch {
    return {
      resolvedPath,
      error: `Zotero data directory not found: ${resolvedPath}`,
    };
  }

  const dbPath = pathModule.join(resolvedPath, LOCAL_ZOTERO_DB_FILE_NAME);
  if (!fsModule.existsSync(dbPath)) {
    return {
      resolvedPath,
      error: `Could not find ${LOCAL_ZOTERO_DB_FILE_NAME} in ${resolvedPath}.`,
    };
  }

  return {
    resolvedPath,
    error: null,
  };
}

function shouldRunLocalLiveSync(plugin: StratumPlugin): boolean {
  return (
    Platform.isDesktopApp &&
    plugin.settings.bulkSyncEnabled &&
    plugin.backend.hasSession() &&
    Boolean(plugin.zoteroConnection?.connected) &&
    plugin.localSyncLibraries.length > 0
  );
}

function clearDebounceTimer(plugin: StratumPlugin): void {
  if (plugin.localLiveSyncDebounceTimer === null) {
    return;
  }

  window.clearTimeout(plugin.localLiveSyncDebounceTimer);
  plugin.localLiveSyncDebounceTimer = null;
}

function clearLiveSyncBaselines(
  plugin: StratumPlugin,
  libraries?: LiveSyncLibrary[],
): void {
  if (!libraries) {
    plugin.localLiveSyncLibraryVersions.clear();
    plugin.localLiveSyncLibraryItemVersions.clear();
    return;
  }

  const activeIdentities = new Set(
    libraries.map((library) => library.identity),
  );
  for (const identity of plugin.localLiveSyncLibraryVersions.keys()) {
    if (!activeIdentities.has(identity)) {
      plugin.localLiveSyncLibraryVersions.delete(identity);
      plugin.localLiveSyncLibraryItemVersions.delete(identity);
    }
  }
}

function closeLiveSyncWatcher(plugin: StratumPlugin): void {
  plugin.localLiveSyncWatcher?.close();
  plugin.localLiveSyncWatcher = null;
  plugin.localLiveSyncWatchDir = null;
  plugin.localLiveSyncWatching = false;
}

export function stopLocalLiveSync(
  plugin: StratumPlugin,
  options?: { clearError?: boolean },
): void {
  clearDebounceTimer(plugin);
  closeLiveSyncWatcher(plugin);
  plugin.localLiveSyncDirty = false;
  plugin.localLiveSyncQueuedAfterBulkSync = false;
  clearLiveSyncBaselines(plugin);
  if (options?.clearError !== false) {
    plugin.localLiveSyncError = null;
  }
}

function queueImmediateFlush(plugin: StratumPlugin): void {
  clearDebounceTimer(plugin);
  plugin.localLiveSyncDebounceTimer = window.setTimeout(() => {
    plugin.localLiveSyncDebounceTimer = null;
    void flushLocalLiveSync(plugin);
  }, 0);
}

function scheduleLocalLiveSyncFlush(plugin: StratumPlugin): void {
  plugin.localLiveSyncDirty = true;
  clearDebounceTimer(plugin);
  plugin.localLiveSyncDebounceTimer = window.setTimeout(() => {
    plugin.localLiveSyncDebounceTimer = null;
    void flushLocalLiveSync(plugin);
  }, LOCAL_LIVE_SYNC_DEBOUNCE_MS);
}

async function seedMissingLibraryBaselines(
  plugin: StratumPlugin,
  libraries: LiveSyncLibrary[],
): Promise<void> {
  clearLiveSyncBaselines(plugin, libraries);

  for (const library of libraries) {
    if (
      plugin.localLiveSyncLibraryVersions.has(library.identity) &&
      plugin.localLiveSyncLibraryItemVersions.has(library.identity)
    ) {
      continue;
    }

    try {
      const versionsResponse = await loadLocalZoteroItemVersions({
        port: plugin.settings.zoteroLocalApiPort,
        library,
        topLevelOnly: false,
      });
      plugin.localLiveSyncLibraryVersions.set(
        library.identity,
        versionsResponse.libraryVersion,
      );
      plugin.localLiveSyncLibraryItemVersions.set(
        library.identity,
        versionsResponse.itemVersions,
      );
    } catch (error) {
      console.error(
        `stratum: failed to seed local live-sync baseline for ${library.identity}`,
        error,
      );
    }
  }
}

function resolveTrackedRefreshFile(
  plugin: StratumPlugin,
  library: LiveSyncLibrary,
  candidate: TrackedRefreshCandidate,
): TFile | null {
  const cached = plugin.app.vault.getAbstractFileByPath(candidate.filePath);
  if (cached instanceof TFile) {
    return cached;
  }

  return plugin.findExistingLiteratureNoteFile({
    libraryType: library.type,
    libraryId: library.id,
    itemKey: candidate.itemKey,
  });
}

function getTrackedChildKeysByIdentity(
  plugin: StratumPlugin,
  library: LiveSyncLibrary,
): Record<string, string[]> {
  const prefix = `${library.type}/${library.id}/`;
  const trackedChildKeysByIdentity: Record<string, string[]> = {};

  for (const [identity, entry] of Object.entries(plugin.settings.itemFileMap)) {
    if (!identity.startsWith(prefix)) {
      continue;
    }

    const cachedFile = plugin.app.vault.getAbstractFileByPath(entry.filePath);
    const file =
      cachedFile instanceof TFile
        ? cachedFile
        : plugin.findExistingLiteratureNoteFile({
            libraryType: library.type,
            libraryId: library.id,
            itemKey: entry.zoteroItemKey,
          });
    if (!(file instanceof TFile)) {
      continue;
    }

    const frontmatter =
      (plugin.app.metadataCache.getFileCache(file)?.frontmatter as
        | Record<string, unknown>
        | undefined) ?? null;
    trackedChildKeysByIdentity[identity] =
      getTrackedChildItemKeysFromFrontmatter(frontmatter);
  }

  return trackedChildKeysByIdentity;
}

async function runLocalLiveSyncFlush(plugin: StratumPlugin): Promise<void> {
  if (!shouldRunLocalLiveSync(plugin)) {
    return;
  }

  if (plugin.isBulkLibrarySyncRunning()) {
    plugin.localLiveSyncQueuedAfterBulkSync = true;
    return;
  }

  plugin.localLiveSyncQueuedAfterBulkSync = false;
  plugin.localLiveSyncDirty = false;
  const libraries = [...plugin.localSyncLibraries];
  await seedMissingLibraryBaselines(plugin, libraries);

  for (const library of libraries) {
    if (!shouldRunLocalLiveSync(plugin)) {
      return;
    }

    if (plugin.isBulkLibrarySyncRunning()) {
      plugin.localLiveSyncQueuedAfterBulkSync = true;
      return;
    }

    try {
      // A Zotero watch event only tells us "something changed". Repeated edits to
      // the same child item can be missed if we trust a cheap library-level
      // version shortcut here, so always diff the full item-version snapshot.
      const versionsResponse = await loadLocalZoteroItemVersions({
        port: plugin.settings.zoteroLocalApiPort,
        library,
        topLevelOnly: false,
      });
      const previousItemVersions =
        plugin.localLiveSyncLibraryItemVersions.get(library.identity) ?? {};
      const candidates = getTrackedLibraryRefreshCandidates({
        itemFileMap: plugin.settings.itemFileMap,
        library,
        previousItemVersions,
        currentItemVersions: versionsResponse.itemVersions,
        trackedChildKeysByIdentity: getTrackedChildKeysByIdentity(
          plugin,
          library,
        ),
      });

      log("live-sync", "refreshing changed literature notes", {
        library: library.identity,
        changedNotes: candidates.length,
      });

      for (const candidate of candidates) {
        if (!shouldRunLocalLiveSync(plugin)) {
          return;
        }

        if (plugin.isBulkLibrarySyncRunning()) {
          plugin.localLiveSyncQueuedAfterBulkSync = true;
          return;
        }

        const file = resolveTrackedRefreshFile(plugin, library, candidate);
        if (!file) {
          continue;
        }

        const refresh = refreshOpenedLiteratureNote(plugin, file);
        if (!refresh) {
          if (plugin.isBulkLibrarySyncRunning()) {
            plugin.localLiveSyncQueuedAfterBulkSync = true;
            return;
          }
          continue;
        }

        await refresh;
      }

      plugin.localLiveSyncLibraryVersions.set(
        library.identity,
        versionsResponse.libraryVersion,
      );
      plugin.localLiveSyncLibraryItemVersions.set(
        library.identity,
        versionsResponse.itemVersions,
      );
    } catch (error) {
      console.error(
        `stratum: local live sync failed for ${library.identity}`,
        error,
      );
    }
  }
}

async function flushLocalLiveSync(plugin: StratumPlugin): Promise<void> {
  if (plugin.localLiveSyncRunPromise) {
    return plugin.localLiveSyncRunPromise;
  }

  const runPromise = runLocalLiveSyncFlush(plugin).finally(() => {
    plugin.localLiveSyncRunPromise = null;
    if (
      (plugin.localLiveSyncDirty || plugin.localLiveSyncQueuedAfterBulkSync) &&
      shouldRunLocalLiveSync(plugin) &&
      !plugin.isBulkLibrarySyncRunning()
    ) {
      queueImmediateFlush(plugin);
    }
  });
  plugin.localLiveSyncRunPromise = runPromise;
  return runPromise;
}

export function notifyLocalLiveSyncAfterBulkSync(plugin: StratumPlugin): void {
  if (!plugin.localLiveSyncQueuedAfterBulkSync) {
    return;
  }

  plugin.localLiveSyncQueuedAfterBulkSync = false;
  if (!shouldRunLocalLiveSync(plugin)) {
    return;
  }

  queueImmediateFlush(plugin);
}

export async function reconcileLocalLiveSync(
  plugin: StratumPlugin,
): Promise<void> {
  if (!Platform.isDesktopApp || !plugin.settings.bulkSyncEnabled) {
    stopLocalLiveSync(plugin);
    plugin.refreshSettingTab();
    return;
  }

  const validation = validateZoteroDataDir(plugin.settings.zoteroDataDir);
  if (validation.error) {
    stopLocalLiveSync(plugin, {
      clearError: false,
    });
    plugin.localLiveSyncError = validation.error;
    plugin.refreshSettingTab();
    return;
  }

  if (!shouldRunLocalLiveSync(plugin)) {
    stopLocalLiveSync(plugin);
    plugin.refreshSettingTab();
    return;
  }

  plugin.localLiveSyncError = null;

  if (
    !plugin.localLiveSyncWatcher ||
    plugin.localLiveSyncWatchDir !== validation.resolvedPath
  ) {
    const fsModule = getFsModule();
    if (!fsModule) {
      stopLocalLiveSync(plugin, {
        clearError: false,
      });
      plugin.localLiveSyncError =
        "Desktop filesystem access is not available in this Obsidian environment.";
      plugin.refreshSettingTab();
      return;
    }

    stopLocalLiveSync(plugin);
    plugin.localLiveSyncError = null;
    try {
      plugin.localLiveSyncWatchDir = validation.resolvedPath;
      plugin.localLiveSyncWatcher = fsModule.watch(
        validation.resolvedPath,
        {
          persistent: false,
        },
        (_eventType, filename) => {
          if (!shouldTriggerLocalLiveSyncFromWatchEvent(filename)) {
            return;
          }

          log("live-sync", "detected local Zotero database change", {
            file:
              typeof filename === "string"
                ? filename
                : filename
                  ? new TextDecoder().decode(filename)
                  : "",
          });
          scheduleLocalLiveSyncFlush(plugin);
        },
      );
      plugin.localLiveSyncWatcher.on("error", (error) => {
        console.error("stratum: local live-sync watcher failed", error);
        stopLocalLiveSync(plugin, {
          clearError: false,
        });
        plugin.localLiveSyncError =
          error instanceof Error
            ? error.message
            : "Could not watch the Zotero data directory.";
        plugin.refreshSettingTab();
      });
      plugin.localLiveSyncWatching = true;
      log("live-sync", "watching Zotero data directory", {
        dir: validation.resolvedPath,
      });
    } catch (error) {
      stopLocalLiveSync(plugin, {
        clearError: false,
      });
      plugin.localLiveSyncError =
        error instanceof Error
          ? error.message
          : "Could not watch the Zotero data directory.";
      plugin.refreshSettingTab();
      return;
    }
  } else {
    plugin.localLiveSyncWatching = true;
  }

  await seedMissingLibraryBaselines(plugin, plugin.localSyncLibraries);
  plugin.refreshSettingTab();
}
