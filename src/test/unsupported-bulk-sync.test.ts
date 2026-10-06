import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import { getBulkLibrarySyncStatusMessage } from "../zotero-sync";

test("bulk sync continues past unknown types without retries or enrichment", async () => {
  class File {
    path = "Literature Notes/existing.md";
    basename = "existing";
    name = "existing.md";
  }
  const file = new File();
  const library = {
    type: "user",
    id: "1",
    name: "My Library",
    identity: "user:1",
  };
  const items = [
    {
      key: "FUTURE",
      version: 1,
      data: { itemType: "futureType", title: "Future work" },
    },
    {
      key: "BOOK",
      version: 1,
      data: { itemType: "book", title: "Known book" },
    },
  ];
  const requests: string[] = [];
  const notices: string[] = [];
  let contents = `---\n${JSON.stringify({ zotero_item_identity: "user/1/BOOK", zotero_item_key: "BOOK", zotero_library_id: "1", zotero_library_type: "user" })}\n---\nPersonal writing`;
  let writes = 0;
  const runtime = loadRuntime<typeof import("../plugin-bulk-sync")>(
    "plugin-bulk-sync.ts",
    {
      TFile: File,
      Platform: { isDesktopApp: true },
      Notice: class {
        constructor(message: string) {
          notices.push(message);
        }
      },
      parseYaml: JSON.parse,
      stringifyYaml: JSON.stringify,
      normalizePath: (p: string) => p,
      htmlToMarkdown: (html: string) => html,
      requestUrl: async ({ url }: { url: string }) => {
        await Promise.resolve();
        const path = new URL(url).pathname;
        requests.push(path);
        const data = path.endsWith("/items/top")
          ? items
          : path.endsWith("/children")
            ? []
            : items.find((item) => path.endsWith(`/items/${item.key}`));
        assert.ok(data, `Unexpected request ${url}`);
        return {
          status: 200,
          json: data,
          text: JSON.stringify(data),
          headers: { "Total-Results": "2", "Last-Modified-Version": "1" },
        };
      },
    },
    {},
    "browser",
    {
      "./plugin-annotation-images": {
        beginAnnotationImageSync() {},
        importAnnotationImages: (_plugin: unknown, detail: unknown) =>
          Promise.resolve(detail),
        annotationImageSyncSummary: () =>
          " 1 area image could not be refreshed.",
      },
    },
  );
  const plugin = {
    manifest: { version: "0.2.1" },
    localZoteroUserId: "1",
    zoteroConnection: { connected: true, zoteroUserId: "1" },
    settings: {
      enabledLibraries: [library],
      libraryBulkSync: {},
      libraryAutoSync: {},
      notesFolder: "Literature Notes",
      filenameFormat: "readable",
      bulkSyncEnabled: true,
      collectionCatalogs: { "user:1": { updatedAt: Date.now() } },
      zoteroLocalApiPort: 23119,
    },
    localSyncLibraries: [library],
    bulkLibrarySyncUiRefreshTimer: null,
    backend: {
      hasSession: () => true,
      getZoteroLibraryChanges: () =>
        Promise.resolve({ latestLibraryVersion: 1 }),
    },
    app: {
      vault: {
        read: () => Promise.resolve(contents),
        process: async (_file: File, transform: (text: string) => string) => {
          await Promise.resolve();
          contents = transform(contents);
          writes++;
        },
        getAbstractFileByPath: () => null,
      },
    },
    isZoteroAutoSyncRunning: () => false,
    rebuildItemFileMap: async () => {},
    saveSettings: async () => {},
    findExistingLiteratureNoteFile: () => file,
    rememberLiteratureNoteFile: () => {},
    refreshViews: () => {},
    refreshSettingTab: () => {},
    refreshAutoSyncUi: () => {},
    notifyLocalLiveSyncAfterBulkSync: () => {},
  };
  await runtime.runBulkLibrarySync(plugin as never, library as never, null);
  const state = (
    plugin.settings.libraryBulkSync as Record<
      string,
      import("../zotero-sync").BulkLibrarySyncState
    >
  )["user:1"];
  assert.equal(state.phase, "completed");
  assert.equal(state.updatedCount, 1);
  assert.equal(state.skippedCount, 1);
  assert.equal(state.failedCount, 0);
  assert.equal(
    state.annotationImageWarning,
    "1 area image could not be refreshed.",
  );
  assert.equal(state.unsupportedItems?.[0].title, "Future work");
  assert.equal(
    requests.filter((path) => path.endsWith("/items/FUTURE")).length,
    1,
  );
  assert.equal(writes, 1);
  assert.match(contents, /Personal writing/);
  assert.equal(notices.length, 0);
  assert.match(
    getBulkLibrarySyncStatusMessage({ state, libraryName: library.name }) ?? "",
    /1 skipped/,
  );
  assert.match(
    getBulkLibrarySyncStatusMessage({ state, libraryName: library.name }) ?? "",
    /1 area image could not be refreshed/,
  );
});
