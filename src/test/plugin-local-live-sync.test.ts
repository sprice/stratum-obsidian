import assert from "node:assert/strict";
import test from "node:test";
import {
  getTrackedLibraryRefreshCandidates,
  isWatchedZoteroDataFile,
  shouldTriggerLocalLiveSyncFromWatchEvent,
} from "../plugin-local-live-sync-utils";
import {
  getDefaultZoteroDataDir,
  getRuntimePlatform,
  resolveHomeDir,
} from "../zotero-data-dir";

test("getDefaultZoteroDataDir uses the platform home directory", () => {
  assert.equal(
    getDefaultZoteroDataDir({
      platform: "darwin",
      homeDir: "/Users/alice",
    }),
    "/Users/alice/Zotero",
  );
  assert.equal(
    getDefaultZoteroDataDir({
      platform: "linux",
      homeDir: "/home/alice",
    }),
    "/home/alice/Zotero",
  );
  assert.equal(
    getDefaultZoteroDataDir({
      platform: "win32",
      homeDir: "C:\\Users\\Alice",
    }),
    "C:\\Users\\Alice\\Zotero",
  );
});

test("resolveHomeDir prefers HOME and falls back to USERPROFILE", () => {
  assert.equal(
    resolveHomeDir({
      HOME: "/Users/alice",
    }),
    "/Users/alice",
  );
  assert.equal(
    resolveHomeDir({
      USERPROFILE: "C:\\Users\\Alice",
    }),
    "C:\\Users\\Alice",
  );
});

test("getRuntimePlatform falls back to a stable string", () => {
  assert.equal(typeof getRuntimePlatform(), "string");
});

test("isWatchedZoteroDataFile only reacts to Zotero sqlite writes", () => {
  assert.equal(isWatchedZoteroDataFile("zotero.sqlite"), true);
  assert.equal(isWatchedZoteroDataFile("zotero.sqlite-wal"), true);
  assert.equal(isWatchedZoteroDataFile("zotero.sqlite-shm"), true);
  assert.equal(isWatchedZoteroDataFile("better-bibtex.sqlite"), false);
  assert.equal(isWatchedZoteroDataFile(null), false);
});

test("watch events without filenames still trigger a live sync pass", () => {
  assert.equal(shouldTriggerLocalLiveSyncFromWatchEvent(null), true);
  assert.equal(shouldTriggerLocalLiveSyncFromWatchEvent(undefined), true);
  assert.equal(
    shouldTriggerLocalLiveSyncFromWatchEvent("zotero.sqlite-wal"),
    true,
  );
  assert.equal(
    shouldTriggerLocalLiveSyncFromWatchEvent("better-bibtex.sqlite"),
    false,
  );
});

test("getTrackedLibraryRefreshCandidates returns notes whose parent or tracked child items changed", () => {
  const candidates = getTrackedLibraryRefreshCandidates({
    itemFileMap: {
      "user/1/UNCHANGED": {
        filePath: "Literature Notes/Unchanged.md",
        zoteroItemKey: "UNCHANGED",
        zoteroVersion: 10,
      },
      "user/1/UPDATED": {
        filePath: "Literature Notes/Updated.md",
        zoteroItemKey: "UPDATED",
        zoteroVersion: 10,
      },
      "user/1/MISSING": {
        filePath: "Literature Notes/Missing.md",
        zoteroItemKey: "MISSING",
        zoteroVersion: 7,
      },
      "user/1/CHILD-UPDATED": {
        filePath: "Literature Notes/Child Updated.md",
        zoteroItemKey: "CHILD-UPDATED",
        zoteroVersion: 4,
      },
      "user/1/CHILD-MISSING": {
        filePath: "Literature Notes/Child Missing.md",
        zoteroItemKey: "CHILD-MISSING",
        zoteroVersion: 5,
      },
      "group/2/OTHER": {
        filePath: "Literature Notes/Other.md",
        zoteroItemKey: "OTHER",
        zoteroVersion: 3,
      },
    },
    library: {
      type: "user",
      id: "1",
    },
    previousItemVersions: {
      UNCHANGED: 10,
      UPDATED: 10,
      MISSING: 7,
      "CHILD-UPDATED": 4,
      "CHILD-MISSING": 5,
      ANNOT1: 3,
      ANNOT2: 8,
    },
    currentItemVersions: {
      UNCHANGED: 10,
      UPDATED: 11,
      "CHILD-UPDATED": 4,
      ANNOT1: 4,
    },
    trackedChildKeysByIdentity: {
      "user/1/CHILD-UPDATED": ["ANNOT1"],
      "user/1/CHILD-MISSING": ["ANNOT2"],
    },
  });

  assert.deepEqual(candidates, [
    {
      identity: "user/1/CHILD-MISSING",
      itemKey: "CHILD-MISSING",
      filePath: "Literature Notes/Child Missing.md",
    },
    {
      identity: "user/1/CHILD-UPDATED",
      itemKey: "CHILD-UPDATED",
      filePath: "Literature Notes/Child Updated.md",
    },
    {
      identity: "user/1/MISSING",
      itemKey: "MISSING",
      filePath: "Literature Notes/Missing.md",
    },
    {
      identity: "user/1/UPDATED",
      itemKey: "UPDATED",
      filePath: "Literature Notes/Updated.md",
    },
  ]);
});
