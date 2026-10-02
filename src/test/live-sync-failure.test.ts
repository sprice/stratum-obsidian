import assert from "node:assert/strict";
import test from "node:test";
import type * as LiveSync from "../plugin-local-live-sync";
import { loadRuntime } from "./runtime-harness";

class FakeFile {
  path = "Literature Notes/paper.md";
}

test("failed refreshes do not advance the live-sync baseline", async () => {
  let flush!: () => void;
  const liveSync = loadRuntime<typeof LiveSync>(
    "plugin-local-live-sync.ts",
    {
      Platform: { isDesktopApp: true },
      TFile: FakeFile,
      requestUrl: ({ url }: { url: string }) =>
        Promise.resolve(
          url.includes("format=versions")
            ? {
                status: 200,
                headers: { "Last-Modified-Version": "2" },
                json: { ABCD1234: 2 },
                text: "{}",
              }
            : {
                status: 503,
                headers: {},
                json: {},
                text: "Server unavailable",
              },
        ),
    },
    {
      window: {
        setTimeout: (callback: () => void) => {
          flush = callback;
          return 1;
        },
        clearTimeout: () => {},
      },
      console: { ...console, error: () => {} },
    },
  );
  const library = {
    type: "user",
    id: "1",
    identity: "user:1",
    name: "Personal",
  };
  const file = new FakeFile();
  const baseline = { ABCD1234: 1 };
  const plugin = {
    isUnloaded: false,
    settings: {
      bulkSyncEnabled: true,
      zoteroLocalApiPort: 23119,
      enabledLibraries: [library],
      libraryAutoSync: {},
      libraryBulkSync: {},
      itemFileMap: {
        "user/1/ABCD1234": {
          filePath: file.path,
          zoteroItemKey: "ABCD1234",
          zoteroVersion: 1,
        },
      },
    },
    backend: {
      hasSession: () => true,
      getZoteroItemDetail: () =>
        Promise.reject(new Error("Server unavailable")),
    },
    zoteroConnection: { connected: true },
    localSyncLibraries: [library],
    localZoteroUserId: "1",
    localLiveSyncQueuedAfterBulkSync: true,
    localLiveSyncDebounceTimer: null,
    localLiveSyncRunPromise: null as Promise<void> | null,
    localLiveSyncDirty: false,
    localLiveSyncLibraryVersions: new Map([[library.identity, 1]]),
    localLiveSyncLibraryItemVersions: new Map([[library.identity, baseline]]),
    noteRefreshPromises: new Map(),
    isBulkLibrarySyncRunning: () => false,
    refreshAutoSyncUi: () => {},
    app: {
      vault: { getAbstractFileByPath: () => file },
      metadataCache: {
        getFileCache: () => ({
          frontmatter: {
            stratum_note_type: "literature-note",
            zotero_item_key: "ABCD1234",
            zotero_item_identity: "user/1/ABCD1234",
            zotero_library_type: "user",
            zotero_library_id: "1",
          },
        }),
      },
    },
  };
  liveSync.notifyLocalLiveSyncAfterBulkSync(plugin as never);
  flush();
  await plugin.localLiveSyncRunPromise;
  assert.equal(plugin.localLiveSyncLibraryVersions.get(library.identity), 1);
  assert.equal(
    plugin.localLiveSyncLibraryItemVersions.get(library.identity),
    baseline,
  );
  assert.equal(plugin.noteRefreshPromises.size, 0);
});
