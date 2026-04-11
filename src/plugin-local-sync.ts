import { Platform } from "obsidian";
import type { ZoteroCollectionSummary } from "./backend-types";
import {
  buildLibraryIdentity,
  reconcileEnabledLocalSyncLibraries,
  sortEnabledLibraries,
} from "./plugin-libraries";
import type StratumPlugin from "./plugin";
import type { EnabledLibrary } from "./settings";
import {
  loadLocalZoteroCollections,
  loadLocalZoteroLibraries,
} from "./zotero-local";

function resolveSelectedSyncLibrary(
  plugin: StratumPlugin,
  identity: string | null,
): EnabledLibrary | null {
  if (identity) {
    const selected =
      plugin.localSyncLibraries.find(
        (library) => library.identity === identity,
      ) ?? null;
    if (selected) {
      return selected;
    }
  }

  return plugin.localSyncLibraries[0] ?? null;
}

function getConnectedCloudZoteroUserId(plugin: StratumPlugin): string | null {
  return (
    plugin.zoteroConnection?.zoteroUserId ??
    plugin.settings.lastKnownZoteroUserId
  );
}

function buildLocalZoteroAccountMismatchMessage(plugin: StratumPlugin): string {
  const username =
    plugin.zoteroConnection?.zoteroUsername ??
    plugin.settings.lastKnownZoteroUsername;
  return username
    ? `Local Zotero is signed into a different account than the Zotero account connected to Stratum (${username}). Open the matching Zotero library on this computer, then try again.`
    : "Local Zotero is signed into a different account than the Zotero account connected to Stratum. Open the matching Zotero library on this computer, then try again.";
}

function clearPendingSyncCollections(plugin: StratumPlugin): void {
  const hadPending =
    plugin.syncCollectionsPendingPromise !== null ||
    plugin.isLoadingSyncCollections;
  plugin.syncCollectionsPendingPromise = null;
  plugin.isLoadingSyncCollections = false;
  if (hadPending) {
    plugin.syncCollectionsRequestId += 1;
  }
}

function clearPendingLocalSyncLibraries(plugin: StratumPlugin): void {
  const hadPending =
    plugin.localSyncLibrariesPendingPromise !== null ||
    plugin.isLoadingLocalSyncLibraries;
  plugin.localSyncLibrariesPendingPromise = null;
  plugin.isLoadingLocalSyncLibraries = false;
  if (hadPending) {
    plugin.localSyncLibrariesRequestId += 1;
  }
}

export function isLocalSyncSupported(): boolean {
  return Platform.isDesktopApp;
}

export function clearLocalSyncState(plugin: StratumPlugin): void {
  clearPendingLocalSyncLibraries(plugin);
  plugin.localZoteroUserId = null;
  plugin.discoveredLocalSyncLibraries = [];
  plugin.localSyncLibraries = [];
  plugin.localSyncLibrariesError = null;
  plugin.hasLoadedLocalSyncLibraries = false;
  plugin.selectedSyncLibrary = null;
  clearSyncCollectionsState(plugin);
}

function clearSyncCollectionsState(plugin: StratumPlugin): void {
  clearPendingSyncCollections(plugin);
  plugin.syncCollectionsLibraryIdentity = null;
  plugin.syncCollections = [];
  plugin.syncCollectionsError = null;
  plugin.hasLoadedSyncCollections = false;
  plugin.selectedSyncCollection = null;
}

export function getSelectedSyncLibrary(
  plugin: StratumPlugin,
): EnabledLibrary | null {
  return (
    resolveSelectedSyncLibrary(
      plugin,
      plugin.selectedSyncLibrary?.identity ??
        plugin.settings.selectedSyncLibraryIdentity,
    ) ?? null
  );
}

export function getSelectedSyncCollection(
  plugin: StratumPlugin,
): ZoteroCollectionSummary | null {
  if (!plugin.selectedSyncCollection) {
    return null;
  }

  return (
    plugin.syncCollections.find(
      (collection) => collection.key === plugin.selectedSyncCollection?.key,
    ) ?? plugin.selectedSyncCollection
  );
}

