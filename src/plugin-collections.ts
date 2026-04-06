import type { ZoteroCollectionSummary } from "./backend-client";
import type StratumPlugin from "./plugin";
import type { EnabledLibrary } from "./settings";
import {
  ZoteroNotConnectedError,
  ZoteroTokenInvalidError,
} from "./zotero-errors";

function clearCollectionScopedSearchState(plugin: StratumPlugin): void {
  if (plugin.librarySearchDebounceTimer !== null) {
    window.clearTimeout(plugin.librarySearchDebounceTimer);
    plugin.librarySearchDebounceTimer = null;
  }

  plugin.librarySearchPendingPromise = null;
  plugin.librarySearchPendingQuery = null;
  plugin.librarySearchRequestId += 1;
  plugin.librarySearchQuery = "";
  plugin.librarySearchResults = [];
  plugin.librarySearchMeta = null;
  plugin.librarySearchError = null;
  plugin.isSearchingLibrary = false;
  plugin.highlightedLibrarySearchIndex = -1;
  plugin.selectedLibraryResult = null;
  plugin.isSelectedLibraryAbstractExpanded = false;
}

function cancelPendingLibraryCollections(plugin: StratumPlugin): void {
  const hadPendingRequest =
    plugin.libraryCollectionsPendingPromise !== null ||
    plugin.isLoadingLibraryCollections;
  plugin.libraryCollectionsPendingPromise = null;
  plugin.isLoadingLibraryCollections = false;
  if (hadPendingRequest) {
    plugin.libraryCollectionsRequestId += 1;
  }
}

async function runLibraryCollectionsRequest(
  plugin: StratumPlugin,
  library: EnabledLibrary,
  requestId: number,
): Promise<ZoteroCollectionSummary[]> {
  try {
    const response = await plugin.backend.getZoteroLibraryCollections({
      library,
    });
    if (
      requestId !== plugin.libraryCollectionsRequestId ||
      plugin.libraryCollectionsLibraryIdentity !== library.identity
    ) {
      return plugin.libraryCollections;
    }

    plugin.libraryCollections = response.collections;
    plugin.libraryCollectionsError = null;
    plugin.selectedSearchCollection =
      response.collections.find(
        (collection) => collection.key === plugin.selectedSearchCollection?.key,
      ) ?? null;
    return response.collections;
  } catch (error) {
    if (requestId !== plugin.libraryCollectionsRequestId) {
      return plugin.libraryCollections;
    }

    plugin.libraryCollections = [];
    plugin.selectedSearchCollection = null;
    if (error instanceof ZoteroTokenInvalidError) {
      plugin.libraryCollectionsError =
        "Zotero connection is no longer valid. Please reconnect in settings.";
    } else if (error instanceof ZoteroNotConnectedError) {
      plugin.libraryCollectionsError =
        "Zotero is not connected. Please connect it again in settings.";
    } else {
      plugin.libraryCollectionsError =
        error instanceof Error ? error.message : "Failed to load collections.";
    }
    return [];
  } finally {
    if (requestId === plugin.libraryCollectionsRequestId) {
      plugin.isLoadingLibraryCollections = false;
      plugin.libraryCollectionsPendingPromise = null;
      plugin.refreshViews();
    }
  }
}

function queueLibraryCollectionsRequest(
  plugin: StratumPlugin,
  library: EnabledLibrary,
): Promise<ZoteroCollectionSummary[]> {
  cancelPendingLibraryCollections(plugin);
  plugin.libraryCollectionsLibraryIdentity = library.identity;
  plugin.libraryCollections = [];
  plugin.libraryCollectionsError = null;
  plugin.isLoadingLibraryCollections = true;
  const requestId = ++plugin.libraryCollectionsRequestId;
  const pending = runLibraryCollectionsRequest(plugin, library, requestId);
  plugin.libraryCollectionsPendingPromise = pending;
  return pending;
}

export function clearLibraryCollectionsState(plugin: StratumPlugin): void {
  cancelPendingLibraryCollections(plugin);
  plugin.libraryCollectionsLibraryIdentity = null;
  plugin.libraryCollections = [];
  plugin.libraryCollectionsError = null;
  plugin.selectedSearchCollection = null;
}

export function getSelectedSearchCollection(
  plugin: StratumPlugin,
): ZoteroCollectionSummary | null {
  if (!plugin.selectedSearchCollection) {
    return null;
  }

  return (
    plugin.libraryCollections.find(
      (collection) => collection.key === plugin.selectedSearchCollection?.key,
    ) ?? plugin.selectedSearchCollection
  );
}

export function setSelectedSearchCollection(
  plugin: StratumPlugin,
  collection: ZoteroCollectionSummary | null,
): void {
  const previousKey = plugin.selectedSearchCollection?.key ?? null;
  const nextCollection = collection
    ? (plugin.libraryCollections.find(
        (entry) => entry.key === collection.key,
      ) ?? collection)
    : null;
  const nextKey = nextCollection?.key ?? null;

  plugin.selectedSearchCollection = nextCollection;
  if (previousKey === nextKey) {
    return;
  }

  clearCollectionScopedSearchState(plugin);
}

export function ensureLibraryCollectionsLoaded(
  plugin: StratumPlugin,
  library: EnabledLibrary | null,
): Promise<ZoteroCollectionSummary[]> | null {
  if (!library) {
    clearLibraryCollectionsState(plugin);
    return null;
  }

  if (
    plugin.libraryCollectionsLibraryIdentity === library.identity &&
    plugin.libraryCollectionsPendingPromise
  ) {
    return plugin.libraryCollectionsPendingPromise;
  }

  if (
    plugin.libraryCollectionsLibraryIdentity === library.identity &&
    !plugin.isLoadingLibraryCollections
  ) {
    return null;
  }

  return queueLibraryCollectionsRequest(plugin, library);
}

export function refreshLibraryCollections(
  plugin: StratumPlugin,
  library: EnabledLibrary | null,
): Promise<ZoteroCollectionSummary[]> | null {
  if (!library) {
    clearLibraryCollectionsState(plugin);
    return null;
  }

  return queueLibraryCollectionsRequest(plugin, library);
}
