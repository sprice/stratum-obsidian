import assert from "node:assert/strict";
import test from "node:test";
import type * as Search from "../plugin-library-search";
import { loadRuntime } from "./runtime-harness";

test(
  "cancelling a debounced search settles its awaiting callers",
  { timeout: 1000 },
  async () => {
    const search = loadRuntime<typeof Search>("plugin-library-search.ts", {});
    const plugin = {
      backend: { hasSession: () => true },
      settings: {
        enabledLibraries: [{ type: "user", id: "1", identity: "user:1" }],
      },
      selectedSearchLibrary: null,
      selectedSearchCollection: null,
      selectedLibraryResult: null,
      librarySearchCache: new Map(),
      libraryPickerCloseTimer: null,
      librarySearchRequestId: 0,
      librarySearchDebounceTimer: null,
      librarySearchPendingPromise: null,
      isSearchingLibrary: false,
    };
    const { pending } = search.getLibrarySuggestions(plugin as never, "Paper");
    assert.ok(pending);
    search.clearLibrarySearchDebounce(plugin as never);
    const results = await pending;
    assert.equal(results.length, 0);
  },
);
