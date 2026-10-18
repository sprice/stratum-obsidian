import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldMarkLiteratureNoteDeletedAfterRefreshMiss,
  shouldUseLocalOpenedNoteRefresh,
} from "../plugin-note-refresh-policy";

test("opened-note refresh only uses the local Zotero API on desktop when bulk sync is enabled", () => {
  assert.equal(
    shouldUseLocalOpenedNoteRefresh({
      isDesktopApp: true,
      bulkSyncEnabled: true,
    }),
    true,
  );
  assert.equal(
    shouldUseLocalOpenedNoteRefresh({
      isDesktopApp: true,
      bulkSyncEnabled: false,
    }),
    false,
  );
  assert.equal(
    shouldUseLocalOpenedNoteRefresh({
      isDesktopApp: false,
      bulkSyncEnabled: true,
    }),
    false,
  );
});

test("literature notes are marked deleted only after the confirmed missing-source rules are satisfied", () => {
  assert.equal(
    shouldMarkLiteratureNoteDeletedAfterRefreshMiss({
      usedLocal: false,
      localMissing: false,
      backendMissing: true,
    }),
    true,
  );
  assert.equal(
    shouldMarkLiteratureNoteDeletedAfterRefreshMiss({
      usedLocal: true,
      localMissing: true,
      backendMissing: true,
    }),
    true,
  );
  assert.equal(
    shouldMarkLiteratureNoteDeletedAfterRefreshMiss({
      usedLocal: true,
      localMissing: true,
      backendMissing: false,
    }),
    false,
  );
  assert.equal(
    shouldMarkLiteratureNoteDeletedAfterRefreshMiss({
      usedLocal: true,
      localMissing: false,
      backendMissing: true,
    }),
    false,
  );
});

test("background refresh stays local, quietly records failures, and retains notes for deleted sources", async () => {
  const { loadRuntime } = await import("./runtime-harness");
  const state = { lastError: null as string | null };
  let missing = false;
  let marked = 0;
  let notices = 0;
  let current = true;
  const runtime = loadRuntime<typeof import("../plugin-note-refresh")>(
    "plugin-note-refresh.ts",
    {
      Notice: class {
        constructor() {
          notices++;
        }
      },
    },
    { Error },
    "node",
    {
      "./plugin-note-sync": {
        canSyncLibrary: () => true,
        loadZoteroItemDetailForNoteSync: (
          _plugin: unknown,
          params: { sourcePreference: string },
        ) => {
          assert.equal(params.sourcePreference, "local");
          return Promise.resolve({
            detail: null,
            usedLocal: true,
            localMissing: missing,
            backendMissing: false,
            localError: missing ? null : new Error("Zotero closed"),
            backendError: null,
          });
        },
        writeLiteratureNoteFromDetail: () => {
          throw new Error("Unexpected write");
        },
      },
      "./literature-note": {
        markLiteratureNoteDeleted: () => {
          marked++;
          return Promise.resolve();
        },
      },
      "./plugin-libraries": { getLibraryAutoSyncState: () => state },
      "./plugin-local-sync": {
        getLibraryFromFrontmatter: () => ({ type: "user", id: "1" }),
      },
      "./plugin-note-index": {
        getIdentityFromFrontmatter: () => "user/1/ABCD1234",
        getItemKeyFromFrontmatter: () => "ABCD1234",
      },
    },
  );
  const plugin = {
    isUnloaded: false,
    isBulkLibrarySyncRunning: () => false,
    noteRefreshPromises: new Map(),
    refreshAutoSyncUi: () => {},
    app: {
      metadataCache: {
        getFileCache: () => ({
          frontmatter: { stratum_note_type: "literature-note" },
        }),
      },
    },
  };
  const refresh = (sourceMissing = false) =>
    runtime.refreshOpenedLiteratureNote(
      plugin as never,
      { path: "Papers/Synthetic.md" } as never,
      { background: true, sourceMissing, canRefresh: () => current },
    );
  await refresh();
  assert.equal(notices, 0);
  assert.equal(marked, 0);
  assert.equal(state.lastError, "Zotero closed");
  missing = true;
  await refresh();
  assert.equal(marked, 0);
  assert.match(state.lastError, /fully refreshed/);
  current = false;
  await refresh(true);
  assert.equal(marked, 0);
  current = true;
  await refresh(true);
  assert.equal(marked, 1);
  assert.equal(state.lastError, null);
  assert.equal(notices, 0);
});
