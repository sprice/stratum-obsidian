import type { ZoteroSearchMeta, ZoteroSearchResult } from "./backend-types";
import {
  getLibrarySearchCacheKey,
  isLibrarySearchQueryReady,
} from "./library-search-query";
import type StratumPlugin from "./plugin";
import { getSelectedSearchCollection } from "./plugin-collections";
import { getSelectedSearchLibrary } from "./plugin-libraries";
import {
  cancelLibraryPickerClose,
  syncSelectedLibraryResult,
} from "./plugin-library-selection";
import {
  markZoteroDisconnected,
  markZoteroTokenInvalid,
} from "./plugin-sync-helpers";
import {
  ZoteroNotConnectedError,
  ZoteroTokenInvalidError,
} from "./zotero-errors";

const LIBRARY_SEARCH_DEBOUNCE_MS = 500;

export type LibrarySearchSuggestionSnapshot = {
  results: ZoteroSearchResult[];
  pending: Promise<ZoteroSearchResult[]> | null;
};

export async function searchLibrary(
  plugin: StratumPlugin,
  query: string,
): Promise<void> {
  const snapshot = getLibrarySuggestions(plugin, query);
  if (snapshot.pending) {
    await snapshot.pending;
  }
}

export function setLibrarySearchQuery(
  plugin: StratumPlugin,
  query: string,
): void {
  syncLibrarySearchQuery(plugin, query);

  if (isLibrarySearchQueryReady(query)) {
    return;
  }

  clearPendingLibrarySearch(plugin);
  plugin.librarySearchResults = [];
  plugin.librarySearchMeta = null;
  plugin.librarySearchError = null;
  plugin.isSearchingLibrary = false;
  plugin.highlightedLibrarySearchIndex = -1;
}

export function openLibraryPicker(plugin: StratumPlugin): void {
  if (!plugin.backend.hasSession()) {
    plugin.librarySearchError = "Sign in first before searching your library.";
    plugin.refreshViews();
    return;
  }

  cancelLibraryPickerClose(plugin);
  plugin.isLibraryPickerOpen = true;
  plugin.refreshViews();
}

export async function refreshLibrarySearch(
  plugin: StratumPlugin,
): Promise<void> {
  const query = plugin.librarySearchQuery;
  if (!isLibrarySearchQueryReady(query)) {
    setLibrarySearchQuery(plugin, query);
    plugin.refreshViews();
    return;
  }

  cancelLibraryPickerClose(plugin);
  plugin.isLibraryPickerOpen = true;
  clearPendingLibrarySearch(plugin);
  plugin.librarySearchPendingPromise = runLibrarySearchRequest(plugin, query, {
    refresh: true,
  });
  await plugin.librarySearchPendingPromise;
  plugin.refreshViews();
}

export function getLibrarySuggestions(
  plugin: StratumPlugin,
  query: string,
): LibrarySearchSuggestionSnapshot {
  syncLibrarySearchQuery(plugin, query);
  plugin.isLibraryPickerOpen = true;
  cancelLibraryPickerClose(plugin);

  if (!plugin.backend.hasSession()) {
    clearPendingLibrarySearch(plugin);
    plugin.librarySearchResults = [];
    plugin.librarySearchMeta = null;
    plugin.librarySearchError = "Sign in first before searching your library.";
    plugin.isSearchingLibrary = false;
    plugin.highlightedLibrarySearchIndex = -1;
    return {
      results: [],
      pending: null,
    };
  }

  if (!isLibrarySearchQueryReady(query)) {
    clearPendingLibrarySearch(plugin);
    plugin.librarySearchResults = [];
    plugin.librarySearchMeta = null;
    plugin.librarySearchError = null;
    plugin.isSearchingLibrary = false;
    plugin.highlightedLibrarySearchIndex = -1;
    return {
      results: [],
      pending: null,
    };
  }

  const library = getSelectedSearchLibrary(plugin);
  const collection = getSelectedSearchCollection(plugin);
  const cacheKey = getScopedLibrarySearchCacheKey(
    query,
    library?.identity ?? "none",
    collection?.key ?? "all",
  );
  const cachedResponse = plugin.librarySearchCache.get(cacheKey);
  if (cachedResponse) {
    clearPendingLibrarySearch(plugin);
    applyLibrarySearchResponse(
      plugin,
      query,
      cachedResponse.results,
      cachedResponse.meta,
    );
    plugin.isSearchingLibrary = false;
    return {
      results: cachedResponse.results,
      pending: null,
    };
  }

  if (
    plugin.librarySearchPendingPromise &&
    plugin.librarySearchPendingQuery === cacheKey
  ) {
    plugin.isSearchingLibrary = true;
    return {
      results: plugin.librarySearchResults,
      pending: plugin.librarySearchPendingPromise,
    };
  }

  const pending = queueLibrarySearch(plugin, query);
  return {
    results: plugin.librarySearchResults,
    pending,
  };
}

export function clearLibrarySearchDebounce(plugin: StratumPlugin): void {
  if (plugin.librarySearchDebounceTimer === null) {
    return;
  }

  window.clearTimeout(plugin.librarySearchDebounceTimer);
  plugin.librarySearchDebounceTimer = null;
}

