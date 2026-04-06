import test from "node:test";
import assert from "node:assert/strict";
import type { ZoteroCollectionSummary } from "../backend-types";
import {
  ensureLibraryCollectionsLoaded,
  setSelectedSearchCollection,
} from "../plugin-collections";
import { buildPersonalLibrary } from "../plugin-libraries";

function createCollection(key: string, name: string): ZoteroCollectionSummary {
  return {
    key,
    name,
    parentCollectionKey: null,
    displayName: name,
  };
}

test("setSelectedSearchCollection resets search state when switching collections", () => {
  const currentCollection = createCollection("COLL1", "AI Reading List");
  const nextCollection = createCollection("COLL2", "Methods");
  const plugin = {
    selectedSearchCollection: currentCollection,
    libraryCollections: [currentCollection, nextCollection],
    librarySearchDebounceTimer: null,
    librarySearchPendingPromise: null,
    librarySearchPendingQuery: "attention",
    librarySearchRequestId: 7,
    librarySearchQuery: "attention",
    librarySearchResults: [{ key: "ABCD1234" }],
    librarySearchMeta: {
      source: "live",
      stale: false,
      rateLimited: false,
      retryAfterSeconds: null,
      libraryVersion: 12,
    },
    librarySearchError: "old error",
    isSearchingLibrary: true,
    highlightedLibrarySearchIndex: 3,
    selectedLibraryResult: { key: "ABCD1234" },
    isSelectedLibraryAbstractExpanded: true,
  };

  setSelectedSearchCollection(plugin as never, nextCollection);

  assert.equal(plugin.selectedSearchCollection?.key, "COLL2");
  assert.equal(plugin.librarySearchQuery, "");
  assert.deepEqual(plugin.librarySearchResults, []);
  assert.equal(plugin.librarySearchMeta, null);
  assert.equal(plugin.librarySearchError, null);
  assert.equal(plugin.isSearchingLibrary, false);
  assert.equal(plugin.highlightedLibrarySearchIndex, -1);
  assert.equal(plugin.selectedLibraryResult, null);
  assert.equal(plugin.isSelectedLibraryAbstractExpanded, false);
  assert.equal(plugin.librarySearchRequestId, 8);
});

test("ensureLibraryCollectionsLoaded does not auto-retry after an error for the same library", () => {
  const library = buildPersonalLibrary("123456");
  const plugin = {
    libraryCollectionsLibraryIdentity: library.identity,
    libraryCollectionsPendingPromise: null,
    isLoadingLibraryCollections: false,
    libraryCollectionsError: "Failed to load collections.",
  };

  const result = ensureLibraryCollectionsLoaded(plugin as never, library);

  assert.equal(result, null);
});
