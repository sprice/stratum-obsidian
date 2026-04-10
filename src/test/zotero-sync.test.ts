import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BULK_LIBRARY_SYNC_STATE,
  findAffectedPathsForDeletedChildKeys,
  formatBulkLibrarySyncCompletionMessage,
  formatRelativeSyncTime,
  getBulkLibrarySyncButtonLabel,
  getBulkLibrarySyncStatusMessage,
  getSyncStatusLabel,
  type BulkLibrarySyncState,
  type ZoteroAutoSyncState,
} from "../zotero-sync";

const DEFAULT_SYNC_STATE: ZoteroAutoSyncState = {
  libraryVersion: 42,
  lastSuccessfulSyncAt: null,
  lastError: null,
  initialRefreshCompleted: true,
};

const DEFAULT_BULK_SYNC_STATE: BulkLibrarySyncState = {
  ...DEFAULT_BULK_LIBRARY_SYNC_STATE,
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
    ["NOTE1", "ANNOT9"],
  );

  assert.deepEqual(paths, [
    "Literature Notes/one.md",
    "Literature Notes/two.md",
  ]);
});

test("getSyncStatusLabel reports relative sync times and errors", () => {
  assert.equal(
    getSyncStatusLabel({
      isSyncing: false,
      state: DEFAULT_SYNC_STATE,
    }),
    "Zotero",
  );

  assert.match(
    getSyncStatusLabel({
      isSyncing: false,
      state: {
        ...DEFAULT_SYNC_STATE,
        lastSuccessfulSyncAt: "2026-03-14T12:00:00.000Z",
      },
      now: Date.parse("2026-03-14T12:02:00.000Z"),
    }),
    /^Zotero: synced /,
  );

  assert.equal(
    getSyncStatusLabel({
      isSyncing: false,
      state: {
        ...DEFAULT_SYNC_STATE,
        lastError: "Boom",
      },
    }),
    "Zotero: sync failed",
  );
});

test("formatRelativeSyncTime handles cooldown windows", () => {
  assert.equal(
    formatRelativeSyncTime(
      "2026-03-14T12:00:00.000Z",
      Date.parse("2026-03-14T12:00:30.000Z"),
    ),
    "30 seconds ago",
  );
});

test("bulk library sync labels reflect running, paused, and completed states", () => {
  assert.equal(
    getBulkLibrarySyncButtonLabel({
      ...DEFAULT_BULK_SYNC_STATE,
      phase: "running",
    }),
    "Syncing Zotero papers...",
  );

  assert.equal(
    getBulkLibrarySyncButtonLabel(
      {
        ...DEFAULT_BULK_SYNC_STATE,
        phase: "running",
      },
      {
        libraryName: "My Library",
      },
    ),
    "Syncing My Library...",
  );

  assert.equal(
    getBulkLibrarySyncButtonLabel(
      {
        ...DEFAULT_BULK_SYNC_STATE,
        phase: "idle",
      },
      {
        collectionName: "AI Reading List",
      },
    ),
    "Sync all papers from AI Reading List",
  );

  assert.equal(
    getBulkLibrarySyncButtonLabel({
      ...DEFAULT_BULK_SYNC_STATE,
      phase: "paused-rate-limit",
    }),
    "Sync all Zotero papers",
  );

  assert.equal(
    getBulkLibrarySyncStatusMessage({
      state: {
        ...DEFAULT_BULK_SYNC_STATE,
        phase: "running",
        totalResults: 120,
      },
      processedCount: 45,
    }),
    "Syncing 45 of 120 papers.",
  );

  assert.equal(
    getBulkLibrarySyncStatusMessage({
      state: {
        ...DEFAULT_BULK_SYNC_STATE,
        phase: "completed",
        processedCount: 8,
        startedAt: "2026-03-14T12:00:00.000Z",
        completedAt: "2026-03-14T12:00:22.340Z",
        totalResults: 8,
      },
      libraryName: "My Library",
      collectionName: "AI Reading List",
    }),
    "Finished syncing 8 papers in My Library in 22.34 seconds.",
  );

  assert.equal(
    getBulkLibrarySyncStatusMessage({
      state: {
        ...DEFAULT_BULK_SYNC_STATE,
        phase: "completed",
        processedCount: 8,
        enrichmentFailureCount: 2,
        startedAt: "2026-03-14T12:00:00.000Z",
        completedAt: "2026-03-14T12:00:22.340Z",
        totalResults: 8,
      },
      libraryName: "My Library",
      collectionName: "AI Reading List",
    }),
    "Finished syncing 8 papers in My Library in 22.34 seconds. Enrichment failed for 2 papers. Run sync again later to try again.",
  );

  assert.equal(
    getBulkLibrarySyncStatusMessage({
      state: {
        ...DEFAULT_BULK_SYNC_STATE,
        phase: "paused-rate-limit",
        retryAfterSeconds: 30,
      },
    }),
    "Paused while Zotero asks us to slow down. Resume in about 30 seconds.",
  );

  assert.equal(
    getBulkLibrarySyncStatusMessage({
      state: {
        ...DEFAULT_BULK_SYNC_STATE,
        phase: "paused-error",
      },
    }),
    "Sync interrupted. Start sync again when ready.",
  );

  assert.equal(
    getBulkLibrarySyncStatusMessage({
      state: {
        ...DEFAULT_BULK_SYNC_STATE,
        processedCount: 12,
        phase: "completed",
        totalResults: 12,
      },
    }),
    "Finished syncing 12 papers.",
  );

  assert.equal(
    getBulkLibrarySyncStatusMessage({
      state: {
        ...DEFAULT_BULK_SYNC_STATE,
        phase: "completed",
        processedCount: 12,
        totalResults: 12,
      },
      libraryName: "My Library",
    }),
    "Finished syncing 12 papers in My Library.",
  );
});

test("formatBulkLibrarySyncCompletionMessage is the shared completion formatter", () => {
  assert.equal(
    formatBulkLibrarySyncCompletionMessage({
      state: {
        ...DEFAULT_BULK_SYNC_STATE,
        processedCount: 3,
        enrichmentFailureCount: 1,
        startedAt: "2026-03-14T12:00:00.000Z",
        completedAt: "2026-03-14T12:00:02.000Z",
      },
      libraryName: "My Library",
    }),
    "Finished syncing 3 papers in My Library in 2.00 seconds. Enrichment failed for 1 paper. Run sync again later to try again.",
  );
});
