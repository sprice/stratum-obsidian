import type { ZoteroSearchResult } from "./backend-client";
import type StratumPlugin from "./plugin";
import type { CachedMetadata, TFile } from "obsidian";
import { getLiteratureNoteMatchPriority } from "./literature-note-matching";
import { getSelectedSearchLibrary } from "./plugin-libraries";

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
  direction: 1 | -1,
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

export function selectHighlightedLibraryResult(plugin: StratumPlugin): void {
  const result =
    plugin.librarySearchResults[
      plugin.highlightedLibrarySearchIndex >= 0
        ? plugin.highlightedLibrarySearchIndex
        : 0
    ];

  if (!result) {
    return;
  }

  selectLibrarySearchResult(plugin, result);
}

export function selectLibrarySearchResult(
  plugin: StratumPlugin,
  result: ZoteroSearchResult,
): void {
  cancelLibraryPickerClose(plugin);
  plugin.libraryNoteActionError = null;
  const library = getSelectedSearchLibrary(plugin);
  plugin.selectedLibraryNoteFile = library
    ? plugin.findExistingLiteratureNoteFile({
        libraryType: library.type,
        libraryId: library.id,
        itemKey: result.key,
      })
    : null;
  plugin.isLibraryPickerOpen = false;
  plugin.highlightedLibrarySearchIndex = -1;
  plugin.selectedLibraryResult = result;
  plugin.isSelectedLibraryAbstractExpanded = false;
  plugin.refreshViews();
}

export function clearSelectedLibraryResult(
  plugin: StratumPlugin,
  options?: { resetQuery?: boolean },
): void {
  plugin.selectedLibraryResult = null;
  plugin.selectedLibraryNoteFile = null;
  plugin.libraryNoteActionError = null;
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
  results: ZoteroSearchResult[],
): void {
  if (!plugin.selectedLibraryResult) {
    return;
  }

  const refreshedSelection = results.find(
    (result) => result.key === plugin.selectedLibraryResult?.key,
  );
  if (refreshedSelection) {
    plugin.selectedLibraryResult = refreshedSelection;
  }
}

// Recheck only events involving the selected source, avoiding a vault scan for
// every unrelated edit while keeping create/update controls current.
export function refreshSelectedLibraryNoteForFile(
  plugin: StratumPlugin,
  file: TFile,
  cache?: CachedMetadata | null,
): boolean {
  const selected = plugin.selectedLibraryResult;
  const library = getSelectedSearchLibrary(plugin);
  if (!selected || !library) return false;
  const identity = {
    libraryType: library.type,
    libraryId: library.id,
    itemKey: selected.key,
  };
  const isCurrentFile = plugin.selectedLibraryNoteFile?.path === file.path;
  const frontmatter =
    cache?.frontmatter ??
    plugin.app.metadataCache.getFileCache(file)?.frontmatter;
  if (
    !isCurrentFile &&
    getLiteratureNoteMatchPriority(frontmatter, identity) === null
  )
    return false;
  const next = plugin.findExistingLiteratureNoteFile(identity);
  if (next === plugin.selectedLibraryNoteFile) return false;
  plugin.selectedLibraryNoteFile = next;
  return true;
}
