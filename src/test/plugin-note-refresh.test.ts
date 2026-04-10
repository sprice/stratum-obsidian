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
