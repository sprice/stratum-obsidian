import assert from "node:assert/strict";
import test from "node:test";
import {
  getLibrarySearchCacheKey,
  isLibrarySearchQueryReady,
  normalizeLibrarySearchQuery,
} from "../library-search-query";

test("normalizeLibrarySearchQuery trims, collapses whitespace, and lowercases", () => {
  assert.equal(
    normalizeLibrarySearchQuery("  Machine   Learning  2024 "),
    "machine learning 2024"
  );
});

test("getLibrarySearchCacheKey reuses equivalent queries", () => {
  assert.equal(
    getLibrarySearchCacheKey("Machine Learning"),
    getLibrarySearchCacheKey("  machine   learning ")
  );
});

test("isLibrarySearchQueryReady requires at least two normalized characters", () => {
  assert.equal(isLibrarySearchQueryReady("a"), false);
  assert.equal(isLibrarySearchQueryReady("  a  "), false);
  assert.equal(isLibrarySearchQueryReady("ab"), true);
  assert.equal(isLibrarySearchQueryReady(" a  b "), true);
});
