import test from "node:test";
import assert from "node:assert/strict";
import {
  findAffectedPathsForDeletedChildKeys,
  formatRelativeSyncTime,
  getSyncStatusLabel,
  shouldSkipFocusSync,
  type ZoteroAutoSyncState,
} from "../zotero-sync";

const DEFAULT_SYNC_STATE: ZoteroAutoSyncState = {
  libraryVersion: 42,
  lastSuccessfulSyncAt: null,
  lastError: null,
  initialRefreshCompleted: true,
};

test("findAffectedPathsForDeletedChildKeys matches attachment, note, and annotation keys", () => {
  const paths = findAffectedPathsForDeletedChildKeys(
    [
      {
        path: "Literature Notes/one.md",
        frontmatter: {
          zotero_attachment_keys: ["ATTACH1"],
          zotero_note_keys: ["NOTE1"],
          zotero_annotation_keys: ["ANNOT1", "ANNOT2"],
        },
      },
      {
        path: "Literature Notes/two.md",
        frontmatter: {
          zotero_attachment_keys: ["ATTACH2"],
          zotero_note_keys: [],
          zotero_annotation_keys: ["ANNOT9"],
        },
      },
    ],
    ["NOTE1", "ANNOT9"]
  );

  assert.deepEqual(paths, [
    "Literature Notes/one.md",
    "Literature Notes/two.md",
  ]);
});

test("getSyncStatusLabel reports relative sync times and errors", () => {
  assert.match(
    getSyncStatusLabel({
      isSyncing: false,
      autoSyncEnabled: true,
      state: {
        ...DEFAULT_SYNC_STATE,
        lastSuccessfulSyncAt: "2026-03-14T12:00:00.000Z",
      },
      now: Date.parse("2026-03-14T12:02:00.000Z"),
    }),
    /^Zotero: synced /
  );

  assert.equal(
    getSyncStatusLabel({
      isSyncing: false,
      autoSyncEnabled: true,
      state: {
        ...DEFAULT_SYNC_STATE,
        lastError: "Boom",
      },
    }),
    "Zotero: sync failed"
  );
});

test("formatRelativeSyncTime and shouldSkipFocusSync handle cooldown windows", () => {
  assert.equal(
    formatRelativeSyncTime(
      "2026-03-14T12:00:00.000Z",
      Date.parse("2026-03-14T12:00:30.000Z")
    ),
    "30 seconds ago"
  );

  assert.equal(
    shouldSkipFocusSync(
      Date.parse("2026-03-14T12:00:00.000Z"),
      Date.parse("2026-03-14T12:00:20.000Z"),
      30_000
    ),
    true
  );

  assert.equal(
    shouldSkipFocusSync(
      Date.parse("2026-03-14T12:00:00.000Z"),
      Date.parse("2026-03-14T12:00:31.000Z"),
      30_000
    ),
    false
  );
});
