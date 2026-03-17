import type { ZoteroSearchResult } from "./backend-client";
import type StratumPlugin from "./plugin";

const LIBRARY_PICKER_CLOSE_DELAY_MS = 120;

export function closeLibraryPicker(plugin: StratumPlugin): void {
  cancelLibraryPickerClose(plugin);
  plugin.isLibraryPickerOpen = false;
  plugin.highlightedLibrarySearchIndex = -1;
  plugin.refreshViews();
}

export function scheduleLibraryPickerClose(plugin: StratumPlugin): void {
  cancelLibraryPickerClose(plugin);
  plugin.libraryPickerCloseTimer = window.setTimeout(() => {
    plugin.libraryPickerCloseTimer = null;
    plugin.isLibraryPickerOpen = false;
    plugin.highlightedLibrarySearchIndex = -1;
    plugin.refreshViews();
  }, LIBRARY_PICKER_CLOSE_DELAY_MS);
}

export function cancelLibraryPickerClose(plugin: StratumPlugin): void {
  if (plugin.libraryPickerCloseTimer === null) {
    return;
  }

  window.clearTimeout(plugin.libraryPickerCloseTimer);
  plugin.libraryPickerCloseTimer = null;
}

export function moveLibrarySearchHighlight(
  plugin: StratumPlugin,
  direction: 1 | -1
): void {
  if (!plugin.librarySearchResults.length) {
    return;
  }

  cancelLibraryPickerClose(plugin);
  plugin.isLibraryPickerOpen = true;
  const nextIndex =
    plugin.highlightedLibrarySearchIndex < 0
      ? direction > 0
        ? 0
        : plugin.librarySearchResults.length - 1
      : (plugin.highlightedLibrarySearchIndex +
          direction +
          plugin.librarySearchResults.length) %
        plugin.librarySearchResults.length;
  plugin.highlightedLibrarySearchIndex = nextIndex;
  plugin.refreshViews();
}

export async function selectHighlightedLibraryResult(
  plugin: StratumPlugin
): Promise<void> {
  const result =
    plugin.librarySearchResults[
      plugin.highlightedLibrarySearchIndex >= 0
        ? plugin.highlightedLibrarySearchIndex
        : 0
    ];

  if (!result) {
    return;
  }

  await selectLibrarySearchResult(plugin, result);
}

export async function selectLibrarySearchResult(
  plugin: StratumPlugin,
  result: ZoteroSearchResult
): Promise<void> {
  cancelLibraryPickerClose(plugin);
  plugin.librarySearchQuery = result.title;
  plugin.isLibraryPickerOpen = false;
  plugin.highlightedLibrarySearchIndex = -1;
  plugin.selectedLibraryResult = result;
  plugin.isSelectedLibraryAbstractExpanded = false;
  plugin.refreshViews();
}

export function clearSelectedLibraryResult(
  plugin: StratumPlugin,
  options?: { resetQuery?: boolean }
): void {
  plugin.selectedLibraryResult = null;
  plugin.isSelectedLibraryAbstractExpanded = false;
  if (options?.resetQuery) {
    plugin.librarySearchQuery = "";
    plugin.librarySearchResults = [];
    plugin.librarySearchMeta = null;
    plugin.highlightedLibrarySearchIndex = -1;
  }
  plugin.refreshViews();
}

export function toggleSelectedLibraryAbstract(plugin: StratumPlugin): void {
  if (!plugin.selectedLibraryResult?.abstract) {
    return;
  }

  plugin.isSelectedLibraryAbstractExpanded =
    !plugin.isSelectedLibraryAbstractExpanded;
  plugin.refreshViews();
}

export function syncSelectedLibraryResult(
  plugin: StratumPlugin,
  results: ZoteroSearchResult[]
): void {
  if (!plugin.selectedLibraryResult) {
    return;
  }

  const refreshedSelection = results.find(
    (result) => result.key === plugin.selectedLibraryResult?.key
  );
  if (refreshedSelection) {
    plugin.selectedLibraryResult = refreshedSelection;
  }
}
