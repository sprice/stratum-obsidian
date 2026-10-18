import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../settings-data";
import { loadRuntime } from "./runtime-harness";

const library = {
  type: "user",
  id: "1",
  identity: "user:1",
  name: "Synthetic",
};
const selected = {
  key: "OLD",
  name: "Original",
  displayName: "Original",
  parentCollectionKey: null,
};

function fixture() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  let requests = 0;
  const response = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const runtime = loadRuntime<typeof import("../plugin-local-sync")>(
    "plugin-local-sync.ts",
    {
      Platform: { isDesktopApp: true },
      requestUrl: () => {
        requests++;
        return response;
      },
    },
  );
  let renders = 0;
  const plugin = {
    isUnloaded: false,
    settings: {
      ...structuredClone(DEFAULT_SETTINGS),
      selectedSyncCollectionKey: selected.key,
    },
    syncCollections: [selected],
    selectedSyncCollection: selected,
    syncCollectionsLibraryIdentity: library.identity,
    syncCollectionsRequestId: 0,
    syncCollectionsPendingPromise: null,
    hasLoadedSyncCollections: true,
    isLoadingSyncCollections: false,
    syncCollectionsError: null,
    saveSettings: () => Promise.resolve(),
    refreshViews: () => {
      renders++;
    },
  };
  return {
    plugin,
    refresh: () =>
      runtime.refreshSyncCollections(plugin as never, library as never),
    fail: () => reject(new Error("Zotero unavailable")),
    finish: (keys: string[]) =>
      resolve({
        status: 200,
        headers: {},
        text: "[]",
        json: keys.map((key) => ({
          key,
          data: { key, name: key, parentCollection: false },
        })),
      }),
    counts: () => ({ requests, renders }),
  };
}

test("manual refresh retains options while loading, deduplicates requests, and preserves selection by key", async () => {
  const f = fixture();
  const first = f.refresh();
  assert.equal(f.refresh(), first);
  assert.equal(f.plugin.syncCollections[0], selected);
  assert.equal(f.plugin.selectedSyncCollection, selected);
  assert.equal(f.plugin.isLoadingSyncCollections, true);
  assert.equal(f.counts().renders, 1);
  f.finish(["OLD", "NEW"]);
  await first;
  assert.equal(f.counts().requests, 1);
  assert.equal(f.plugin.syncCollections.length, 2);
  assert.equal(f.plugin.selectedSyncCollection.key, "OLD");
  assert.equal(f.plugin.selectedSyncCollection.displayName, "OLD");
  assert.equal(f.plugin.settings.selectedSyncCollectionKey, "OLD");
  assert.equal(f.plugin.isLoadingSyncCollections, false);
});

test("failed refresh keeps the collection list and selected scope", async () => {
  const f = fixture();
  const pending = f.refresh();
  f.fail();
  await pending;
  assert.equal(f.plugin.syncCollections[0], selected);
  assert.equal(f.plugin.selectedSyncCollection, selected);
  assert.equal(f.plugin.settings.selectedSyncCollectionKey, "OLD");
  assert.ok(f.plugin.syncCollectionsError);
  assert.equal(f.plugin.isLoadingSyncCollections, false);
});

test("removed selection stays explicit rather than becoming all collections", async () => {
  const f = fixture();
  const pending = f.refresh();
  f.finish(["NEW"]);
  await pending;
  assert.equal(f.plugin.syncCollections.length, 1);
  assert.equal(f.plugin.syncCollections[0].key, "NEW");
  assert.equal(f.plugin.selectedSyncCollection, selected);
  assert.equal(f.plugin.settings.selectedSyncCollectionKey, "OLD");
});