function queueLibrarySearch(
  plugin: StratumPlugin,
  query: string,
): Promise<ZoteroSearchResult[]> {
  clearPendingLibrarySearch(plugin);

  const requestId = ++plugin.librarySearchRequestId;
  const library = getSelectedSearchLibrary(plugin);
  const collection = getSelectedSearchCollection(plugin);
  const cacheKey = getScopedLibrarySearchCacheKey(
    query,
    library?.identity ?? "none",
    collection?.key ?? "all",
  );
  plugin.librarySearchQuery = query;
  plugin.librarySearchResults = [];
  plugin.librarySearchMeta = null;
  plugin.librarySearchError = null;
  plugin.highlightedLibrarySearchIndex = -1;
  plugin.isSearchingLibrary = true;
  plugin.librarySearchPendingQuery = cacheKey;

  const pending = new Promise<ZoteroSearchResult[]>((resolve) => {
    plugin.librarySearchDebounceTimer = window.setTimeout(() => {
      plugin.librarySearchDebounceTimer = null;
      void runLibrarySearchRequest(plugin, query, { requestId }).then(resolve);
    }, LIBRARY_SEARCH_DEBOUNCE_MS);
  });

  plugin.librarySearchPendingPromise = pending;
  return pending;
}

function clearPendingLibrarySearch(plugin: StratumPlugin): void {
  const hadPendingSearch =
    plugin.librarySearchDebounceTimer !== null ||
    plugin.librarySearchPendingPromise !== null ||
    plugin.isSearchingLibrary;
  clearLibrarySearchDebounce(plugin);
  plugin.librarySearchPendingPromise = null;
  plugin.librarySearchPendingQuery = null;
  if (hadPendingSearch) {
    plugin.librarySearchRequestId += 1;
  }
}

async function runLibrarySearchRequest(
  plugin: StratumPlugin,
  query: string,
  options?: { refresh?: boolean; requestId?: number },
): Promise<ZoteroSearchResult[]> {
  const requestId = options?.requestId ?? ++plugin.librarySearchRequestId;
  const library = getSelectedSearchLibrary(plugin);
  const collection = getSelectedSearchCollection(plugin);
  if (!library) {
    plugin.librarySearchResults = [];
    plugin.librarySearchMeta = null;
    plugin.librarySearchError = "Connect Zotero before searching your library.";
    plugin.highlightedLibrarySearchIndex = -1;
    return [];
  }
  plugin.librarySearchQuery = query;
  plugin.librarySearchError = null;
  plugin.isSearchingLibrary = true;

  try {
    const response = await plugin.backend.searchZoteroLibrary(query, {
      refresh: options?.refresh,
      library,
      collectionKey: collection?.key ?? null,
    });
    if (requestId !== plugin.librarySearchRequestId) {
      return plugin.librarySearchResults;
    }

    cacheLibrarySearchResponse(plugin, query, response.results, response.meta);
    applyLibrarySearchResponse(plugin, query, response.results, response.meta);
    return response.results;
  } catch (error) {
    if (requestId !== plugin.librarySearchRequestId) {
      return plugin.librarySearchResults;
    }

    plugin.librarySearchResults = [];
    plugin.librarySearchMeta = null;
    plugin.highlightedLibrarySearchIndex = -1;
    if (error instanceof ZoteroTokenInvalidError) {
      markZoteroTokenInvalid(plugin);
      plugin.librarySearchError =
        "Zotero connection is no longer valid. Please reconnect in settings.";
    } else if (error instanceof ZoteroNotConnectedError) {
      markZoteroDisconnected(plugin);
      plugin.librarySearchError =
        "Zotero is not connected. Please connect it again in settings.";
    } else {
      plugin.librarySearchError =
        error instanceof Error ? error.message : "Library search failed.";
    }
    return [];
  } finally {
    if (requestId === plugin.librarySearchRequestId) {
      plugin.isSearchingLibrary = false;
      plugin.librarySearchPendingPromise = null;
      plugin.librarySearchPendingQuery = null;
    }
  }
}

function applyLibrarySearchResponse(
  plugin: StratumPlugin,
  query: string,
  results: ZoteroSearchResult[],
  meta: ZoteroSearchMeta,
): void {
  plugin.librarySearchQuery = query;
  plugin.librarySearchResults = results;
  plugin.librarySearchMeta = meta;
  plugin.librarySearchError = null;
  plugin.highlightedLibrarySearchIndex = -1;
  syncSelectedLibraryResult(plugin, results);
}

function cacheLibrarySearchResponse(
  plugin: StratumPlugin,
  query: string,
  results: ZoteroSearchResult[],
  meta: ZoteroSearchMeta,
): void {
  const library = getSelectedSearchLibrary(plugin);
  const collection = getSelectedSearchCollection(plugin);
  if (!library) {
    return;
  }

  plugin.librarySearchCache.set(
    getScopedLibrarySearchCacheKey(
      query,
      library.identity,
      collection?.key ?? "all",
    ),
    {
      query,
      results,
      meta,
    },
  );
}

function syncLibrarySearchQuery(plugin: StratumPlugin, query: string): void {
  plugin.librarySearchQuery = query;

  if (
    plugin.selectedLibraryResult &&
    query !== plugin.selectedLibraryResult.title
  ) {
    plugin.selectedLibraryResult = null;
    plugin.isSelectedLibraryAbstractExpanded = false;
  }
}

function getScopedLibrarySearchCacheKey(
  query: string,
  libraryIdentity: string,
  collectionKey: string,
): string {
  return `${libraryIdentity}::${collectionKey}::${getLibrarySearchCacheKey(query)}`;
}