export async function setSelectedSyncLibrary(
  plugin: StratumPlugin,
  library: EnabledLibrary | null,
): Promise<void> {
  const nextLibrary =
    (library
      ? plugin.localSyncLibraries.find(
          (entry) => entry.identity === library.identity,
        )
      : null) ??
    resolveSelectedSyncLibrary(
      plugin,
      plugin.settings.selectedSyncLibraryIdentity,
    );
  const previousIdentity = plugin.selectedSyncLibrary?.identity ?? null;
  const nextIdentity = nextLibrary?.identity ?? null;

  plugin.selectedSyncLibrary = nextLibrary;
  plugin.settings.selectedSyncLibraryIdentity = nextIdentity;

  if (previousIdentity !== nextIdentity) {
    plugin.settings.selectedSyncCollectionKey = null;
    clearSyncCollectionsState(plugin);
  }

  await plugin.saveSettings();
}

export async function setSelectedSyncCollection(
  plugin: StratumPlugin,
  collection: ZoteroCollectionSummary | null,
): Promise<void> {
  const nextCollection = collection
    ? (plugin.syncCollections.find((entry) => entry.key === collection.key) ??
      collection)
    : null;
  plugin.selectedSyncCollection = nextCollection;
  plugin.settings.selectedSyncCollectionKey = nextCollection?.key ?? null;
  await plugin.saveSettings();
}

async function runLocalSyncLibrariesRequest(
  plugin: StratumPlugin,
  requestId: number,
): Promise<EnabledLibrary[]> {
  try {
    const response = await loadLocalZoteroLibraries({
      port: plugin.settings.zoteroLocalApiPort,
    });

    if (requestId !== plugin.localSyncLibrariesRequestId) {
      return plugin.localSyncLibraries;
    }

    const connectedCloudUserId = getConnectedCloudZoteroUserId(plugin);
    if (connectedCloudUserId && connectedCloudUserId !== response.userId) {
      throw new Error(buildLocalZoteroAccountMismatchMessage(plugin));
    }

    plugin.localZoteroUserId = response.userId;
    plugin.discoveredLocalSyncLibraries = sortEnabledLibraries(
      response.libraries,
    );
    reconcileEnabledLocalSyncLibraries(plugin);
    plugin.localSyncLibrariesError = null;
    plugin.bulkSyncSettingsError = null;

    return plugin.localSyncLibraries;
  } catch (error) {
    if (requestId !== plugin.localSyncLibrariesRequestId) {
      return plugin.localSyncLibraries;
    }

    plugin.localZoteroUserId = null;
    plugin.discoveredLocalSyncLibraries = [];
    plugin.localSyncLibraries = [];
    plugin.selectedSyncLibrary = null;
    clearSyncCollectionsState(plugin);
    plugin.localSyncLibrariesError =
      error instanceof Error ? error.message : "Could not reach local Zotero.";
    plugin.bulkSyncSettingsError = plugin.localSyncLibrariesError;
    return [];
  } finally {
    if (requestId === plugin.localSyncLibrariesRequestId) {
      plugin.isLoadingLocalSyncLibraries = false;
      plugin.localSyncLibrariesPendingPromise = null;
      plugin.hasLoadedLocalSyncLibraries = true;
      await plugin.saveSettings();
      await plugin.reconcileLocalLiveSync();
      plugin.refreshViews();
      plugin.refreshSettingTab();
    }
  }
}

function queueLocalSyncLibrariesRequest(
  plugin: StratumPlugin,
): Promise<EnabledLibrary[]> {
  plugin.localSyncLibrariesPendingPromise = null;
  plugin.localSyncLibrariesError = null;
  plugin.bulkSyncSettingsError = null;
  plugin.hasLoadedLocalSyncLibraries = false;
  plugin.isLoadingLocalSyncLibraries = true;
  const requestId = ++plugin.localSyncLibrariesRequestId;
  const pending = runLocalSyncLibrariesRequest(plugin, requestId);
  plugin.localSyncLibrariesPendingPromise = pending;
  return pending;
}

export function ensureLocalSyncLibrariesLoaded(
  plugin: StratumPlugin,
): Promise<EnabledLibrary[]> | null {
  if (!isLocalSyncSupported() || !plugin.settings.bulkSyncEnabled) {
    clearLocalSyncState(plugin);
    return null;
  }

  if (!plugin.backend.hasSession() || !plugin.zoteroConnection?.connected) {
    clearLocalSyncState(plugin);
    return null;
  }

  if (plugin.localSyncLibrariesPendingPromise) {
    return plugin.localSyncLibrariesPendingPromise;
  }

  if (plugin.hasLoadedLocalSyncLibraries) {
    return null;
  }

  return queueLocalSyncLibrariesRequest(plugin);
}

