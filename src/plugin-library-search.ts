import type { ZoteroSearchResult } from "./backend-client";
import type StratumPlugin from "./plugin";
import {
  cancelLibraryPickerClose,
  syncSelectedLibraryResult,
} from "./plugin-library-selection";

const LIBRARY_SEARCH_DEBOUNCE_MS = 150;

export async function searchLibrary(
  plugin: StratumPlugin,
  query: string
): Promise<void> {
  queueLibrarySearch(plugin, query);
}

export function setLibrarySearchQuery(
  plugin: StratumPlugin,
  query: string
): void {
  if (plugin.selectedLibraryResult && query !== plugin.selectedLibraryResult.title) {
    plugin.selectedLibraryResult = null;
    plugin.isSelectedLibraryAbstractExpanded = false;
  }
  queueLibrarySearch(plugin, query);
}

export function openLibraryPicker(plugin: StratumPlugin): void {
  if (!plugin.backend.hasSession()) {
    plugin.librarySearchError = "Sign in first before searching your library.";
    plugin.refreshViews();
    return;
  }

  const shouldFetch =
    !plugin.isSearchingLibrary && plugin.librarySearchResults.length === 0;
  cancelLibraryPickerClose(plugin);

  if (plugin.isLibraryPickerOpen) {
    if (shouldFetch) {
      queueLibrarySearch(plugin, plugin.librarySearchQuery);
    }
    return;
  }

  plugin.isLibraryPickerOpen = true;
  if (shouldFetch) {
    queueLibrarySearch(plugin, plugin.librarySearchQuery);
    return;
  }

  plugin.refreshViews();
}

export async function refreshLibrarySearch(plugin: StratumPlugin): Promise<void> {
  await fetchLibrarySuggestions(plugin, plugin.librarySearchQuery, {
    refresh: true,
  });
  plugin.refreshViews();
}

export async function fetchLibrarySuggestions(
  plugin: StratumPlugin,
  query: string,
  options?: { refresh?: boolean }
): Promise<ZoteroSearchResult[]> {
  clearLibrarySearchDebounce(plugin);
  const previousQuery = plugin.librarySearchQuery;
  plugin.librarySearchQuery = query;

  const canReuseCachedResults =
    !options?.refresh &&
    query === previousQuery &&
    !plugin.isSearchingLibrary &&
    (plugin.librarySearchMeta !== null ||
      plugin.librarySearchResults.length > 0 ||
      plugin.librarySearchError !== null);

  if (canReuseCachedResults) {
    return plugin.librarySearchResults;
  }

  if (!plugin.backend.hasSession()) {
    plugin.librarySearchResults = [];
    plugin.librarySearchMeta = null;
    plugin.librarySearchError = "Sign in first before searching your library.";
    plugin.isSearchingLibrary = false;
    return [];
  }

  const requestId = ++plugin.librarySearchRequestId;
  plugin.librarySearchError = null;
  plugin.isSearchingLibrary = true;

  try {
    const response = await plugin.backend.searchZoteroLibrary(query, {
      refresh: options?.refresh,
    });
    if (requestId !== plugin.librarySearchRequestId) {
      return plugin.librarySearchResults;
    }

    plugin.librarySearchResults = response.results;
    plugin.librarySearchMeta = response.meta;
    syncSelectedLibraryResult(plugin, response.results);
    return response.results;
  } catch (error) {
    if (requestId !== plugin.librarySearchRequestId) {
      return plugin.librarySearchResults;
    }

    plugin.librarySearchResults = [];
    plugin.librarySearchMeta = null;
    plugin.librarySearchError =
      error instanceof Error ? error.message : "Library search failed.";
    return [];
  } finally {
    if (requestId === plugin.librarySearchRequestId) {
      plugin.isSearchingLibrary = false;
    }
  }
}

function queueLibrarySearch(plugin: StratumPlugin, query: string): void {
  plugin.librarySearchQuery = query;
  plugin.librarySearchError = null;
  plugin.isLibraryPickerOpen = true;
  clearLibrarySearchDebounce(plugin);

  if (!plugin.backend.hasSession()) {
    plugin.librarySearchResults = [];
    plugin.librarySearchMeta = null;
    plugin.librarySearchError = "Sign in first before searching your library.";
    plugin.isSearchingLibrary = false;
    plugin.highlightedLibrarySearchIndex = -1;
    plugin.refreshViews();
    return;
  }

  const requestId = ++plugin.librarySearchRequestId;
  plugin.librarySearchResults = [];
  plugin.librarySearchMeta = null;
  plugin.highlightedLibrarySearchIndex = -1;
  plugin.isSearchingLibrary = true;
  plugin.refreshViews();

  const delay = query.trim() ? LIBRARY_SEARCH_DEBOUNCE_MS : 0;
  plugin.librarySearchDebounceTimer = window.setTimeout(() => {
    plugin.librarySearchDebounceTimer = null;
    void performLibrarySearch(plugin, query, requestId);
  }, delay);
}

export function clearLibrarySearchDebounce(plugin: StratumPlugin): void {
  if (plugin.librarySearchDebounceTimer === null) {
    return;
  }

  window.clearTimeout(plugin.librarySearchDebounceTimer);
  plugin.librarySearchDebounceTimer = null;
}

async function performLibrarySearch(
  plugin: StratumPlugin,
  query: string,
  requestId: number
): Promise<void> {
  let shouldRefresh = true;

  try {
    const response = await plugin.backend.searchZoteroLibrary(query);
    if (requestId !== plugin.librarySearchRequestId) {
      shouldRefresh = false;
      return;
    }

    plugin.librarySearchResults = response.results;
    plugin.librarySearchMeta = response.meta;
    syncSelectedLibraryResult(plugin, response.results);
    plugin.highlightedLibrarySearchIndex = -1;
  } catch (error) {
    if (requestId !== plugin.librarySearchRequestId) {
      shouldRefresh = false;
      return;
    }

    plugin.librarySearchResults = [];
    plugin.librarySearchMeta = null;
    plugin.highlightedLibrarySearchIndex = -1;
    plugin.librarySearchError =
      error instanceof Error ? error.message : "Library search failed.";
  } finally {
    if (shouldRefresh) {
      plugin.isSearchingLibrary = false;
      plugin.refreshViews();
    }
  }
}