export function refreshLocalSyncLibraries(
  plugin: StratumPlugin,
): Promise<EnabledLibrary[]> | null {
  if (!isLocalSyncSupported() || !plugin.settings.bulkSyncEnabled) {
    clearLocalSyncState(plugin);
    return null;
  }

  if (!plugin.backend.hasSession() || !plugin.zoteroConnection?.connected) {
    clearLocalSyncState(plugin);
    return null;
  }

  return queueLocalSyncLibrariesRequest(plugin);
}

async function runSyncCollectionsRequest(
  plugin: StratumPlugin,
  library: EnabledLibrary,
  requestId: number,
): Promise<ZoteroCollectionSummary[]> {
  try {
    const collections = await loadLocalZoteroCollections({
      port: plugin.settings.zoteroLocalApiPort,
      library,
    });
    if (
      requestId !== plugin.syncCollectionsRequestId ||
      plugin.syncCollectionsLibraryIdentity !== library.identity
    ) {
      return plugin.syncCollections;
    }

    plugin.syncCollections = collections;
    plugin.syncCollectionsError = null;
    plugin.selectedSyncCollection =
      collections.find(
        (collection) =>
          collection.key ===
          (plugin.selectedSyncCollection?.key ??
            plugin.settings.selectedSyncCollectionKey),
      ) ?? null;
    const nextCollectionKey = plugin.selectedSyncCollection?.key ?? null;
    if (plugin.settings.selectedSyncCollectionKey !== nextCollectionKey) {
      plugin.settings.selectedSyncCollectionKey = nextCollectionKey;
    }
    return collections;
  } catch (error) {
    if (requestId !== plugin.syncCollectionsRequestId) {
      return plugin.syncCollections;
    }

    plugin.syncCollections = [];
    plugin.selectedSyncCollection = null;
    plugin.settings.selectedSyncCollectionKey = null;
    plugin.syncCollectionsError =
      error instanceof Error ? error.message : "Failed to load collections.";
    return [];
  } finally {
    if (requestId === plugin.syncCollectionsRequestId) {
      plugin.isLoadingSyncCollections = false;
      plugin.syncCollectionsPendingPromise = null;
      plugin.hasLoadedSyncCollections = true;
      await plugin.saveSettings();
      plugin.refreshViews();
    }
  }
}

function queueSyncCollectionsRequest(
  plugin: StratumPlugin,
  library: EnabledLibrary,
): Promise<ZoteroCollectionSummary[]> {
  clearPendingSyncCollections(plugin);
  plugin.syncCollectionsLibraryIdentity = library.identity;
  plugin.syncCollections = [];
  plugin.syncCollectionsError = null;
  plugin.hasLoadedSyncCollections = false;
  plugin.isLoadingSyncCollections = true;
  const requestId = ++plugin.syncCollectionsRequestId;
  const pending = runSyncCollectionsRequest(plugin, library, requestId);
  plugin.syncCollectionsPendingPromise = pending;
  return pending;
}

export function ensureSyncCollectionsLoaded(
  plugin: StratumPlugin,
  library: EnabledLibrary | null,
): Promise<ZoteroCollectionSummary[]> | null {
  if (!library) {
    clearSyncCollectionsState(plugin);
    return null;
  }

  if (
    plugin.syncCollectionsLibraryIdentity === library.identity &&
    plugin.syncCollectionsPendingPromise
  ) {
    return plugin.syncCollectionsPendingPromise;
  }

  if (
    plugin.syncCollectionsLibraryIdentity === library.identity &&
    plugin.hasLoadedSyncCollections
  ) {
    return null;
  }

  return queueSyncCollectionsRequest(plugin, library);
}

export function refreshSyncCollections(
  plugin: StratumPlugin,
  library: EnabledLibrary | null,
): Promise<ZoteroCollectionSummary[]> | null {
  if (!library) {
    clearSyncCollectionsState(plugin);
    return null;
  }

  return queueSyncCollectionsRequest(plugin, library);
}

export function getLibraryFromFrontmatter(params: {
  libraryType: string | null;
  libraryId: string | null;
  groupName?: string | null;
}): EnabledLibrary | null {
  if (
    (params.libraryType !== "user" && params.libraryType !== "group") ||
    !params.libraryId
  ) {
    return null;
  }

  return {
    type: params.libraryType,
    id: params.libraryId,
    name:
      params.libraryType === "group"
        ? params.groupName?.trim() || `Group ${params.libraryId}`
        : "My Library",
    identity: buildLibraryIdentity(params.libraryType, params.libraryId),
  };
}
